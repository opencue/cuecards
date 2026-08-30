"""Evolve a cue *description* (the routing text), landing the winner per-profile
in the cue repo — never in the opencue/skills submodule.

This is the description-level counterpart to evolution.skills.evolve_skill
(which evolves SKILL.md *bodies*). Phase 0 implements the `--dry-run` path: it
loads the skill, runs the baseline `cue lint-skill`, and prints the
`persona_routing` rows it *would* write — all with NO DSPy install and NO LLM
key. The real GEPA path (Phase 3) is appended later, with heavy imports kept
lazy AFTER the dry-run early return (mirrors evolve_skill.py).

Usage:
    # offline wiring check (no install, no key):
    python -m evolution.descriptions.evolve_description \
        --skill meta/smart-loader --target skill --profile coolify --dry-run
"""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import click
import yaml
from rich.console import Console
from rich.table import Table

from evolution.core.atomic_io import atomic_write_text
from evolution.core.config import CueEvolutionConfig
from evolution.core.cue_lint import lint_path, lint_text
from evolution.core.cue_skill import (
    find_skill,
    load_skill,
    extract_description,
    reassemble_with_new_description,
)
from evolution.descriptions.profile_yaml_writer import (
    description_to_persona_routing,
    update_persona_routing,
    set_profile_field,
    backup_and_write,
)
from evolution.descriptions.routing_dataset_builder import (
    AnalyticsRoutingBuilder,
    build_routing_dataset,
    _MIN_REAL_POSITIVES,
)
from evolution.descriptions.persona_eval import (
    build_persona_scenarios,   # offline
    rewrite_persona,           # dspy lazy (inside the fn)
    judge_persona,             # dspy lazy (inside the fn)
)

console = Console()

VALID_TARGETS = ("skill", "command", "persona", "description", "mcp", "cli")

# Skill-routing gate thresholds.
_F1_MIN_DELTA = 0.05        # holdout F1 must improve by at least this to auto-apply
_LINT_SCORE_SLACK = 5       # evolved lint score may dip at most this far below baseline
_MAX_DESC_CHARS = 200       # R003 convention; keep the description lint-clean
_MAX_GROWTH = 0.5           # description may grow at most 50% over baseline
_MIN_HOLDOUT_PER_CLASS = 3  # below this, a 0.05 F1 delta is noise (1+1 → deltas of 0.33+)

# Persona gate thresholds (propose-only by default; auto-apply needs opt-in).
_PERSONA_MIN_DELTA = 0.05   # judge composite must improve by this to apply (if allowed)
_MAX_PERSONA_CHARS = 2000   # practical cap (schema has none; 40k CLAUDE.md warn bounds it)
_PROFILE_DESC_CHARS = 200   # HARD Ajv maxLength on profile.yaml description:


def _resolve_profile_path(config: CueEvolutionConfig, profile: str) -> Optional[Path]:
    # Resolve and confirm the target stays inside profiles/ (block `../` escapes
    # such as `--profile ../nano-banana`).
    root = config.profiles_root.resolve()
    p = (config.profiles_root / profile / "profile.yaml").resolve()
    if not str(p).startswith(str(root) + "/"):
        return None
    return p if p.is_file() else None


def _canonical_skill_id(skill_path: Path, skills_root: Path) -> Optional[str]:
    """The 'category/slug' id that analytics.jsonl `skill_hit.skill` uses,
    derived from the resolved SKILL.md path (its parent dir relative to root)."""
    try:
        return str(skill_path.parent.relative_to(skills_root))
    except ValueError:
        return None


def _print_rows(rows: list[dict]) -> None:
    if not rows:
        console.print("  [yellow](no routing rows could be extracted — "
                      "description lacks quoted triggers / capability prose)[/yellow]")
        return
    console.print("[bold]persona_routing rows that WOULD be written:[/bold]")
    for r in rows:
        kind = "phrase" if "phrase" in r else "capability"
        console.print(f"  - {kind}: [cyan]{r.get(kind)}[/cyan]  -> skill: {r['skill']}")


def _precheck_description(evolved_desc: str, baseline_desc: str, skill_id: str) -> list[tuple]:
    """Cheap, LLM-free quality gates that lint warnings (R003/R004) don't block.
    Returns [(passed, name, message)]. All must pass to auto-apply."""
    n = len(evolved_desc)
    growth = (n - len(baseline_desc)) / max(1, len(baseline_desc))
    rows = description_to_persona_routing(evolved_desc, skill_id)
    return [
        (bool(evolved_desc.strip()), "non_empty", "non-empty"),
        (n <= _MAX_DESC_CHARS, "length", f"{n}/{_MAX_DESC_CHARS} chars"),
        (growth <= _MAX_GROWTH, "growth", f"{growth:+.0%} (max +{int(_MAX_GROWTH*100)}%)"),
        (len(rows) >= 1, "yields_rows", f"{len(rows)} persona_routing row(s)"),
    ]


