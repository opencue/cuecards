"""Find, load, and reassemble cue SKILL.md files.

Adapted from hermes' skill_module.{load_skill,find_skill,reassemble_skill}.
cue skills live at:  <skills_root>/<category>/<slug>/SKILL.md
and carry a `name:` field in YAML frontmatter (the canonical id used by the npx
registry — see the cue memory "npx skill IDs = name: field").

No DSPy import here, so this module is usable in the offline / dry-run path.
"""

import re
import textwrap
from pathlib import Path
from typing import Optional


def load_skill(skill_path: Path) -> dict:
    """Load a SKILL.md and split frontmatter / body.

    Returns dict with: path, raw, frontmatter, body, name, description.
    """
    raw = skill_path.read_text(encoding="utf-8")

    frontmatter = ""
    body = raw
    if raw.lstrip().startswith("---"):
        # Split on the first two "---" fences only.
        parts = raw.split("---", 2)
        if len(parts) >= 3:
            frontmatter = parts[1].strip()
            body = parts[2].strip()

    name = ""
    description = ""
    for line in frontmatter.split("\n"):
        stripped = line.strip()
        if stripped.startswith("name:"):
            name = stripped.split(":", 1)[1].strip().strip("'\"")
        elif stripped.startswith("description:"):
            description = stripped.split(":", 1)[1].strip().strip("'\"")

    return {
        "path": skill_path,
        "raw": raw,
        "frontmatter": frontmatter,
        "body": body,
        "name": name,
        "description": description,
    }


def find_skill(skill_id: str, skills_root: Path) -> Optional[Path]:
    """Locate a cue skill's SKILL.md.

    Accepts any of:
      * "category/slug"           e.g. "eu-funding/ted-tender-search"
      * "slug"                    e.g. "ted-tender-search"  (dir name)
      * a frontmatter name:       (matched as a fallback)
    """
    if not skills_root.exists():
        return None

    skill_id = skill_id.strip().strip("/")

    # 1. Exact relative path "category/slug/SKILL.md".
    #    Resolve and confirm it stays inside skills_root (no ../ traversal).
    direct = (skills_root / skill_id / "SKILL.md").resolve()
    root = skills_root.resolve()
    if direct.is_file() and str(direct).startswith(str(root) + "/"):
        return direct

    slug = skill_id.split("/")[-1]

    # 2. Directory name match anywhere in the tree.
    for skill_md in skills_root.rglob("SKILL.md"):
        if skill_md.parent.name == slug:
            return skill_md

    # 3. Frontmatter `name:` match (handles short/renamed slugs).
    for skill_md in skills_root.rglob("SKILL.md"):
        try:
            head = skill_md.read_text()[:600]
        except OSError:
            continue
        if f"name: {slug}" in head or f'name: "{slug}"' in head or f"name: '{slug}'" in head:
            return skill_md

    return None


def reassemble_skill(frontmatter: str, evolved_body: str) -> str:
    """Rebuild a SKILL.md, preserving the original frontmatter verbatim.

    Only the body is replaced — `name`, `description`, `tags`, etc. are
    immutable so the skill's identity and registry id never drift.
    """
    return f"---\n{frontmatter}\n---\n\n{evolved_body}\n"


# ── Description-level seam (the inverse of reassemble_skill) ────────────────
#
# The body engine freezes the frontmatter; the *description* engine needs the
# opposite — swap the `description:` value while preserving the body verbatim.
# Used to build a candidate SKILL.md for the `cue lint-skill` gate even though,
# for the per-profile landing target, the evolved text is written to
# persona_routing rather than to the SKILL.md on disk.


def extract_description(frontmatter: str) -> str:
    """Return the full `description:` value, handling block scalars.

    load_skill() only captures a single inline value (it splits on the first
    ':' and strips quotes); a `description: >-` block scalar would yield just
    the indicator. This reads the whole value so the baseline we optimize is
    the real description.
    """
    lines = frontmatter.split("\n")
    for i, line in enumerate(lines):
        m = re.match(r"^description:\s*(.*)$", line)
        if not m:
            continue
        rest = m.group(1).strip()
        if rest and rest[0] in "|>":
            # Block scalar: gather the following more-indented lines.
            key_indent = len(line) - len(line.lstrip())
            chunk = []
            for nxt in lines[i + 1:]:
                if nxt.strip() == "":
                    chunk.append("")
                    continue
                if (len(nxt) - len(nxt.lstrip())) > key_indent:
                    chunk.append(nxt.strip())
                else:
                    break
            return " ".join(c for c in chunk if c).strip()
        return rest.strip().strip("'\"")
    return ""


def _format_description(desc: str) -> str:
    """Emit a frontmatter `description:` line for a string value.

    Short, single-line values are double-quoted (with escaping); longer ones
    use a folded block scalar so the frontmatter stays readable and lint-clean.
    """
    desc = " ".join(desc.split())  # collapse whitespace/newlines
    if len(desc) <= 100:
        escaped = desc.replace("\\", "\\\\").replace('"', '\\"')
        return f'description: "{escaped}"'
    wrapped = textwrap.wrap(desc, width=76)
    return "description: >-\n" + "\n".join("  " + ln for ln in wrapped)


def replace_description_in_frontmatter(frontmatter: str, new_description: str) -> str:
    """Replace the `description:` value (inline or block scalar) in raw
    frontmatter, preserving every other field verbatim."""
    lines = frontmatter.split("\n")
    out: list[str] = []
    i = 0
    replaced = False
    while i < len(lines):
        line = lines[i]
        if not replaced and re.match(r"^description:\s*", line):
            key_indent = len(line) - len(line.lstrip())
            i += 1
            # Consume continuation lines (block scalar / wrapped value).
            while i < len(lines):
                nxt = lines[i]
                if nxt.strip() == "" or (len(nxt) - len(nxt.lstrip())) > key_indent:
                    i += 1
                else:
                    break
            out.append(_format_description(new_description))
            replaced = True
            continue
        out.append(line)
        i += 1
    if not replaced:
        out.append(_format_description(new_description))
    return "\n".join(out)


def reassemble_with_new_description(skill: dict, new_description: str) -> str:
    """Rebuild a SKILL.md with the description replaced but the body verbatim."""
    new_fm = replace_description_in_frontmatter(skill["frontmatter"], new_description)
    return f"---\n{new_fm}\n---\n\n{skill['body']}\n"
