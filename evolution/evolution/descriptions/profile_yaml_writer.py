"""Turn an evolved description into per-profile `persona_routing:` rows and
splice them into profiles/<profile>/profile.yaml WITHOUT disturbing anything
else (comments, key order, block scalars).

Why not a YAML round-trip? ruamel.yaml is not a dependency and PyYAML's
safe_load/dump destroys comments and reorders keys. A 92-line hand-edited
profile.yaml with inline `# ...` comments must survive verbatim. So we operate
on the raw text: locate ONLY the `persona_routing:` block (line-based), re-emit
just that block with a hand-rolled emitter (full control over the house 2-space
list style), and leave every other byte untouched.

No DSPy / LLM import — usable in the offline / dry-run path and unit-tested
without a key.

`persona_routing` row shape (profiles/schema.json $defs/PersonaRoutingEntry):
  - {phrase: "...", skill: <slug>, note?: "..."}      # reactive (user-said)
  - {capability: "...", skill: <slug>, note?: "..."}  # proactive (task shape)
The trigger/capability extraction mirrors src/lib/skill-router.ts:parseDescription
so the rows we synthesize match exactly what the materializer parses out of a
SKILL.md description.
"""

from __future__ import annotations

import re
import yaml
from pathlib import Path
from typing import Optional

from evolution.core.atomic_io import atomic_write_text


# ── description -> routing rows (port of skill-router.ts:parseDescription) ──

# Matches both straight and curly quotes (mirrors QUOTED_RE in skill-router.ts).
_QUOTED_RE = re.compile(r'["“]([^"”]+?)["”]')
_TRIGGER_PREFIX_RE = re.compile(
    r"\buse\s+when\s+(?:the\s+)?(?:user|caller|operator)\s+"
    r"(?:says?|asks?(?:\s+for)?|wants?(?:\s+to)?|mentions?|requests?|needs?)\b",
    re.IGNORECASE,
)
_NOT_FOR_RE = re.compile(
    r"\b(?:NOT|don['’]t use|never use)\s+for\b[^.]*\.", re.IGNORECASE
)


def parse_description(description: str) -> dict:
    """Split a skill description into {triggers, capability, not_for}.

    Faithful port of src/lib/skill-router.ts:parseDescription — keep them in
    sync so the rows we emit render the way the materializer expects.
    """
    if not description:
        return {"triggers": [], "capability": "", "not_for": ""}

    m = _TRIGGER_PREFIX_RE.search(description)
    trigger_start = m.start() if m else -1
    triggers: list[str] = []

    def _sentence_end(start: int) -> int:
        after = description[start:]
        pm = re.search(r"\.\s|$", after)
        period = pm.start() if pm else -1
        return start + period + 1 if period >= 0 else len(description)

    if trigger_start >= 0:
        sentence = description[trigger_start:_sentence_end(trigger_start)]
        for qm in _QUOTED_RE.finditer(sentence):
            phrase = qm.group(1).strip()
            if 0 < len(phrase) <= 80:
                triggers.append(phrase)

    nf = _NOT_FOR_RE.search(description)
    not_for = nf.group(0).strip() if nf else ""

    capability = description
    if trigger_start >= 0:
        end = _sentence_end(trigger_start)
        capability = (description[:trigger_start] + " " + description[end:]).strip()
    if not_for:
        capability = capability.replace(not_for, "").strip()
    capability = re.sub(r"\s+", " ", capability).strip()
    capability = re.sub(r"^[.\s]+|[.\s]+$", "", capability)

    return {"triggers": triggers, "capability": capability, "not_for": not_for}


def description_to_persona_routing(
    description: str,
    skill_id: str,
    note: Optional[str] = None,
    max_phrases: int = 4,
    max_capability_chars: int = 160,
) -> list[dict]:
    """Synthesize `persona_routing` rows from an (evolved) skill description.

    One `phrase` row per quoted trigger (capped), plus one `capability` row when
    the residual prose is substantial (>=20 chars, mirroring skill-router's
    "more than a fragment" bar). `skill` is set on every row; `note` is optional.
    """
    parsed = parse_description(description)
    entries: list[dict] = []
    seen: set[str] = set()

    for ph in parsed["triggers"][:max_phrases]:
        key = ("phrase", ph.lower())
        if key in seen:
            continue
        seen.add(key)
        row: dict = {"phrase": ph, "skill": skill_id}
        if note:
            row["note"] = note
        entries.append(row)

    cap = parsed["capability"]
    if len(cap) >= 20:
        cap = cap[:max_capability_chars].rstrip()
        row = {"capability": cap, "skill": skill_id}
        if note:
            row["note"] = note
        entries.append(row)

    return entries