def _run_gepa(config: CueEvolutionConfig, baseline_desc: str, dataset):
    """Optimize the description with DSPy+GEPA. Heavy imports are local so the
    dry-run / offline paths never touch DSPy. Returns
    (evolved_desc, mutated, elapsed_s, f1_base, f1_evo)."""
    import time
    import dspy
    from evolution.descriptions.description_module import DescriptionModule
    from evolution.descriptions.routing_fitness import (
        routing_fitness_metric, routing_f1_on_holdout,
    )

    lm = dspy.LM(config.eval_model, **config.lm_kwargs())
    dspy.configure(lm=lm)
    baseline_module = DescriptionModule(baseline_desc)
    trainset = dataset.to_dspy_examples("train")
    valset = dataset.to_dspy_examples("val")

    n_threads = max(1, min(8, len(trainset)))
    console.print(f"\n[bold cyan]Optimizing ({config.iterations} iterations)…[/bold cyan]")
    start = time.time()
    try:
        # GEPA requires (a) a budget — max_full_evals / max_metric_calls / auto —
        # and (b) a reflection LM. The old call passed `max_steps` (invalid) with
        # neither, so it threw and silently fell back to MIPROv2 every run.
        reflect = dspy.LM(config.optimizer_model, **config.lm_kwargs())
        optimizer = dspy.GEPA(
            metric=routing_fitness_metric,
            max_full_evals=config.iterations,
            reflection_lm=reflect,
            num_threads=n_threads,
        )
        optimized = optimizer.compile(baseline_module, trainset=trainset, valset=valset)
    except Exception as e:  # noqa: BLE001 — GEPA unavailable/API drift → MIPROv2
        console.print(f"[yellow]GEPA unavailable ({e}); falling back to MIPROv2[/yellow]")
        try:
            optimizer = dspy.MIPROv2(metric=routing_fitness_metric, auto="light", num_threads=n_threads)
            optimized = optimizer.compile(baseline_module, trainset=trainset)
        except Exception as e2:  # noqa: BLE001 — both optimizers failed → clean no-op
            console.print(f"[red]✗ Optimization failed ({e2}); no change.[/red]")
            return baseline_desc.strip(), False, time.time() - start, {}, {}
    elapsed = time.time() - start

    # The description rides in the predictor's Signature instructions, so read the
    # EVOLVED text back from the optimized module (not a plain attribute).
    if hasattr(optimized, "current_description"):
        evolved_desc = (optimized.current_description() or baseline_desc).strip()
    else:
        evolved_desc = baseline_desc.strip()
    mutated = evolved_desc != baseline_desc.strip()

    holdout = dataset.to_dspy_examples("holdout")
    f1_base = routing_f1_on_holdout(baseline_module, holdout, lm)
    f1_evo = routing_f1_on_holdout(optimized, holdout, lm)
    return evolved_desc, mutated, elapsed, f1_base, f1_evo


def _log_evolution(config: CueEvolutionConfig, entry: dict) -> None:
    log = config.evolution_log
    log.parent.mkdir(parents=True, exist_ok=True)
    with open(log, "a") as f:
        f.write(json.dumps(entry) + "\n")


