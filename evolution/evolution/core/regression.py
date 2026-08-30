"""Critical-token regression gate for evolved skill bodies.

A body rewrite is allowed to rephrase prose freely, but it must NOT silently drop
the load-bearing tokens an agent actually executes: inline-code spans, shell
commands, file paths, and URLs. The keyword-overlap / LLM-judge signals don't
catch this — a rewrite can read "better" while having deleted the one `cue
lint-skill {path} --fix` line the skill exists to teach.

This gate is deterministic and offline (no LLM, no DSPy): extract the critical
tokens from the baseline body, then require each to survive as a substring of the
evolved body. Anything missing is a regression.

Tuned to be conservative about false positives: only tokens that look executable
or referential are tracked (inline code, paths with a slash, URLs, long flags),
not ordinary words.
"""

import re

# Inline code: `...` (single backtick spans). The most reliable "the author
# marked this as literal" signal in a SKILL.md.
_INLINE_CODE = re.compile(r"`([^`\n]+)`")
# URLs.
_URL = re.compile(r"https?://[^\s)\]`'\"<>]+")
# Path-ish bare tokens (contain a slash, look like a path/command, no spaces).
# e.g. resources/hooks/auto-evolve.sh, ~/.config/cue/analytics.jsonl
_PATH = re.compile(r"(?<![\w`])((?:~|\.{0,2}/)?[\w.-]+/[\w./~-]+)")


def critical_tokens(body: str) -> set[str]:
    """Extract the must-survive tokens from a skill body.

    Returns a set of literal strings (inline-code spans, URLs, path-like tokens)
    that a faithful rewrite is expected to preserve verbatim. Short or trivial
    fragments are dropped to keep the gate from firing on noise.
    """
    tokens: set[str] = set()
    for m in _INLINE_CODE.finditer(body):
        tok = m.group(1).strip()
        if len(tok) >= 3:
            tokens.add(tok)
    for m in _URL.finditer(body):
        tokens.add(m.group(0).rstrip(".,;"))
    for m in _PATH.finditer(body):
        tok = m.group(1).strip()
        # A real path/command reference: has a slash and is not just "a/b".
        if "/" in tok and len(tok) >= 6 and not tok.startswith("http"):
            tokens.add(tok)
    return tokens


def check_preservation(baseline_body: str, evolved_body: str) -> tuple[bool, list[str]]:
    """Did the evolved body keep every critical token from the baseline?

    Returns (ok, dropped) where `dropped` is the sorted list of baseline critical
    tokens absent from the evolved body. `ok` is True iff nothing was dropped.
    """
    baseline_tokens = critical_tokens(baseline_body)
    dropped = sorted(tok for tok in baseline_tokens if tok not in evolved_body)
    return (len(dropped) == 0, dropped)
