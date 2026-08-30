"""Post-apply canary + auto-revert for evolved skills.

An applied evolution is a bet that the rewrite helps. This closes the loop: it
watches the skills that were auto-APPLIED recently and, if real usage produces a
spike of fresh `skill_gap` friction for that skill AFTER the apply, restores the
backup. A rewrite that the gates approved but that degrades real behavior gets
rolled back on the next auto-evolve tick instead of festering.

Deterministic and offline-testable: reads the same ~/.config/cue/evolution-log
.jsonl (apply records, each carrying a `backup` path) and analytics.jsonl
(skill_gap events) the rest of the loop uses; the only side effect is restoring a
backup file and appending a revert record.

Safety:
  * only watches APPLIED entries inside `window_hours` (never reverts old, settled
    changes).
  * skips a skill already reverted after its apply (no double-revert / flapping).
  * needs the backup file to still exist; missing backup → skip, never error.
  * counts ONLY friction newer than the apply timestamp — pre-existing gaps that
    triggered the evolution in the first place must not cause an instant revert.
"""

import json
from pathlib import Path
from datetime import datetime, timezone

from evolution.core.config import CueEvolutionConfig
from evolution.auto_evolve import _parse_ts, _skills_from_event


def _read_jsonl(path: Path):
    if not path.exists():
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def _applied_under_watch(evolution_log: Path, window_start: float):
    """Applied skill-content entries within the window, minus any already
    reverted afterwards. Returns {skill_id: entry} keeping the latest apply."""
    applies: dict[str, dict] = {}
    reverts: dict[str, float] = {}
    for e in _read_jsonl(evolution_log):
        ts = _parse_ts(e.get("ts", ""))
        if e.get("kind") == "skill-content" and e.get("applied") and e.get("backup"):
            if ts >= window_start and e.get("skill"):
                prev = applies.get(e["skill"])
                if not prev or ts >= _parse_ts(prev.get("ts", "")):
                    applies[e["skill"]] = e
        elif e.get("kind") == "skill-content-revert" and e.get("skill"):
            reverts[e["skill"]] = max(reverts.get(e["skill"], 0.0), ts)
    # Drop any whose latest revert is at/after its apply (already rolled back).
    return {
        skill: entry for skill, entry in applies.items()
        if reverts.get(skill, 0.0) < _parse_ts(entry.get("ts", ""))
    }


def _friction_after(analytics_log: Path, skill_id: str, after_ts: float) -> int:
    """Count skill_gap events attributing a gap to `skill_id`, newer than the
    apply timestamp."""
    n = 0
    for ev in _read_jsonl(analytics_log):
        if ev.get("event") != "skill_gap":
            continue
        if _parse_ts(ev.get("ts", "")) <= after_ts:
            continue
        if skill_id in _skills_from_event(ev):
            n += 1
    return n


def check_canaries(config: CueEvolutionConfig, window_hours: int = 48,
                   threshold: int = 2, now: float | None = None,
                   apply_revert: bool = True) -> list[dict]:
    """Revert recently-applied skills that drew >= `threshold` fresh gaps.

    Returns a list of {skill, friction, backup, path, reverted} dicts for every
    watched skill that crossed the threshold. With apply_revert=False, reports
    candidates without touching files (dry-run).
    """
    now = now if now is not None else datetime.now(timezone.utc).timestamp()
    window_start = now - window_hours * 3600
    watched = _applied_under_watch(config.evolution_log, window_start)
    actions: list[dict] = []
    for skill_id, entry in watched.items():
        friction = _friction_after(config.analytics_log, skill_id, _parse_ts(entry["ts"]))
        if friction < threshold:
            continue
        backup = Path(entry["backup"])
        path = Path(entry["path"])
        reverted = False
        if apply_revert and backup.exists():
            try:
                path.write_text(backup.read_text(encoding="utf-8"), encoding="utf-8")
                reverted = True
            except OSError:
                reverted = False
            # The restore is what matters; a log-write failure must not flip the
            # reported outcome (else the revert message is suppressed and the next
            # tick re-reverts the same already-restored file every run).
            if reverted:
                try:
                    _log_revert(config.evolution_log, skill_id, entry, friction, now)
                except OSError:
                    pass
        actions.append({"skill": skill_id, "friction": friction,
                        "backup": str(backup), "path": str(path), "reverted": reverted})
    return actions


def _log_revert(evolution_log: Path, skill_id: str, apply_entry: dict,
                friction: int, now: float) -> None:
    evolution_log.parent.mkdir(parents=True, exist_ok=True)
    ts = datetime.fromtimestamp(now, tz=timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    with open(evolution_log, "a", encoding="utf-8") as f:
        f.write(json.dumps({
            "ts": ts, "kind": "skill-content-revert", "skill": skill_id,
            "reason": f"canary: {friction} fresh gap(s) after apply",
            "restored_from": apply_entry.get("backup"),
            "path": apply_entry.get("path"), "applied": False,
        }) + "\n")
