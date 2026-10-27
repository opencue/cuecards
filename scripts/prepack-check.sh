#!/usr/bin/env bash
# prepack guard — runs before `npm pack` / `npm publish`.
#
# The skills live in the `resources/skills` git submodule. If it isn't checked
# out, npm would publish a package with an empty skills tree. Fail loudly here
# instead of shipping a broken tarball.

set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="$ROOT/resources/skills/skills"

count="$(find "$SKILLS_DIR" -name SKILL.md 2>/dev/null | wc -l)"
if [ "$count" -eq 0 ]; then
  echo "prepack: $SKILLS_DIR has no SKILL.md files." >&2
  echo "         The resources/skills submodule is not checked out." >&2
  echo "         Run: git submodule update --init --recursive" >&2
  exit 1
fi

echo "prepack: skills submodule populated ($count skills)."
