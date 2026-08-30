"""The `cue lint-skill` gate.

This is cue's substitute for hermes' structural/pytest constraints: a candidate
SKILL.md may be auto-applied ONLY if it passes `cue lint-skill`. We define
"passes" exactly as the cue CLI does (src/commands/lint-skill.ts): no
`error`-severity diagnostics. We also surface the 0-100 quality score so a
caller can require non-regression vs. the baseline.

No DSPy import — usable in the offline / dry-run path.
"""

import json
import shlex
import subprocess
import tempfile
from pathlib import Path
from dataclasses import dataclass, field

from evolution.core.config import CueEvolutionConfig


@dataclass
class LintResult:
    """Parsed result of `cue lint-skill <path> --json`."""

    ok: bool                       # True = no error-severity diagnostics
    score: int = 0                 # 0-100 quality score
    errors: list = field(default_factory=list)    # error-severity messages
    warnings: list = field(default_factory=list)  # warning-severity messages
    raw: str = ""                  # raw stdout (for debugging)
    ran: bool = True               # False if the lint command could not run

    @property
    def message(self) -> str:
        if not self.ran:
            return "lint command did not run"
        if self.ok:
            return f"score {self.score}/100, {len(self.warnings)} warning(s)"
        return f"score {self.score}/100, {len(self.errors)} ERROR(s): " + "; ".join(
            self.errors[:3]
        )


def lint_text(text: str, config: CueEvolutionConfig) -> LintResult:
    """Lint a SKILL.md given as a string by writing it to a temp file.

    Used to gate a *candidate* variant before it ever touches the real file.
    """
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / "SKILL.md"
        tmp.write_text(text)
        return lint_path(tmp, config)


def lint_path(path: Path, config: CueEvolutionConfig) -> LintResult:
    """Run `cue lint-skill <path> --json` and parse it.

    Fail-closed: if the lint command can't run, returns ok=False so nothing
    auto-applies on a broken gate.
    """
    # Single-substitution template — use replace (not .format) so stray braces
    # in CUE_LINT_CMD can't raise KeyError and break the fail-closed contract.
    try:
        cmd_str = config.lint_cmd.replace("{path}", shlex.quote(str(path)))
        argv = shlex.split(cmd_str)
    except (ValueError, Exception) as e:  # noqa: BLE001 — any parse error → fail closed
        return LintResult(ok=False, ran=False, raw=f"lint_cmd error: {e}")

    try:
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=120)
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
        return LintResult(ok=False, ran=False, raw=str(e))

    out = proc.stdout.strip()
    try:
        reports = json.loads(out)
    except json.JSONDecodeError:
        # JSON mode always exits 0 and prints JSON; a parse failure means the
        # command surface changed or errored. Fail closed.
        return LintResult(ok=False, ran=False, raw=out or proc.stderr.strip())

    # Defensive: if a future cue exits non-zero, don't trust a (possibly empty)
    # diagnostics list — fail closed regardless of JSON content.
    if proc.returncode != 0:
        return LintResult(ok=False, ran=False, raw=out or proc.stderr.strip())

    if not isinstance(reports, list) or not reports:
        return LintResult(ok=False, ran=False, raw=out)

    # We lint a single file, so take the first report.
    report = reports[0]
    score = int(report.get("score", 0))
    diags = report.get("diagnostics", [])
    errors = [d.get("message", "") for d in diags if d.get("severity") == "error"]
    warnings = [d.get("message", "") for d in diags if d.get("severity") == "warning"]

    return LintResult(
        ok=len(errors) == 0,
        score=score,
        errors=errors,
        warnings=warnings,
        raw=out,
    )
