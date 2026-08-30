"""Evolve a cue skill's CONTENT (the SKILL.md body) using DSPy + GEPA.

Ported and adapted from hermes-agent-self-evolution's evolve_skill. cue-specific
behaviour:

  * skills are found in the cue repo (resources/skills/skills/<cat>/<slug>/).
  * the auto-apply gate is `cue lint-skill` — a candidate is written to disk
    ONLY if it beats baseline on the holdout set AND passes the linter.
  * on apply, the original is backed up next to it (SKILL.md.bak-<ts>) and the
    change is appended to ~/.config/cue/evolution-log.jsonl (the same log
    `cue evolve` writes), so it is auditable and revertible.
  * on a failing / non-improving candidate, an inert proposal file is written
    instead of mutating the skill.

Usage:
    # offline, no install, no LLM key — validates the cue wiring end to end:
    python -m evolution.skills.evolve_skill --skill eu-funding/ted-tender-search --dry-run

    # real optimization (needs the `optimize` extra + an LLM key):
    python -m evolution.skills.evolve_skill --skill eu-funding/ted-tender-search --iterations 10

DSPy and the heavy dataset/fitness modules are imported lazily, AFTER the
--dry-run early return, so the dry-run path needs none of them.
"""

import json
import os
import sys
import tempfile
import time
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

import click
from rich.console import Console
from rich.table import Table

from evolution.core.config import CueEvolutionConfig
from evolution.core.constraints import ConstraintValidator
from evolution.core.cue_skill import find_skill, load_skill, reassemble_skill
from evolution.core.claude_lm import claude_model_name

console = Console()


def _print_constraints(results) -> bool:
    all_pass = True
    for c in results:
        icon = "✓" if c.passed else "✗"
        color = "green" if c.passed else "red"
        console.print(f"  [{color}]{icon} {c.constraint_name}[/{color}]: {c.message}")
        if not c.passed:
            all_pass = False
    return all_pass


def claude_or_model(config: CueEvolutionConfig) -> str:
    """Readable backend label for the optimizer model."""
    m = config.optimizer_model
    return "claude -p, keyless" if m.startswith("claude-code/") else m


def _log_evolution(config: CueEvolutionConfig, entry: dict) -> None:
    log = config.evolution_log
    log.parent.mkdir(parents=True, exist_ok=True)
    with open(log, "a") as f:
        f.write(json.dumps(entry) + "\n")


def _atomic_write(path: Path, text: str) -> None:
    """Write `text` to `path` atomically: temp file in the same dir + rename.

    Guarantees `path` is either fully the old content or fully the new content,
    never a truncated partial write if the process is interrupted mid-write.
    """
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)  # POSIX-atomic rename
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _finalize(config, skill_id, skill, skill_path, evolved_body, candidate_ok,
              improvement, quality_ok=None, propose_only=False, extra_meta=None):
    """Shared decision: auto-apply else write a proposal. Gates, in order:

    - propose_only=True            → never apply (write proposal for review).
    - improvement is not None (GEPA) → apply iff lint-clean AND improvement > 0.
    - quality_ok is not None (single-shot self-judge) → apply iff lint-clean AND
      changed AND the judge said BETTER.
    - else (single-shot, no judge) → apply iff lint-clean AND changed.
    """
    evolved_full = reassemble_skill(skill["frontmatter"], evolved_body)
    changed = evolved_body.strip() != skill["body"].strip()
    if propose_only:
        should_apply, why = False, "propose-only"
    elif improvement is not None:
        should_apply, why = candidate_ok and improvement > 1e-6, f"holdout {improvement:+.3f}"
    elif quality_ok is not None:
        should_apply = candidate_ok and changed and quality_ok
        why = "judge: better" if quality_ok else "judge: not better"
    else:
        should_apply, why = candidate_ok and changed, "lint-clean + body changed"

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base = {"ts": ts, "kind": "skill-content", "skill": skill_id,
            "improvement": (round(improvement, 4) if improvement is not None else None),
            "decision": why, **(extra_meta or {})}

    if should_apply:
        # Resolve symlinks (resources/skills is a submodule) so the backup lands
        # beside the REAL file we overwrite, not beside a link.
        real_path = skill_path.resolve()
        backup = real_path.with_suffix(f".md.bak-{ts}")
        backup.write_text(skill["raw"], encoding="utf-8")   # backup BEFORE overwrite
        _atomic_write(real_path, evolved_full)    # atomic: never a partial write
        try:
            _log_evolution(config, {**base, "path": str(real_path),
                                    "backup": str(backup), "applied": True})
        except OSError as exc:
            console.print(f"[yellow]⚠ applied, but could not write evolution log: {exc}[/yellow]")
        console.print(
            f"\n[bold green]✓ Applied[/bold green] ({why}, lint passed). "
            f"Backup: {backup.name}\n  Revert: mv {backup} {real_path}"
        )
        return 0

    out_dir = config.cue_repo_path / "evolution" / "proposals" / skill_id.replace("/", "_") / ts
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "evolved_SKILL.md").write_text(evolved_full)
    (out_dir / "baseline_SKILL.md").write_text(skill["raw"])
    reason = ("propose-only (review before apply)" if propose_only
              else "lint/constraints failed" if not candidate_ok
              else "body unchanged" if not changed else why)
    _log_evolution(config, {**base, "path": str(skill_path.resolve()), "applied": False,
                            "reason": reason, "proposal_dir": str(out_dir)})
    console.print(f"\n[yellow]⚠ Not applied ({reason}). Proposal: {out_dir}[/yellow]")
    return 0