# ── block splice (line-based, preserves everything else verbatim) ──────────

_KEY = "persona_routing"
# Top-level keys we insert *before* when no block exists yet (keeps the new
# block after the main persona/skills content, mirroring the Plan design).
_INSERT_ANCHORS = (
    "mcps:", "plugins:", "env:", "rules:", "subagents:",
    "playbooks:", "commands:", "qualityGates:", "hooks:", "evals:",
)


def _block_bounds(lines: list[str]) -> Optional[tuple[int, int]]:
    """Return [start, end) line indices of the `persona_routing:` block, or None.

    The block is the `persona_routing:` line plus all following lines that are
    blank or indented, trimmed back to the last non-blank line (so a blank
    separator before the next top-level key is NOT swallowed).
    """
    start = None
    for i, line in enumerate(lines):
        if re.match(rf"^{_KEY}\s*:", line):
            start = i
            break
    if start is None:
        return None

    last_content = start
    j = start + 1
    while j < len(lines):
        ln = lines[j]
        if ln.strip() == "":
            j += 1
            continue
        if ln[:1] in (" ", "\t"):
            last_content = j
            j += 1
            continue
        break
    return (start, last_content + 1)


def _existing_entries(lines: list[str], bounds: tuple[int, int]) -> list[dict]:
    block_text = "\n".join(lines[bounds[0]:bounds[1]])
    try:
        data = yaml.safe_load(block_text) or {}
    except yaml.YAMLError:
        # A malformed (e.g. tab-indented) existing block can't be parsed; treat
        # as empty but WARN — merging would otherwise silently drop its rows.
        import warnings
        warnings.warn(
            f"persona_routing block (lines {bounds[0]}-{bounds[1]}) failed to "
            "parse; existing rows there will not be de-duplicated against."
        )
        return []
    rows = data.get(_KEY) or []
    return [r for r in rows if isinstance(r, dict)]


def _entry_key(e: dict) -> tuple:
    kind = "phrase" if "phrase" in e else ("capability" if "capability" in e else "?")
    val = str(e.get("phrase") or e.get("capability") or "").strip().lower()
    return (kind, val, str(e.get("skill", "")).strip().lower())


def _merge(existing: list[dict], incoming: list[dict]) -> list[dict]:
    seen = {_entry_key(e) for e in existing}
    out = list(existing)
    for e in incoming:
        k = _entry_key(e)
        if k in seen:
            continue
        seen.add(k)
        out.append(e)
    return out


# `?` is a YAML mapping-key indicator — a bare `?` value breaks safe_load, so it
# must be quoted too (an LLM can emit a single-char trigger like "?").
_NEEDS_QUOTE = re.compile(r'[:#\[\]{}",&*!|>%@`“”?]')


def _scalar(v) -> str:
    s = str(v)
    risky = (
        s == ""
        or s != s.strip()
        or "\n" in s
        or bool(_NEEDS_QUOTE.search(s))
        or s.lower() in ("true", "false", "null", "yes", "no", "~", "on", "off")
        or bool(re.match(r"^[\d.+\-]", s))
    )
    if risky:
        esc = (s.replace("\\", "\\\\").replace('"', '\\"')
               .replace("\n", "\\n").replace("\t", "\\t"))
        return '"' + esc + '"'
    return s


def _render_block(entries: list[dict]) -> str:
    """Hand-roll the block in the house 2-space-indented sequence style.

    PyYAML won't indent a top-level sequence under its key, so we emit directly.
    Round-trips through yaml.safe_load (asserted in tests).
    """
    out = [f"{_KEY}:"]
    for e in entries:
        first = True
        for k, val in e.items():
            prefix = "  - " if first else "    "
            out.append(f"{prefix}{k}: {_scalar(val)}")
            first = False
    return "\n".join(out)


def update_persona_routing(content: str, new_entries: list[dict]) -> str:
    """Merge `new_entries` into the profile.yaml `persona_routing:` block.

    Idempotent: duplicate rows (same kind+value+skill) are skipped, and if
    nothing changes the original `content` is returned byte-for-byte. Everything
    OUTSIDE the block is preserved verbatim, including comments and key order.

    Caveats: the original line endings (LF / CRLF) are preserved, but a `#`
    comment line *inside* the persona_routing block is NOT preserved across a
    rewrite (YAML strips it and the block is re-emitted).
    """
    if not new_entries:
        return content

    # Preserve the file's line-ending convention: do the splice on LF, restore.
    eol = "\r\n" if "\r\n" in content else "\n"
    work = content.replace("\r\n", "\n") if eol == "\r\n" else content
    spliced = _splice(work, new_entries)
    if spliced == work:
        return content  # no change → return original byte-for-byte
    return spliced.replace("\n", eol) if eol == "\r\n" else spliced


