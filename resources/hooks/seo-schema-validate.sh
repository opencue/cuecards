#!/usr/bin/env bash
# PostToolUse:Edit|Write — validate JSON-LD schema after file edits.
#
# Reads the hook payload from stdin, extracts tool_input.file_path, then
# delegates to seo-schema-validate.py. Ported from AgriciDaniel/claude-seo.
#
# Exit 0 = ok, exit 1 = warnings (non-blocking), exit 2 = block.
set -euo pipefail

payload="$(cat -)"
filepath="$(printf '%s' "$payload" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get("tool_input", {}).get("file_path", ""))
except Exception:
    pass
' 2>/dev/null)"

[[ -z "$filepath" ]] && exit 0

py_hook="${CLAUDE_CONFIG_DIR}/hooks/seo-schema-validate.py"
[[ -f "$py_hook" ]] || exit 0

# Prefer explicit override, then python3, then python.
if [[ -n "${CLAUDE_SEO_PYTHON:-}" ]]; then
  python_bin="$CLAUDE_SEO_PYTHON"
elif command -v python3 &>/dev/null; then
  python_bin="python3"
elif command -v python &>/dev/null; then
  python_bin="python"
else
  exit 0  # No Python found; skip validation rather than block.
fi

exec "$python_bin" "$py_hook" "$filepath"
