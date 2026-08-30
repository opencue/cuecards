"""Auto-trigger: turn accumulated skill_gap signals into a skill evolution.

The cue self-learner hook (resources/hooks/profile-self-improve.sh) appends
`skill_gap` events to ~/.config/cue/analytics.jsonl as Claude Code is used. This
module reads those, picks the most-flagged skill that actually exists (and isn't
in cooldown), and runs the single-shot optimizer on it. That closes the loop:
"the more a skill falls short in real use, the sooner it gets improved."

Safety (this MUTATES skills, so it's stricter than the capture hook):
  * actual evolution requires BOTH opt-in flags:
      ~/.config/cue/.auto-improve-enabled   (the self-learner master switch)
      ~/.config/cue/.auto-evolve-enabled    (skill-content mutation switch)
  * default is --propose-only (unattended runs propose; a human applies),
    overridable with --apply (which still gates on lint + the self-judge).
  * a per-skill cooldown stops re-evolving the same skill every run.

`--dry-run` (no flags needed) just prints the selection — this is the testable
core (CHECK: seeded skill_gap events → correct skill chosen).

stdlib-only + lazy import of evolve(), so selection is importable everywhere.
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import click

from evolution.core.config import CueEvolutionConfig
from evolution.core.cue_skill import find_skill


def _parse_ts(ts: str) -> float:
    """Best-effort parse of an ISO-ish ts → epoch seconds (0 on failure)."""
    if not ts:
        return 0.0
    try:
        s = ts.replace("Z", "+00:00")
        return datetime.fromisoformat(s).timestamp()
    except ValueError:
        # compact form 20260609T123715Z
        try:
            return datetime.strptime(ts, "%Y%m%dT%H%M%S%z").timestamp()
        except ValueError:
            return 0.0


def _skills_from_event(ev: dict) -> list[str]:
    """Skills an event attributes a gap to. Three sources, all counted:

    - critic / learning events: the explicit `skill` field (highest signal).
    - L1 hook events: any `soft-load:<slug>` in the `signals` array — a skill
      the agent had to demand at runtime because the profile lacked it. The slug
      is a bare name (e.g. "coolify"); selection's find_skill resolves it.

    Other L1 signals (tool-error, retry-loop, …) carry no skill attribution and
    are intentionally not counted here — they need the critic to name a target.
    """
    skills: list[str] = []
    skill = (ev.get("skill") or "").strip()
    if skill and skill.upper() != "NONE":
        skills.append(skill)
    for sig in ev.get("signals") or []:
        if isinstance(sig, str) and sig.startswith("soft-load:"):
            slug = sig.split(":", 1)[1].strip()
            if slug:
                skills.append(slug)
    # One event = at most one vote per skill. If both the `skill` field and a
    # soft-load signal name the same skill, that's still one gap, not two.
    return list(dict.fromkeys(skills))


def count_skill_gaps(analytics_path: Path, window_days: int = 7, now: float | None = None) -> dict:
    """Count skill_gap events per skill within the window. Credits the critic's
    `skill` field, `source:"learning"` events, AND L1 `soft-load:<slug>` signals
    so the loop no longer hinges on a single LLM critic call. Returns
    {skill_id: count}."""
    if not analytics_path.exists():
        return {}
    now = now if now is not None else datetime.now(timezone.utc).timestamp()
    cutoff = now - window_days * 86400
    counts: dict[str, int] = {}
    with open(analytics_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or '"skill_gap"' not in line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if ev.get("event") != "skill_gap":
                continue
            if _parse_ts(ev.get("ts", "")) < cutoff:
                continue
            for skill in _skills_from_event(ev):
                counts[skill] = counts.get(skill, 0) + 1
    return counts


def _recently_evolved(evolution_log: Path, cooldown_days: int, now: float) -> set:
    """Skills with an evolution-log entry inside the cooldown window."""
    if cooldown_days <= 0 or not evolution_log.exists():
        return set()
    cutoff = now - cooldown_days * 86400
    recent = set()
    with open(evolution_log, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get("kind") == "skill-content" and _parse_ts(e.get("ts", "")) >= cutoff:
                if e.get("skill"):
                    recent.add(e["skill"])
    return recent


def select_skill(config: CueEvolutionConfig, window_days: int = 7,
                 cooldown_days: int = 7, now: float | None = None):
    """Pick the most-flagged skill that exists in the repo and isn't in cooldown.

    Returns (skill_id, count) or (None, 0) if nothing qualifies.
    """
    now = now if now is not None else datetime.now(timezone.utc).timestamp()
    counts = count_skill_gaps(config.analytics_log, window_days, now)
    if not counts:
        return None, 0
    cooling = _recently_evolved(config.evolution_log, cooldown_days, now)
    # Highest count first; ties broken by skill id for determinism.
    for skill_id, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])):
        if skill_id in cooling:
            continue
        if find_skill(skill_id, config.skills_root):
            return skill_id, count
    return None, 0


@click.command()
@click.option("--window-days", default=7, help="Look back this many days of skill_gap events")
@click.option("--cooldown-days", default=7, help="Don't re-evolve a skill evolved within this window")
@click.option("--apply", "do_apply", is_flag=True,
              help="Allow auto-apply (still gated by lint + self-judge). Default: propose-only.")
@click.option("--cue-repo", default=None, help="Path to the cue repo (else auto-discovered)")
@click.option("--dry-run", is_flag=True, help="Just print the selection; no flags needed, no evolve")
def main(window_days, cooldown_days, do_apply, cue_repo, dry_run):
    """Pick the most-flagged skill from skill_gap signals and evolve it (single-shot)."""
    config = CueEvolutionConfig()
    if cue_repo:
        config.cue_repo_path = Path(cue_repo)

    # Canary first: roll back any recently-applied skill that drew a fresh spike
    # of friction after it landed. Reverting a bad change is always safe, so it
    # runs every tick (even in --dry-run, where it only reports).
    from evolution.core.canary import check_canaries
    for a in check_canaries(config, apply_revert=not dry_run):
        verb = "reverted" if a["reverted"] else ("would revert" if dry_run else "revert FAILED for")
        click.echo(f"auto-evolve: canary {verb} '{a['skill']}' ({a['friction']} fresh gap(s) after apply)")

    skill_id, count = select_skill(config, window_days, cooldown_days)
    if not skill_id:
        click.echo("auto-evolve: no qualifying skill (no recent gaps, or all in cooldown).")
        sys.exit(0)
    click.echo(f"auto-evolve: selected '{skill_id}' ({count} gap signal(s) in {window_days}d)")

    if dry_run:
        click.echo("  (--dry-run: selection only, not evolving)")
        sys.exit(0)

    # Mutation requires BOTH opt-in flags.
    cfg_dir = Path(os.getenv("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "cue"
    if not (cfg_dir / ".auto-improve-enabled").exists() or not (cfg_dir / ".auto-evolve-enabled").exists():
        click.echo("  auto-evolve disabled — touch ~/.config/cue/.auto-improve-enabled AND "
                   ".auto-evolve-enabled to enable (or use --dry-run).")
        sys.exit(0)

    from evolution.skills.evolve_skill import evolve
    sys.exit(evolve(
        skill_id=skill_id, optimizer="single-shot",
        optimizer_model="claude-code/sonnet", use_claude_code=True,
        propose_only=not do_apply, cue_repo=cue_repo,
    ))


if __name__ == "__main__":
    main()