def _splice(content: str, new_entries: list[dict]) -> str:
    """LF-only block splice (callers normalize line endings)."""
    lines = content.split("\n")
    bounds = _block_bounds(lines)

    if bounds:
        existing = _existing_entries(lines, bounds)
        merged = _merge(existing, new_entries)
        if [_entry_key(e) for e in merged] == [_entry_key(e) for e in existing]:
            return content
        block = _render_block(merged)
        new_lines = lines[: bounds[0]] + block.split("\n") + lines[bounds[1]:]
        return "\n".join(new_lines)

    # No existing block: insert before the first structural anchor, else append.
    block = _render_block(new_entries)
    for idx, ln in enumerate(lines):
        if any(ln.startswith(a) for a in _INSERT_ANCHORS):
            new_lines = lines[:idx] + block.split("\n") + [""] + lines[idx:]
            return "\n".join(new_lines)

    trailing = "" if content.endswith("\n") else "\n"
    return content.rstrip("\n") + "\n\n" + block + "\n" + trailing.lstrip("\n")


# ── top-level field replacement (persona: / description:) ──────────────────
#
# Used by the persona adapter to rewrite the `persona:` (block scalar) or
# `description:` (inline scalar) field of a profile.yaml, preserving every other
# field, comment, and the file's line endings. Same line-based discipline as the
# persona_routing splice: identify ONLY the target field's lines and swap them.


def _format_scalar_field(field: str, value: str) -> str:
    v = " ".join(str(value).split())
    return f"{field}: {_scalar(v)}"


def _format_block_field(field: str, value: str) -> str:
    """Literal (`|`) block scalar; blank body lines emit as truly empty lines."""
    body = str(value).rstrip("\n").split("\n")
    rendered = "\n".join(("  " + ln) if ln.strip() else "" for ln in body)
    return f"{field}: |\n{rendered}"


def _replace_top_level_field(content: str, field: str, formatted: str) -> str:
    eol = "\r\n" if "\r\n" in content else "\n"
    work = content.replace("\r\n", "\n") if eol == "\r\n" else content
    lines = work.split("\n")

    start = None
    for idx, line in enumerate(lines):
        if re.match(rf"^{re.escape(field)}\s*:", line):
            start = idx
            break

    if start is None:
        joined = work.rstrip("\n") + "\n\n" + formatted + "\n"
        return joined.replace("\n", eol) if eol == "\r\n" else joined

    # Find the block end: last indented/non-blank line after the key. Internal
    # blank lines (part of a block scalar) are consumed; trailing blanks before
    # the next top-level key are preserved.
    last_content = start
    j = start + 1
    while j < len(lines):
        ln = lines[j]
        if ln.strip() == "":
            j += 1
            continue
        if ln[:1] in (" ", "\t"):
            last_content = j
            j += 1
            continue
        break

    new_lines = lines[:start] + formatted.split("\n") + lines[last_content + 1:]
    result = "\n".join(new_lines)
    return result.replace("\n", eol) if eol == "\r\n" else result


def set_profile_field(content: str, field: str, value: str) -> str:
    """Replace a top-level profile.yaml field, preserving everything else.

    `persona` is written as a literal block scalar; all other fields (e.g.
    `description`) as a single quoted/plain scalar. Idempotent-ish: callers
    decide whether to write; this always returns the rewritten text.
    """
    formatted = (_format_block_field(field, value) if field == "persona"
                 else _format_scalar_field(field, value))
    return _replace_top_level_field(content, field, formatted)


# ── safe write with backup ─────────────────────────────────────────────────

def backup_and_write(path: Path, new_content: str, ts: str,
                     original_content: Optional[str] = None) -> Path:
    """Write `new_content` to `path`, first copying the original to
    <path>.bak-<ts>. Returns the backup path (for the revert recipe + log).

    Pass `original_content` (the snapshot the caller already read) so the backup
    reflects the exact pre-evolution state, not a possibly-changed re-read."""
    backup = path.parent / f"{path.name}.bak-{ts}"
    src = original_content if original_content is not None else path.read_text(encoding="utf-8")
    backup.write_text(src, encoding="utf-8")
    # Atomic: a SIGKILL/disk-full mid-write must never leave profile.yaml
    # truncated (cue launch reads it on every invocation).
    atomic_write_text(path, new_content)
    return backup
