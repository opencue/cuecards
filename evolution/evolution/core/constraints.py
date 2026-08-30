"""Constraint validators for evolved skill candidates.

Ported from hermes-agent-self-evolution's ConstraintValidator. A candidate
variant must pass ALL constraints before it can be auto-applied. The decisive,
cue-specific gate is `cue lint-skill` (see cue_lint.py); the size/growth/
structure checks are cheap pre-filters that run without spawning the CLI.

No DSPy import — usable in the offline / dry-run path.
"""

from dataclasses import dataclass
from typing import Optional

from evolution.core.config import CueEvolutionConfig
from evolution.core.cue_lint import lint_text
from evolution.core.regression import check_preservation


@dataclass
class ConstraintResult:
    passed: bool
    constraint_name: str
    message: str
    details: Optional[str] = None


class ConstraintValidator:
    """Validates evolved skill candidates against hard constraints."""

    def __init__(self, config: CueEvolutionConfig):
        self.config = config

    def validate_all(
        self,
        candidate_body: str,
        full_skill_text: str,
        baseline_body: Optional[str] = None,
    ) -> list[ConstraintResult]:
        """Run every applicable constraint on a candidate.

        Args:
            candidate_body: the evolved markdown body (no frontmatter).
            full_skill_text: the reassembled SKILL.md (frontmatter + body) —
                what actually gets linted and written.
            baseline_body: the original body, for the growth check.
        """
        results = [
            self._check_size(candidate_body),
            self._check_non_empty(candidate_body),
            self._check_structure(full_skill_text),
        ]
        if baseline_body is not None:
            results.append(self._check_growth(candidate_body, baseline_body))
            results.append(self._check_critical_tokens(candidate_body, baseline_body))
        # The decisive gate: cue's own linter on the reassembled file.
        results.append(self._check_lint(full_skill_text))
        return results

    def _check_critical_tokens(self, body: str, baseline: str) -> ConstraintResult:
        """Regression gate: the rewrite must not drop load-bearing tokens
        (inline-code, commands, paths, URLs) the baseline marked as literal."""
        ok, dropped = check_preservation(baseline, body)
        if ok:
            return ConstraintResult(True, "critical_tokens", "No critical tokens dropped")
        preview = ", ".join(dropped[:5]) + (" …" if len(dropped) > 5 else "")
        return ConstraintResult(
            False, "critical_tokens",
            f"Dropped {len(dropped)} critical token(s): {preview}",
            details="\n".join(dropped),
        )

    def _check_lint(self, full_skill_text: str) -> ConstraintResult:
        res = lint_text(full_skill_text, self.config)
        return ConstraintResult(
            passed=res.ok,
            constraint_name="cue_lint",
            message=res.message,
            details=None if res.ok else res.raw[:500],
        )

    def _check_size(self, body: str) -> ConstraintResult:
        size = len(body)
        limit = self.config.max_skill_size
        if size <= limit:
            return ConstraintResult(True, "size_limit", f"Size OK: {size}/{limit} chars")
        return ConstraintResult(
            False, "size_limit", f"Size exceeded: {size}/{limit} chars ({size - limit} over)"
        )

    def _check_growth(self, body: str, baseline: str) -> ConstraintResult:
        growth = (len(body) - len(baseline)) / max(1, len(baseline))
        max_growth = self.config.max_prompt_growth
        if growth <= max_growth:
            return ConstraintResult(
                True, "growth_limit", f"Growth OK: {growth:+.1%} (max {max_growth:+.1%})"
            )
        return ConstraintResult(
            False, "growth_limit", f"Growth exceeded: {growth:+.1%} (max {max_growth:+.1%})"
        )

    def _check_non_empty(self, body: str) -> ConstraintResult:
        if body.strip():
            return ConstraintResult(True, "non_empty", "Body is non-empty")
        return ConstraintResult(False, "non_empty", "Body is empty")

    def _check_structure(self, full_text: str) -> ConstraintResult:
        has_fm = full_text.lstrip().startswith("---")
        head = full_text[:600] if has_fm else ""
        has_name = "name:" in head
        has_desc = "description:" in head
        if has_fm and has_name and has_desc:
            return ConstraintResult(
                True, "skill_structure", "Valid frontmatter (name + description)"
            )
        missing = []
        if not has_fm:
            missing.append("YAML frontmatter (---)")
        if not has_name:
            missing.append("name field")
        if not has_desc:
            missing.append("description field")
        return ConstraintResult(
            False, "skill_structure", f"Missing: {', '.join(missing)}"
        )