def _finalize_skill(
    config, skill, skill_path, canonical_id, profile, profile_path,
    *, evolved_desc, baseline_desc, f1_base, f1_evo, lint_base, lint_evolved,
    mutated, iterations, optimizer_model, elapsed_s, note, eval_source, dataset_meta,
) -> int:
    """Gate the candidate and either land persona_routing rows or write a
    proposal. LLM-free and unit-tested (the only un-runnable piece here is the
    GEPA call upstream)."""
    skill_name = skill.get("name") or canonical_id
    prechecks = _precheck_description(evolved_desc, baseline_desc, skill_name)
    precheck_ok = all(p for p, _, _ in prechecks)
    lint_ok = bool(getattr(lint_evolved, "ok", False)) and (
        getattr(lint_evolved, "score", 0) >= getattr(lint_base, "score", 0) - _LINT_SCORE_SLACK
    )
    improvement = round(f1_evo.get("f1", 0.0) - f1_base.get("f1", 0.0), 4)
    # Holdout size from the confusion matrix — a 0.05 F1 delta is meaningless on a
    # 1+1 holdout (single flip swings F1 by 0.33+). Require a per-class floor.
    ho_pos = f1_evo.get("tp", 0) + f1_evo.get("fn", 0)
    ho_neg = f1_evo.get("tn", 0) + f1_evo.get("fp", 0)
    holdout_ok = ho_pos >= _MIN_HOLDOUT_PER_CLASS and ho_neg >= _MIN_HOLDOUT_PER_CLASS
    candidate_ok = precheck_ok and lint_ok and mutated
    should_apply = (candidate_ok and improvement > _F1_MIN_DELTA
                    and holdout_ok and profile_path is not None)

    # Report.
    console.print("\n[bold]Candidate gates[/bold]")
    for ok, name, msg in prechecks:
        console.print(f"  [{'green' if ok else 'red'}]{'✓' if ok else '✗'} {name}[/]: {msg}")
    console.print(f"  [{'green' if mutated else 'red'}]{'✓' if mutated else '✗'} mutated[/]: "
                  f"{'description changed' if mutated else 'GEPA left description unchanged'}")
    console.print(f"  [{'green' if lint_ok else 'red'}]{'✓' if lint_ok else '✗'} lint[/]: "
                  f"evolved {getattr(lint_evolved,'score',0)}/100 vs baseline "
                  f"{getattr(lint_base,'score',0)}/100")
    console.print(f"  [{'green' if holdout_ok else 'red'}]{'✓' if holdout_ok else '✗'} holdout[/]: "
                  f"{ho_pos} pos / {ho_neg} neg (need ≥{_MIN_HOLDOUT_PER_CLASS} each)")

    table = Table(title="Routing F1 (blind holdout)")
    table.add_column("Metric", style="bold")
    table.add_column("Baseline", justify="right")
    table.add_column("Evolved", justify="right")
    table.add_column("Δ", justify="right")
    chg = "green" if improvement > 0 else "red"
    table.add_row("F1", f"{f1_base.get('f1',0):.3f}", f"{f1_evo.get('f1',0):.3f}",
                  f"[{chg}]{improvement:+.3f}[/{chg}]")
    table.add_row("description chars", f"{len(baseline_desc)}", f"{len(evolved_desc)}",
                  f"{len(evolved_desc)-len(baseline_desc):+d}")
    console.print(table)

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    rows = description_to_persona_routing(evolved_desc, skill_name, note=note or "auto-evolved")

    if should_apply:
        content = profile_path.read_text(encoding="utf-8")
        new_content = update_persona_routing(content, rows)
        if new_content == content:
            reason = "rows already present in profile.yaml (no-op)"
            return _write_proposal(config, canonical_id, ts, evolved_desc, baseline_desc,
                                   rows, reason, improvement, applied=False)
        backup = backup_and_write(profile_path, new_content, ts, original_content=content)
        # Schema-validate the edited profile (W9 etc.); revert if cue rejects it,
        # mirroring the persona path. Best-effort: if cue can't run, keep the edit.
        if profile:
            ran, ok = validate_profile(config, profile)
            if ran and not ok:
                atomic_write_text(profile_path, content)  # revert (atomic)
                console.print("[red]✗ cue validate rejected the edited profile — reverted.[/red]")
                return _write_proposal(config, canonical_id, ts, evolved_desc, baseline_desc,
                                       rows, "cue validate rejected the edit (reverted)",
                                       improvement, applied=False)
        _log_evolution(config, {
            "ts": ts, "kind": "persona-routing", "skill": canonical_id, "profile": profile,
            "profile_path": str(profile_path), "backup": str(backup),
            "entries_added": rows,
            "baseline_f1": f1_base.get("f1"), "evolved_f1": f1_evo.get("f1"),
            "improvement": improvement,
            "baseline_lint_score": getattr(lint_base, "score", None),
            "evolved_lint_score": getattr(lint_evolved, "score", None),
            "dataset_source": dataset_meta.get("source"),
            "optimizer_model": optimizer_model, "iterations": iterations,
            "elapsed_s": round(elapsed_s, 1) if elapsed_s else None, "applied": True,
        })
        console.print(
            f"\n[bold green]✓ Applied[/bold green] {len(rows)} persona_routing row(s) to "
            f"{profile_path.relative_to(config.cue_repo_path)} "
            f"(F1 {improvement:+.3f}, lint OK). Backup: {backup.name}\n"
            f"  Revert: cp {backup} {profile_path}"
        )
        if profile:
            _materialize(config, profile)
        return 0

    # Not applied → inert proposal.
    reason = (
        "no --profile given" if profile_path is None else
        "GEPA did not mutate the description" if not mutated else
        "lint/precheck failed" if not candidate_ok else
        f"holdout too small ({ho_pos} pos / {ho_neg} neg < {_MIN_HOLDOUT_PER_CLASS} each)"
        if not holdout_ok else
        f"no holdout F1 improvement ({improvement:+.3f} ≤ {_F1_MIN_DELTA})"
    )
    return _write_proposal(config, canonical_id, ts, evolved_desc, baseline_desc,
                           rows, reason, improvement, applied=False)