def _representative_task(config, skill_id: str) -> str:
    """The most recent real user prompt that triggered a skill_gap for this skill,
    mined from ~/.config/cue/analytics.jsonl (DSPy-free, stdlib only).

    This is what grounds the critic in GENUINE Claude Code usage: the writer's
    rewrite is judged by how it behaves on the very task that exposed the gap.
    Returns "" when there's no usable history (fresh machine, or the gap carried
    no first_prompt) — the critic then falls back to text-only review.
    """
    path = config.analytics_log
    if not path.exists():
        return ""
    best_ts, best_prompt = "", ""
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                if '"skill_gap"' not in line:
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if ev.get("event") != "skill_gap" or ev.get("skill") != skill_id:
                    continue
                fp = (ev.get("first_prompt") or "").strip()
                ts = ev.get("ts", "")
                # ISO-8601 ts strings sort lexicographically by recency.
                if fp and ts >= best_ts:
                    best_ts, best_prompt = ts, fp
    except OSError:
        return ""
    return best_prompt


def evolve(
    skill_id: str,
    iterations: int = 10,
    eval_source: str = "synthetic",
    dataset_path: Optional[str] = None,
    optimizer_model: Optional[str] = None,
    eval_model: Optional[str] = None,
    cue_repo: Optional[str] = None,
    dry_run: bool = False,
    use_claude_code: bool = False,
    optimizer: str = "gepa",
    propose_only: bool = False,
    metric: Optional[str] = None,
) -> int:
    """Main evolution loop. Returns a process exit code."""

    config = CueEvolutionConfig(iterations=iterations)
    if cue_repo:
        config.cue_repo_path = Path(cue_repo)
    # Quality signal for GEPA + holdout: "overlap" (keyword proxy, offline, the
    # default) or "judge" (the multi-dimensional LLMJudge — a real behavioral
    # signal, one eval call per scored example). CLI/env overridable.
    metric_mode = (metric or os.getenv("CUE_EVOLVE_METRIC", "overlap")).lower()
    # --use-claude-code: run the whole optimizer through headless `claude -p`
    # (no separate API key). Explicit --optimizer-model/--eval-model still win.
    if use_claude_code:
        optimizer_model = optimizer_model or "claude-code/sonnet"
        eval_model = eval_model or "claude-code/sonnet"
        # Independent reviewer = a DIFFERENT, stronger model (opus) on the keyless
        # backend, so the single-shot gate isn't sonnet grading sonnet's own work.
        config.reviewer_model = config.reviewer_model if config.reviewer_model.startswith(
            "claude-code/") else "claude-code/opus"
    if optimizer_model:
        config.optimizer_model = optimizer_model
    if eval_model:
        # --eval-model drives BOTH scoring and dataset/judge generation, so an
        # override doesn't leave judge_model pointed at the default provider.
        config.eval_model = eval_model
        config.judge_model = eval_model

    console.print(
        f"\n[bold cyan]🧬 cue skill-content evolution[/bold cyan] — skill: [bold]{skill_id}[/bold]\n"
    )

    # ── 1. Find + load the skill ────────────────────────────────────────
    skill_path = find_skill(skill_id, config.skills_root)
    if not skill_path:
        console.print(f"[red]✗ Skill '{skill_id}' not found under {config.skills_root}[/red]")
        return 1

    skill = load_skill(skill_path)
    console.print(f"  Loaded: {skill_path.relative_to(config.cue_repo_path)}")
    console.print(f"  Name: {skill['name']}")
    console.print(f"  Body size: {len(skill['body']):,} chars")

    # ── 2. Baseline constraint check (incl. real `cue lint-skill`) ───────
    console.print("\n[bold]Baseline constraints[/bold]")
    validator = ConstraintValidator(config)
    baseline_results = validator.validate_all(skill["body"], skill["raw"])
    baseline_ok = _print_constraints(baseline_results)
    if not baseline_ok:
        console.print(
            "[yellow]⚠ Baseline skill already violates a constraint — proceeding anyway[/yellow]"
        )

    if dry_run:
        console.print("\n[bold green]DRY RUN — cue wiring validated.[/bold green]")
        console.print(f"  Optimizer: {optimizer}")
        if optimizer == "single-shot":
            console.print(f"  Would run a writer→lint→critic loop (≤{config.writer_loop_rounds} "
                          f"round(s)) of `claude -p` calls ({claude_or_model(config)}), no DSPy/dataset")
        else:
            console.print(f"  Would build eval dataset (source: {eval_source})")
            console.print(f"  Would run GEPA ({iterations} iters, optimizer={config.optimizer_model})")
            console.print(f"  Metric: {'LLMJudge (multi-dimensional)' if metric_mode == 'judge' else 'keyword-overlap proxy'}")
            if config.optimizer_model.startswith("claude-code/"):
                console.print("  LM backend: headless `claude -p` — no API key needed")
        console.print(f"  Would auto-apply IF candidate improves AND `cue lint-skill` passes")
        console.print(f"  Backups + log → {config.evolution_log}")
        return 0

    # ── Single-shot optimizer: a short writer→lint→critic loop of claude -p ──
    #    calls, no DSPy, no dataset, no key. This is the path the Stop-hook loop
    #    runs. The writer proposes a body, the cue gate lints it, an INDEPENDENT
    #    critic (reviewer_model, not the writer) judges it, and the writer retries
    #    with the lint errors + critic fixes until BETTER or the round budget ends.
    if optimizer == "single-shot":
        from evolution.skills.reflective import writer_critic_loop
        console.print(f"\n[bold cyan]Writer→lint→critic loop[/bold cyan] "
                      f"(≤{config.writer_loop_rounds} round(s), {claude_or_model(config)} writer / "
                      f"{claude_model_name(config.reviewer_model)} critic)...")

        def _validate(body: str) -> dict:
            """Run the full cue constraint gate on a candidate body and package
            the result for the loop: pass/fail, the per-constraint evidence the
            critic reads, and the failing-constraint messages the writer repairs."""
            full = reassemble_skill(skill["frontmatter"], body)
            results = validator.validate_all(body, full, baseline_body=skill["body"])
            ok = all(c.passed for c in results)
            evidence = "; ".join(f"{c.constraint_name}: {'pass' if c.passed else 'FAIL'}"
                                 for c in results)
            lint_errors = "; ".join(f"{c.constraint_name}: {c.message}"
                                    for c in results if not c.passed)
            return {"ok": ok, "results": results, "evidence": evidence, "lint_errors": lint_errors}

        # Ground the critic in real usage: the most recent task that flagged this
        # skill as a gap (mined from analytics.jsonl). "" → text-only review.
        task_input = _representative_task(config, skill_id)
        if task_input:
            console.print(f"  [dim]grounding critic on a real mined task "
                          f"({len(task_input)} chars)[/dim]")

        # The loop is propose-only-agnostic: it always iterates writer→critic to
        # produce the best proposal; _finalize (below) is what refuses to APPLY
        # when propose_only is set. So propose_only is NOT passed to the loop.
        loop = writer_critic_loop(
            skill, config, validate_fn=_validate, max_rounds=config.writer_loop_rounds,
            task_input=task_input, console=console)
        evolved_body = loop["body"]
        console.print("\n[bold]Final candidate constraints[/bold]")
        candidate_ok = (_print_constraints(loop["results"]) if loop["results"] is not None
                        else False)

        # The loop always returns an explicit quality_ok bool from the critic
        # (or False when nothing changed / no candidate), so _finalize never falls
        # through to its no-judge branch. In propose-only nothing is applied
        # regardless, but the verdict is still logged for review.
        quality_ok = loop["quality_ok"]
        judge_reason = loop["judge_reason"]

        return _finalize(
            config, skill_id, skill, skill_path, evolved_body, candidate_ok, improvement=None,
            quality_ok=quality_ok, propose_only=propose_only,
            extra_meta={"optimizer": "writer-loop", "optimizer_model": config.optimizer_model,
                        "rounds": loop["rounds"], "baseline_size": len(skill["body"]),
                        "evolved_size": len(evolved_body), "judge": judge_reason})

    # ── Heavy imports happen ONLY for a real GEPA run ────────────────────
    try:
        import dspy  # noqa: F401
    except ImportError:
        console.print(
            "[red]✗ DSPy not installed.[/red] Install the optimize extra:\n"
            "    pip install -e 'evolution[optimize]'\n"
            "  (the --dry-run path needs no install.)"
        )
        return 2

    from evolution.core.dataset_builder import (
        SyntheticDatasetBuilder,
        EvalDataset,
        GoldenDatasetLoader,
    )
    from evolution.core.fitness import skill_fitness_metric, make_judge_metric
    from evolution.skills.skill_module import SkillModule

    # Pick the quality signal: keyword-overlap proxy (offline default) or the
    # LLMJudge composite (a real behavioral signal, opt-in via --metric judge).
    if metric_mode == "judge":
        fitness_metric = make_judge_metric(config, skill_text=skill["body"])
        console.print("  Metric: [bold]LLMJudge[/bold] (multi-dimensional, 1 eval call/example)")
    else:
        fitness_metric = skill_fitness_metric
        console.print("  Metric: keyword-overlap proxy (offline; use --metric judge for LLMJudge)")

    # ── 3. Build / load eval dataset ─────────────────────────────────────
    console.print(f"\n[bold]Building eval dataset[/bold] (source: {eval_source})")
    if eval_source == "sessiondb":
        from evolution.core.external_importers import build_dataset_from_external
        save_path = Path(dataset_path) if dataset_path else Path("datasets") / skill_id.replace("/", "_")
        dataset = build_dataset_from_external(
            skill_name=skill["name"] or skill_id,
            skill_text=skill["raw"],
            sources=["claude-code", "copilot", "hermes"],
            output_path=save_path,
            model=config.eval_model,
        )
        if not dataset.all_examples:
            console.print("[red]✗ No relevant examples mined from session history[/red]")
            return 1
    elif eval_source == "golden" and dataset_path:
        dataset = GoldenDatasetLoader.load(Path(dataset_path))
    else:  # synthetic
        builder = SyntheticDatasetBuilder(config)
        dataset = builder.generate(artifact_text=skill["raw"], artifact_type="skill")
        save_path = Path("datasets") / skill_id.replace("/", "_")
        dataset.save(save_path)
    console.print(
        f"  Split: {len(dataset.train)} train / {len(dataset.val)} val / {len(dataset.holdout)} holdout"
    )

    # ── 4. GEPA optimization ─────────────────────────────────────────────
    from evolution.core.claude_lm import make_lm
    lm = make_lm(config.eval_model, config)
    dspy.configure(lm=lm)
    baseline_module = SkillModule(skill["body"])
    trainset = dataset.to_dspy_examples("train")
    valset = dataset.to_dspy_examples("val")

    console.print(f"\n[bold cyan]Running GEPA ({iterations} iterations)...[/bold cyan]")
    start = time.time()
    # GEPA needs a budget (max_metric_calls) and a reflection LM; scale the
    # budget with --iterations so a small run stays cheap.
    reflection_lm = make_lm(config.optimizer_model, config)
    budget = max(6, iterations * 6)
    try:
        optimizer = dspy.GEPA(
            metric=fitness_metric,
            reflection_lm=reflection_lm,
            max_metric_calls=budget,
            track_stats=False,
        )
        optimized = optimizer.compile(baseline_module, trainset=trainset, valset=valset)
    except Exception as e:
        console.print(f"[yellow]GEPA unavailable ({e}); falling back to MIPROv2[/yellow]")
        # Explicit tiny budget (not auto='light' = 10 trials) so it completes
        # even on a rate-limited free endpoint.
        optimizer = dspy.MIPROv2(metric=fitness_metric, auto=None, num_candidates=2)
        optimized = optimizer.compile(
            baseline_module, trainset=trainset, valset=valset,
            num_trials=max(2, iterations), max_bootstrapped_demos=1,
            max_labeled_demos=1, requires_permission_to_run=False,
        )
    elapsed = time.time() - start

    evolved_body = optimized.skill_text
    evolved_full = reassemble_skill(skill["frontmatter"], evolved_body)

    # ── 5. Validate the candidate (incl. lint gate) ──────────────────────
    console.print("\n[bold]Candidate constraints[/bold]")
    candidate_results = validator.validate_all(evolved_body, evolved_full, baseline_body=skill["body"])
    candidate_ok = _print_constraints(candidate_results)

    # ── 6. Holdout comparison ────────────────────────────────────────────
    holdout = dataset.to_dspy_examples("holdout")
    base_scores, evo_scores = [], []
    for ex in holdout:
        with dspy.context(lm=lm):
            base_scores.append(fitness_metric(ex, baseline_module(task_input=ex.task_input)))
            evo_scores.append(fitness_metric(ex, optimized(task_input=ex.task_input)))
    avg_base = sum(base_scores) / max(1, len(base_scores))
    avg_evo = sum(evo_scores) / max(1, len(evo_scores))
    improvement = avg_evo - avg_base

    table = Table(title="Evolution Results")
    table.add_column("Metric", style="bold")
    table.add_column("Baseline", justify="right")
    table.add_column("Evolved", justify="right")
    table.add_column("Change", justify="right")
    chg = "green" if improvement > 0 else "red"
    table.add_row("Holdout", f"{avg_base:.3f}", f"{avg_evo:.3f}", f"[{chg}]{improvement:+.3f}[/{chg}]")
    table.add_row("Body size", f"{len(skill['body']):,}", f"{len(evolved_body):,}",
                  f"{len(evolved_body) - len(skill['body']):+,}")
    console.print()
    console.print(table)

    # ── 7. Decide: auto-apply vs. proposal (shared with single-shot) ─────
    return _finalize(
        config, skill_id, skill, skill_path, evolved_body, candidate_ok, improvement,
        extra_meta={
            "optimizer": "gepa", "optimizer_model": config.optimizer_model,
            "baseline_score": round(avg_base, 4), "evolved_score": round(avg_evo, 4),
            "baseline_size": len(skill["body"]), "evolved_size": len(evolved_body),
            "iterations": iterations, "elapsed_s": round(elapsed, 1),
        })


