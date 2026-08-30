"""Real-routing smoke check — the only proxy→Claude transfer test.

The optimizer's whole loop scores a surrogate LLM router, never Claude Code
itself. This module closes the cheapest credible gap: after an apply, it
RE-MATERIALIZES the profile and asserts the evolved trigger/capability text
actually appears in the router tables of the generated CLAUDE.md (what Claude
reads). The pure extractors are offline-tested; locating the materialized file
is best-effort.

The richer check — prompt Claude with a sample task and assert it calls the
Skill tool — is left as a documented MANUAL step (it needs a live `claude`
session and is too flaky to automate): after a smoke pass, run the skill's
trigger phrase in a `cue launch <profile>` session and confirm the Skill fires.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Optional

from evolution.core.config import CueEvolutionConfig

# Headings/markers that bound the router region in a materialized CLAUDE.md.
_ROUTER_MARKERS = (
    "## skill routing", "skill capabilities", "trigger phrase",
    "reach for", "## available skills",
)
# Sections that come AFTER the router block (so we can bound its end).
_AFTER_MARKERS = ("\n## your role", "\n## available commands", "\n## mcp servers")


def extract_router_block(claude_md_text: str) -> str:
    """Return the router region of a materialized CLAUDE.md (capability + trigger
    tables + Available Skills), or '' if no router markers are present."""
    if not claude_md_text:
        return ""
    low = claude_md_text.lower()
    starts = [low.find(m) for m in _ROUTER_MARKERS if m in low]
    if not starts:
        return ""
    start = min(starts)
    bol = claude_md_text.rfind("\n", 0, start) + 1
    ends = [low.find(m, start) for m in _AFTER_MARKERS if low.find(m, start) != -1]
    end = min(ends) if ends else len(claude_md_text)
    return claude_md_text[bol:end].strip()


def router_mentions(claude_md_text: str, needle: str) -> bool:
    """True if `needle` (a trigger phrase / capability / skill slug) appears in the
    router region — falls back to the whole document if no router block parses."""
    if not needle:
        return False
    block = extract_router_block(claude_md_text)
    hay = (block or claude_md_text).lower()
    return needle.strip().lower() in hay


def find_materialized_claude_md(config: CueEvolutionConfig, profile: str) -> Optional[Path]:
    """Best-effort search for the profile's generated CLAUDE.md across the
    runtime locations cue writes to."""
    import os
    xdg = os.getenv("XDG_CONFIG_HOME", str(Path.home() / ".config"))
    candidates = [
        Path(xdg) / "cue" / "runtime" / profile / "CLAUDE.md",
        Path.home() / ".config" / "cue" / "runtime" / profile / "CLAUDE.md",
        Path.home() / ".claude" / "CLAUDE.md",
        Path.cwd() / ".claude" / "CLAUDE.md",
    ]
    for c in candidates:
        try:
            if c.is_file() and f"profile={profile}" in c.read_text(encoding="utf-8")[:400]:
                return c
        except OSError:
            continue
    # last resort: any runtime CLAUDE.md stamped for this profile
    runtime = Path(xdg) / "cue" / "runtime"
    if runtime.exists():
        for c in runtime.rglob("CLAUDE.md"):
            try:
                if f"profile={profile}" in c.read_text(encoding="utf-8")[:400]:
                    return c
            except OSError:
                continue
    return None


def latest_apply_phrases(config: CueEvolutionConfig, profile: str) -> list[str]:
    """Phrases/capabilities from the most recent APPLIED persona-routing entry for
    `profile` in the evolution log — what the last live apply should have landed
    in CLAUDE.md. Lets the smoke harness self-assert without a hand-set phrase."""
    log = config.evolution_log
    if not log.exists():
        return []
    last = None
    for line in log.read_text(encoding="utf-8").splitlines():
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        if (e.get("kind") == "persona-routing" and e.get("profile") == profile
                and e.get("applied") and e.get("entries_added")):
            last = e
    if not last:
        return []
    out = []
    for r in last["entries_added"]:
        v = r.get("phrase") or r.get("capability")
        if v:
            out.append(v)
    return out


def smoke_check(config: CueEvolutionConfig, profile: str, expect_phrases: list[str]) -> dict:
    """Re-materialize `profile` (best-effort) and assert each phrase reaches the
    router block of the generated CLAUDE.md. Returns a structured report."""
    materialized = False
    try:
        proc = subprocess.run(["cue", "materialize", profile], cwd=str(config.cue_repo_path),
                              capture_output=True, text=True, timeout=120)
        materialized = proc.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        materialized = False

    md_path = find_materialized_claude_md(config, profile)
    text = md_path.read_text(encoding="utf-8") if md_path else ""
    found = {p: router_mentions(text, p) for p in expect_phrases}
    return {
        "materialized": materialized,
        "claude_md": str(md_path) if md_path else None,
        "router_found": bool(extract_router_block(text)),
        "phrases": found,
        "all_present": bool(found) and all(found.values()),
    }


def main() -> int:
    import click
    from rich.console import Console
    console = Console()

    @click.command()
    @click.option("--profile", required=True)
    @click.option("--expect", "expect", multiple=True,
                  help="A trigger phrase/capability that should appear in the router (repeatable)")
    @click.option("--from-log", is_flag=True,
                  help="Assert the phrases from the last APPLIED persona-routing entry for this profile")
    @click.option("--cue-repo", default=None)
    def _cmd(profile, expect, from_log, cue_repo):
        cfg = CueEvolutionConfig()
        if cue_repo:
            cfg.cue_repo_path = Path(cue_repo)
        phrases = list(expect)
        if from_log:
            phrases += latest_apply_phrases(cfg, profile)
        if not phrases:
            console.print("[yellow]Nothing to assert — pass --expect <phrase> or --from-log "
                          "(after a live apply).[/yellow]")
            raise SystemExit(2)
        rep = smoke_check(cfg, profile, phrases)
        console.print(rep)
        console.print(f"\n[bold]{'✓ PASS' if rep['all_present'] else '✗ FAIL'}[/bold] — "
                      "router block "
                      + ("contains all phrases" if rep["all_present"] else "missing phrases / not found"))
        if rep["all_present"]:
            console.print("[dim]Manual follow-up: run a trigger phrase in `cue launch "
                          f"{profile}` and confirm the Skill tool fires.[/dim]")
        raise SystemExit(0 if rep["all_present"] else 1)

    return _cmd()


if __name__ == "__main__":
    main()