def _write_proposal(config, canonical_id, ts, evolved_desc, baseline_desc,
                    rows, reason, improvement, applied) -> int:
    import yaml
    out_dir = (config.cue_repo_path / "evolution" / "proposals" / "descriptions"
               / canonical_id.replace("/", "_") / ts)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "evolved_description.txt").write_text(evolved_desc + "\n", encoding="utf-8")
    (out_dir / "baseline_description.txt").write_text(baseline_desc + "\n", encoding="utf-8")
    (out_dir / "persona_routing.yaml").write_text(
        yaml.dump({"persona_routing": rows}, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    (out_dir / "reason.txt").write_text(reason + "\n", encoding="utf-8")
    _log_evolution(config, {
        "ts": ts, "kind": "persona-routing", "skill": canonical_id, "applied": applied,
        "reason": reason, "proposal_dir": str(out_dir), "improvement": improvement,
    })
    console.print(f"\n[yellow]⚠ Not applied ({reason}). Proposal: {out_dir}[/yellow]")
    return 0


# ── persona / profile-description target (LLM-judge, propose-only default) ──

def validate_profile(config: CueEvolutionConfig, profile_name: str) -> tuple[bool, bool]:
    """Run `cue validate <name>` from the repo. Returns (ran, ok). When cue
    can't run (ran=False), the caller relies on the pre-write prechecks — which
    already enforce the only HARD schema constraint (description ≤200 chars)."""
    try:
        proc = subprocess.run(
            ["cue", "validate", profile_name],
            cwd=str(config.cue_repo_path), capture_output=True, text=True, timeout=60,
        )
        return True, proc.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return False, False


def _materialize(config: CueEvolutionConfig, profile: str) -> None:
    """Best-effort `cue materialize <profile>` so a freshly-landed edit reaches
    the generated CLAUDE.md (rows are inert until re-materialization). Warn-only:
    a missing/failed cue must NOT undo a valid landed write."""
    try:
        proc = subprocess.run(
            ["cue", "materialize", profile],
            cwd=str(config.cue_repo_path), capture_output=True, text=True, timeout=120,
        )
        if proc.returncode == 0:
            console.print(f"  [dim]re-materialized {profile} → CLAUDE.md refreshed[/dim]")
        else:
            console.print(f"  [yellow]note: `cue materialize {profile}` exited "
                          f"{proc.returncode}; run it manually to refresh CLAUDE.md[/yellow]")
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        console.print(f"  [yellow]note: run `cue materialize {profile}` to refresh "
                      f"CLAUDE.md (the new rows are inert until then)[/yellow]")


def _precheck_persona(evolved: str, baseline: str, which: str) -> list[tuple]:
    n = len(evolved)
    cap = _PROFILE_DESC_CHARS if which == "description" else _MAX_PERSONA_CHARS
    growth = (n - len(baseline)) / max(1, len(baseline))
    checks = [
        (bool(evolved.strip()), "non_empty", "non-empty"),
        (n <= cap, "length", f"{n}/{cap} chars"),
        (growth <= _MAX_GROWTH, "growth", f"{growth:+.0%} (max +{int(_MAX_GROWTH*100)}%)"),
    ]
    if which == "persona":
        low = evolved.lower()
        has_directive = ("- " in evolved) or ("**" in evolved) or ("you " in low) or ("default" in low)
        checks.append((has_directive, "behavioral_directive", "has a directive/bullet"))
    return checks


def _write_persona_proposal(config, profile, which, ts, evolved, baseline,
                            scores_base, scores_evo, reason) -> int:
    out_dir = (config.cue_repo_path / "evolution" / "proposals" / "personas"
               / (profile or "_noprofile") / ts)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"evolved_{which}.txt").write_text(evolved + "\n", encoding="utf-8")
    (out_dir / f"baseline_{which}.txt").write_text(baseline + "\n", encoding="utf-8")
    (out_dir / "judge_scores.yaml").write_text(
        yaml.dump({"baseline": scores_base, "evolved": scores_evo},
                  sort_keys=False, allow_unicode=True), encoding="utf-8")
    (out_dir / "reason.txt").write_text(reason + "\n", encoding="utf-8")
    _log_evolution(config, {
        "ts": ts, "kind": f"profile-{which}", "profile": profile, "applied": False,
        "reason": reason, "proposal_dir": str(out_dir),
        "improvement": round(scores_evo.get("composite", 0) - scores_base.get("composite", 0), 4),
    })
    console.print(f"\n[yellow]⚠ Not applied ({reason}). Proposal: {out_dir}[/yellow]")
    return 0


def _finalize_persona(config, profile, profile_path, which, evolved, baseline,
                      scores_base, scores_evo, allow_apply) -> int:
    prechecks = _precheck_persona(evolved, baseline, which)
    precheck_ok = all(p for p, _, _ in prechecks)
    improvement = round(scores_evo.get("composite", 0) - scores_base.get("composite", 0), 4)

    console.print("\n[bold]Persona gates[/bold]")
    for ok, name, msg in prechecks:
        console.print(f"  [{'green' if ok else 'red'}]{'✓' if ok else '✗'} {name}[/]: {msg}")
    console.print(f"  judge composite: baseline {scores_base.get('composite', 0):.3f} → "
                  f"evolved {scores_evo.get('composite', 0):.3f} ({improvement:+.3f})")

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    should_apply = allow_apply and precheck_ok and improvement > _PERSONA_MIN_DELTA

    if should_apply:
        content = profile_path.read_text(encoding="utf-8")
        new_content = set_profile_field(content, which, evolved)
        if new_content == content:
            return _write_persona_proposal(config, profile, which, ts, evolved, baseline,
                                           scores_base, scores_evo, "no change after write (no-op)")
        backup = backup_and_write(profile_path, new_content, ts, original_content=content)
        ran, ok = validate_profile(config, profile)
        if ran and not ok:
            atomic_write_text(profile_path, content)  # revert (atomic)
            console.print("[red]✗ cue validate rejected the edit — reverted.[/red]")
            return _write_persona_proposal(config, profile, which, ts, evolved, baseline,
                                           scores_base, scores_evo,
                                           "cue validate rejected the edit (reverted)")
        _log_evolution(config, {
            "ts": ts, "kind": f"profile-{which}", "profile": profile,
            "profile_path": str(profile_path), "backup": str(backup),
            "baseline_composite": scores_base.get("composite"),
            "evolved_composite": scores_evo.get("composite"),
            "improvement": improvement, "validated": bool(ran and ok), "applied": True,
        })
        console.print(
            f"\n[bold green]✓ Applied[/bold green] new {which} to "
            f"{profile_path.relative_to(config.cue_repo_path)} (judge {improvement:+.3f}"
            f"{', cue validate OK' if ran and ok else ''}). Backup: {backup.name}\n"
            f"  Revert: cp {backup} {profile_path}"
        )
        _materialize(config, profile)
        return 0

    reason = (
        "propose-only (default; pass --allow-persona-apply to enable gated auto-apply)"
        if not allow_apply else
        "precheck failed" if not precheck_ok else
        f"no judge improvement ({improvement:+.3f} ≤ {_PERSONA_MIN_DELTA})"
    )
    return _write_persona_proposal(config, profile, which, ts, evolved, baseline,
                                   scores_base, scores_evo, reason)


def _evolve_persona(config: CueEvolutionConfig, profile: Optional[str], which: str,
                    dry_run: bool, allow_apply: bool) -> int:
    """Evolve a profile's persona / description (system-prompt text). Rewrite +
    LLM-judge over behavioral scenarios; propose-only unless --allow-persona-apply."""
    console.print(f"\n[bold cyan]🧬 cue {which} evolution[/bold cyan] — "
                  f"profile: [bold]{profile}[/bold]\n")
    if not profile:
        console.print(f"[red]✗ --profile is required for --target {which}[/red]")
        return 2
    profile_path = _resolve_profile_path(config, profile)
    if not profile_path:
        console.print(f"[red]✗ Profile '{profile}' not found or outside profiles/[/red]")
        return 1
    content = profile_path.read_text(encoding="utf-8")
    try:
        data = yaml.safe_load(content) or {}
    except yaml.YAMLError as e:
        console.print(f"[red]✗ profile.yaml did not parse: {e}[/red]")
        return 1

    baseline = str(data.get(which, "") or "")
    description = str(data.get("description", "") or "")
    skills = data.get("skills", {}) or {}
    local = skills.get("local", []) if isinstance(skills, dict) else []
    skills_summary = ", ".join(
        str(s.get("id", "") if isinstance(s, dict) else s) for s in local[:20]
    )
    scenarios = build_persona_scenarios(config)

    console.print(f"  Field: [bold]{which}[/bold] ({len(baseline)} chars)")
    console.print(f"  Behavioral scenarios (from resources/evals): {len(scenarios)}")
    console.print(f"  Autonomy: "
                  f"{'gated auto-apply' if allow_apply else 'propose-only (default)'}")

    if dry_run:
        action = (f"apply if composite improves >{_PERSONA_MIN_DELTA} AND cue validate passes"
                  if allow_apply else "write a proposal (propose-only)")
        console.print(
            f"\n[bold green]DRY RUN — wiring validated.[/bold green]\n"
            f"  Would rewrite the {which} (optimizer={config.optimizer_model}),\n"
            f"  judge baseline vs candidate over {len(scenarios)} scenarios "
            f"(eval={config.eval_model}), then {action}.\n"
            f"  Backups + log → {config.evolution_log}"
        )
        return 0

    try:
        import dspy  # noqa: F401
    except ImportError as e:
        console.print(f"[red]✗ DSPy could not be imported[/red] ({e}). "
                      "Install 'evolution[optimize]'. The --dry-run path needs neither.")
        return 2
    if not scenarios:
        console.print("[red]✗ No behavioral scenarios (resources/evals empty). Aborting.[/red]")
        return 1

    # Judge the baseline FIRST, turn its weak dimensions into hints, and feed
    # them to the rewriter so it targets concrete gaps (closes the feedback loop
    # that previously left failure_hints as dead code).
    console.print("\n[bold]Judging baseline → rewriting with hints → judging candidate…[/bold]")
    scores_base = judge_persona(config, baseline, description, scenarios)
    hints = _hints_from_scores(scores_base)
    console.print(f"  hints → rewriter: [dim]{hints}[/dim]")
    candidate = rewrite_persona(config, baseline, description, skills_summary, failure_hints=hints)
    scores_evo = judge_persona(config, candidate, description, scenarios)
    return _finalize_persona(config, profile, profile_path, which, candidate, baseline,
                             scores_base, scores_evo, allow_apply)


def _hints_from_scores(scores: dict) -> str:
    """Turn a baseline persona-judge breakdown into a targeted rewrite hint."""
    dims = [
        ("role_consistency", "stay strictly in role"),
        ("defaults_applied", "state and apply the profile's concrete defaults"),
        ("freestyling_avoided", "avoid inventing scope / wandering off-task"),
    ]
    weak = [label for key, label in dims if scores.get(key, 1.0) < 0.6]
    if not weak:
        return "(baseline already scores well; tighten wording without changing scope or domain)"
    return "Focus the rewrite on these weak areas: " + "; ".join(weak) + "."


def _sweep_skill_ids(config: CueEvolutionConfig, profile: Optional[str],
                     max_skills: int) -> list[str]:
    """The skills to sweep: a profile's declared local skills, or every SKILL.md
    under the skills root. Returns 'category/slug' ids, deduped, capped."""
    ids: list[str] = []
    if profile:
        ppath = config.profiles_root / profile / "profile.yaml"
        if ppath.is_file():
            try:
                data = yaml.safe_load(ppath.read_text(encoding="utf-8")) or {}
            except yaml.YAMLError:
                data = {}
            skills = data.get("skills") or {}
            local = skills.get("local", []) if isinstance(skills, dict) else []
            for s in local:
                sid = s.get("id", "") if isinstance(s, dict) else str(s)
                if not sid:
                    continue
                p = find_skill(sid, config.skills_root)
                ids.append(_canonical_skill_id(p, config.skills_root) if p else sid)
    elif config.skills_root.exists():
        for md in sorted(config.skills_root.rglob("SKILL.md")):
            try:
                ids.append(str(md.parent.relative_to(config.skills_root)))
            except ValueError:
                continue
    seen: set = set()
    uniq = [i for i in ids if not (i in seen or seen.add(i))]
    return uniq[:max_skills] if max_skills else uniq


def _sweep(config: CueEvolutionConfig, profile: Optional[str], eval_source: str,
           iterations: int, dry_run: bool, max_skills: int) -> int:
    """Run the skill-routing optimizer across many skills in one pass.

    Token-budget accounting isn't wired into the Python engine, so the cap is a
    skill COUNT (`--max-skills`); a true token budget is a follow-up that needs
    per-run token accounting from DSPy."""
    ids = _sweep_skill_ids(config, profile, max_skills)
    if not ids:
        console.print("[red]✗ No skills to sweep.[/red]")
        return 1
    console.print(
        f"[bold cyan]Sweep[/bold cyan]: {len(ids)} skill(s)"
        + (f" from profile [bold]{profile}[/bold]" if profile else " (all skills)")
        + (" — dry-run" if dry_run else "")
    )
    results: list[tuple] = []
    for i, sid in enumerate(ids, 1):
        console.print(f"\n[bold]── [{i}/{len(ids)}] {sid} ──[/bold]")
        try:
            rc = _evolve_skill(config, sid, profile, eval_source, iterations, None, dry_run)
        except Exception as e:  # noqa: BLE001 — one skill must not abort the sweep
            console.print(f"[red]  error: {e}[/red]")
            rc = 1
        results.append((sid, rc))
    ok = sum(1 for _, rc in results if rc == 0)
    console.print(f"\n[bold]Sweep complete[/bold]: {ok}/{len(results)} ran cleanly.")
    return 0 if ok == len(results) else 1


def evolve(
    skill_id: Optional[str] = None,
    target: str = "skill",
    profile: Optional[str] = None,
    eval_source: str = "synthetic",
    iterations: int = 10,
    note: Optional[str] = None,
    optimizer_model: Optional[str] = None,
    eval_model: Optional[str] = None,
    cue_repo: Optional[str] = None,
    dry_run: bool = False,
    allow_persona_apply: bool = False,
    all_skills: bool = False,
    max_skills: int = 0,
) -> int:
    """Dispatch by --target.
      skill                 → persona_routing rows (routing-F1, gated auto-apply)
      persona | description → profile.yaml fields (LLM-judge, propose-only default)
      command               → NOT a description target (see _print_command_reframe)
      mcp | cli             → Phase 5, low ROI (not implemented)
    --all-skills sweeps the skill target across many skills.
    """
    if target not in VALID_TARGETS:
        console.print(f"[red]✗ Unknown --target {target!r}; expected one of "
                      f"{', '.join(VALID_TARGETS)}[/red]")
        return 2

    config = CueEvolutionConfig(iterations=iterations)
    if cue_repo:
        config.cue_repo_path = Path(cue_repo)
    if optimizer_model:
        config.optimizer_model = optimizer_model
    if eval_model:
        config.eval_model = eval_model

    if all_skills:
        return _sweep(config, profile, eval_source, iterations, dry_run, max_skills)
    if target == "skill":
        if not skill_id:
            console.print("[red]✗ --skill is required for --target skill[/red]")
            return 2
        return _evolve_skill(config, skill_id, profile, eval_source, iterations, note, dry_run)
    if target in ("persona", "description"):
        return _evolve_persona(config, profile, target, dry_run, allow_persona_apply)
    if target in ("command", "mcp", "cli"):
        _print_null_target_reframe(target)
        return 2
    return 2  # unreachable (VALID_TARGETS guarded above)


_NULL_TARGET_REFRAMES = {
    "command":
        "a command's DESCRIPTION is not a valid optimization target.\n"
        "  Verified (workflow phase4-understand): cue renders commands into CLAUDE.md as\n"
        "  bare names only (runtime-materializer.ts:619); the description:/argument-hint:\n"
        "  frontmatter is read only by the web dashboard. The router is skills-only and\n"
        "  persona_routing can't target a command — so a command description has ZERO\n"
        "  influence on whether Claude reaches for it.\n"
        "  REAL LEVER: the command .md BODY (what Claude reads on invocation) — that's the\n"
        "  body-engine's job (cf. evolution/skills/evolve_skill.py); tracked as a future\n"
        "  'command-body' track, NOT description evolution.",
    "mcp":
        "an MCP server has no human DESCRIPTION field to optimize.\n"
        "  Verified: resources/mcps/configs/*.json carry only command/args/env; CLAUDE.md\n"
        "  lists MCP servers by ID only (runtime-materializer.ts ## MCP Servers). Claude\n"
        "  learns an MCP's capabilities from the SERVER's own tool/resource descriptors at\n"
        "  runtime (the MCP protocol) — cue does not author or control those.\n"
        "  REAL LEVER: improve the upstream MCP server's tool descriptions, or sharpen the\n"
        "  paired SKILL.md (use --target skill) that fronts the MCP. Nothing to do here.",
    "cli":
        "cue CLI help text is terminal-only — Claude never reads it.\n"
        "  Verified: cue subcommand summaries live in src/index.ts / src/commands/_index.ts\n"
        "  and are printed by `cue --help`; they are NOT injected into the materialized\n"
        "  CLAUDE.md. Optimizing them is human-facing `--help` polish with ZERO agent-\n"
        "  behavior impact, so it is intentionally out of scope for the description engine.\n"
        "  REAL LEVER (if desired): edit those summary strings by hand in the TypeScript src.",
}


def _print_null_target_reframe(target: str) -> None:
    body = _NULL_TARGET_REFRAMES[target]
    console.print(f"[yellow]--target {target}: {body}[/yellow]")


def _evolve_skill(
    config: CueEvolutionConfig,
    skill_id: str,
    profile: Optional[str],
    eval_source: str,
    iterations: int,
    note: Optional[str],
    dry_run: bool,
) -> int:
    """Evolve a skill's routing description → per-profile persona_routing rows."""
    console.print(
        f"\n[bold cyan]🧬 cue description evolution[/bold cyan] — "
        f"skill: [bold]{skill_id}[/bold]  target: [bold]skill[/bold]\n"
    )

    # ── 1. Find + load the skill ────────────────────────────────────────
    skill_path = find_skill(skill_id, config.skills_root)
    if not skill_path:
        console.print(f"[red]✗ Skill '{skill_id}' not found under {config.skills_root}[/red]")
        return 1
    skill = load_skill(skill_path)
    baseline_desc = extract_description(skill["frontmatter"]) or skill["description"]
    console.print(f"  Loaded: {skill_path.relative_to(config.cue_repo_path)}")
    console.print(f"  Name: {skill['name']}")
    console.print(f"  Current description ({len(baseline_desc)} chars):")
    console.print(f"    [dim]{baseline_desc}[/dim]")

    # ── 2. Target profile (where persona_routing lands) ─────────────────
    profile_path = None
    if profile:
        profile_path = _resolve_profile_path(config, profile)
        if not profile_path:
            console.print(f"[red]✗ Profile '{profile}' not found at "
                          f"{config.profiles_root / profile / 'profile.yaml'}[/red]")
            return 1
        console.print(f"  Landing target: {profile_path.relative_to(config.cue_repo_path)}")
    else:
        console.print("[yellow]  No --profile given; rows would be printed only "
                      "(persona_routing needs a profile to land in).[/yellow]")

    # ── 3. Baseline lint (the gate, run for real even in dry-run) ───────
    lint = lint_path(skill_path, config)
    if lint.ran:
        console.print(f"  Baseline lint: {lint.message}")
    else:
        console.print(f"  [yellow]Baseline lint did not run: {lint.raw[:120]}[/yellow]")

    # ── 4. Show the rows that would be written from the CURRENT desc ────
    # Preview note is display-only; the note that actually lands on real-run
    # rows is decided in _finalize_skill (default "auto-evolved"), so a dry-run
    # label never leaks into a written profile.yaml.
    preview_note = note or "auto-evolved (preview)"
    rows = description_to_persona_routing(baseline_desc, skill["name"] or skill_id, note=preview_note)
    console.print()
    _print_rows(rows)

    # ── 5. Routing-dataset preview (analytics is offline; synthetic needs LLM) ──
    canonical_id = _canonical_skill_id(skill_path, config.skills_root) or skill_id
    if eval_source == "analytics":
        builder = AnalyticsRoutingBuilder(config)
        ds = builder.build(canonical_id, profile)
        mr = builder.miss_rate(canonical_id, profile)
        c = ds.counts()
        n_pos = sum(1 for e in ds.all_examples if e.label)
        console.print(
            f"\n[bold]Analytics routing dataset[/bold] (skill={canonical_id}"
            f"{', profile=' + profile if profile else ''}):"
        )
        console.print(
            f"  sessions scanned: {ds.meta.get('sessions_scanned', 0)}  |  "
            f"clean positives (≤{ds.meta.get('cooccurrence_threshold')} co-fire): "
            f"{ds.meta.get('raw_positives', 0)}  |  miss-positives: "
            f"{ds.meta.get('miss_positives', 0)}  |  hard negatives: "
            f"{ds.meta.get('hard_negatives', 0)}"
        )
        console.print(
            f"  real miss-rate: {mr['miss_rate']:.0%} ({mr['misses']} misses / "
            f"{mr['hits']} hits) — what an evolved description should reduce"
        )
        console.print(
            f"  split  train {c['train']}  val {c['val']}  holdout {c['holdout']}"
        )
        if n_pos < _MIN_REAL_POSITIVES or not ds.is_sufficient():
            console.print(
                f"  [yellow]→ would FALL BACK to synthetic "
                f"({n_pos} clean positive(s) < {_MIN_REAL_POSITIVES} needed)[/yellow]"
            )
        else:
            console.print("  [green]→ analytics signal sufficient[/green]")

    if dry_run:
        console.print(
            f"\n[bold green]DRY RUN — cue wiring validated.[/bold green]\n"
            f"  Would build a routing dataset (source: {eval_source})\n"
            f"  Would run GEPA ({iterations} iters, optimizer={config.optimizer_model})\n"
            f"  Would auto-apply optimized rows IF holdout F1 improves AND lint "
            f"score does not regress\n"
            f"  Backups + log → {config.evolution_log}"
        )
        return 0

    # ── 6. Real run: build dataset → GEPA → gate → land/propose ─────────
    # The real path always needs DSPy (dataset synthesis + GEPA). Fail clean
    # where the optimize extra / native stack is missing (mirrors evolve_skill).
    try:
        import dspy  # noqa: F401
    except ImportError as e:
        console.print(
            f"[red]✗ DSPy could not be imported[/red] ({e}).\n"
            "  Install the optimize extra (and a working native stack):\n"
            "    pip install -e 'evolution[optimize]'\n"
            "  The --dry-run path needs neither DSPy nor an LLM key."
        )
        return 2

    console.print(f"\n[bold]Building routing dataset[/bold] (source: {eval_source})")
    dataset = build_routing_dataset(canonical_id, baseline_desc, config, profile, eval_source)
    c = dataset.counts()
    console.print(f"  source: {dataset.meta.get('source')}  |  "
                  f"train {c['train']}  val {c['val']}  holdout {c['holdout']}")
    if not dataset.is_sufficient():
        console.print("[red]✗ Dataset insufficient (need a non-empty trainset and "
                      "≥1 positive + ≥1 negative in holdout). Aborting.[/red]")
        return 1

    evolved_desc, mutated, elapsed, f1_base, f1_evo = _run_gepa(
        config, baseline_desc, dataset
    )
    lint_base = lint_path(skill_path, config)
    lint_evolved = lint_text(reassemble_with_new_description(skill, evolved_desc), config)

    return _finalize_skill(
        config, skill, skill_path, canonical_id, profile, profile_path,
        evolved_desc=evolved_desc, baseline_desc=baseline_desc,
        f1_base=f1_base, f1_evo=f1_evo, lint_base=lint_base, lint_evolved=lint_evolved,
        mutated=mutated, iterations=iterations, optimizer_model=config.optimizer_model,
        elapsed_s=elapsed, note=note, eval_source=eval_source, dataset_meta=dataset.meta,
    )


@click.command()
@click.option("--skill", "skill_id", default=None,
              help="cue skill id (category/slug or slug) — required for --target skill")
@click.option("--target", default="skill", type=click.Choice(VALID_TARGETS),
              help="skill=routing rows; persona/description=profile.yaml fields; command/mcp/cli=see notes")
@click.option("--profile", default=None,
              help="Profile to edit (persona_routing rows, or persona/description field)")
@click.option("--eval-source", default="synthetic",
              type=click.Choice(["synthetic", "analytics"]),
              help="Where routing examples come from (skill target)")
@click.option("--iterations", default=10, help="GEPA iterations (skill target)")
@click.option("--note", default=None, help="Optional note rendered on each persona_routing row")
@click.option("--optimizer-model", default=None, help="Override reflection/rewrite model")
@click.option("--eval-model", default=None, help="Override eval/judge model")
@click.option("--cue-repo", default=None, help="Path to the cue repo (else auto-discovered)")
@click.option("--allow-persona-apply", is_flag=True,
              help="Opt in to gated auto-apply for persona/description (default: propose-only)")
@click.option("--all-skills", is_flag=True,
              help="Sweep the skill target across a profile's skills (or all skills)")
@click.option("--max-skills", default=0, type=int, help="Cap the sweep to N skills (0 = no cap)")
@click.option("--dry-run", is_flag=True, help="Validate wiring without optimizing (no LLM, no install)")
def main(skill_id, target, profile, eval_source, iterations, note,
         optimizer_model, eval_model, cue_repo, allow_persona_apply,
         all_skills, max_skills, dry_run):
    """Evolve a cue description. skill→per-profile persona_routing (lint+routing-F1 gated
    auto-apply); persona/description→profile.yaml field (LLM-judge, propose-only by default).
    --all-skills sweeps the skill target across a profile."""
    sys.exit(evolve(
        skill_id=skill_id, target=target, profile=profile, eval_source=eval_source,
        iterations=iterations, note=note, optimizer_model=optimizer_model,
        eval_model=eval_model, cue_repo=cue_repo, dry_run=dry_run,
        allow_persona_apply=allow_persona_apply, all_skills=all_skills, max_skills=max_skills,
    ))


if __name__ == "__main__":
    main()