@click.command()
@click.option("--skill", "skill_id", required=True, help="cue skill id (category/slug or slug)")
@click.option("--iterations", default=10, help="GEPA iterations")
@click.option("--eval-source", default="synthetic",
              type=click.Choice(["synthetic", "golden", "sessiondb"]),
              help="Where eval examples come from")
@click.option("--dataset-path", default=None, help="Path to a golden dataset / sessiondb output dir")
@click.option("--optimizer-model", default=None, help="Override GEPA reflection model")
@click.option("--eval-model", default=None, help="Override eval/judge model")
@click.option("--cue-repo", default=None, help="Path to the cue repo (else auto-discovered)")
@click.option("--optimizer", default="gepa", type=click.Choice(["gepa", "single-shot"]),
              help="gepa = iterative DSPy/GEPA (slow, needs dspy); single-shot = one claude -p call (fast, keyless)")
@click.option("--metric", default=None, type=click.Choice(["overlap", "judge"]),
              help="GEPA/holdout quality signal: overlap (keyword proxy, offline default) or judge (LLMJudge, 1 eval call/example)")
@click.option("--use-claude-code", is_flag=True,
              help="Run GEPA through headless `claude -p` — no separate API key (implied by single-shot)")
@click.option("--propose-only", is_flag=True,
              help="Never auto-apply; always write a proposal for human review")
@click.option("--dry-run", is_flag=True, help="Validate cue wiring without optimizing (no LLM, no install)")
def main(skill_id, iterations, eval_source, dataset_path, optimizer_model, eval_model,
         cue_repo, optimizer, metric, use_claude_code, propose_only, dry_run):
    """Evolve a cue skill's content, gated by `cue lint-skill`. Two optimizers:
    GEPA (DSPy, iterative) or single-shot (one `claude -p` call, keyless)."""
    # single-shot always runs on claude -p; default its model accordingly.
    if optimizer == "single-shot" and not optimizer_model:
        optimizer_model = "claude-code/sonnet"
    sys.exit(evolve(
        skill_id=skill_id, iterations=iterations, eval_source=eval_source,
        dataset_path=dataset_path, optimizer_model=optimizer_model,
        eval_model=eval_model, cue_repo=cue_repo, dry_run=dry_run,
        use_claude_code=use_claude_code, optimizer=optimizer, propose_only=propose_only,
        metric=metric,
    ))


if __name__ == "__main__":
    main()
