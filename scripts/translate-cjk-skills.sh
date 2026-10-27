#!/usr/bin/env bash
# Translate remaining Chinese / Japanese / Korean-content .md files under
# .claude/skills/structured-prompt-writer/ to English, in-place, by calling
# `claude --print` once per file.
#
# Usage:
#   bash scripts/translate-cjk-skills.sh                # translates all CJK files
#   bash scripts/translate-cjk-skills.sh --dry-run      # list files, don't modify
#   bash scripts/translate-cjk-skills.sh --limit 5      # cap to N files this run
#   ROOT=path/to/dir bash scripts/translate-cjk-skills.sh
#
# Requirements:
#   - `claude` CLI on PATH (the Anthropic Claude Code CLI)
#   - You're authenticated (`claude` opens without prompting for login)
#
# Behavior:
#   - Backs up each original to <file>.cjk-backup before overwriting
#   - Skips files that have no CJK content
#   - Skips files whose backup already exists (resumable — delete backup to retry)
#   - Preserves the markdown structure (title heading, "By X", URL, ```markdown``` block)
#
# Cost: one Claude API call per file. ~30 files = ~30 calls. Modest.

set -euo pipefail

ROOT="${ROOT:-.claude/skills/structured-prompt-writer}"
DRY_RUN=0
LIMIT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)  DRY_RUN=1 ;;
    --limit=*)  LIMIT="${1#*=}" ;;
    --limit)
      if [[ $# -lt 2 ]]; then
        echo "translate-cjk-skills.sh: --limit requires a value" >&2
        exit 1
      fi
      LIMIT="$2"; shift ;;
  esac
  shift
done

if ! command -v claude >/dev/null 2>&1; then
  echo "✗ 'claude' CLI not found. Install: https://docs.claude.com/en/docs/agents-and-tools/claude-code" >&2
  exit 1
fi

# Find the REAL claude binary (not cue's launch shim).
# Cue installs a shim at ~/.local/bin/claude that execs `cue launch claude`,
# which would recurse forever if we call it from inside this script.
# Prefer an explicit CLAUDE_BIN override; otherwise probe common locations.
CLAUDE_BIN="${CLAUDE_BIN:-}"
if [ -z "$CLAUDE_BIN" ]; then
  for candidate in \
      "$HOME/.nvm/versions/node"/*/bin/claude \
      "$HOME/.npm-global/bin/claude" \
      "/usr/local/bin/claude" \
      "/opt/homebrew/bin/claude"; do
    # Skip the shim itself; only real claude binaries.
    if [ -x "$candidate" ] && ! head -2 "$candidate" 2>/dev/null | grep -q "cue.*launch claude"; then
      CLAUDE_BIN="$candidate"
      break
    fi
  done
fi
if [ -z "$CLAUDE_BIN" ]; then
  echo "✗ Could not locate the real claude binary (only cue's shim was found)." >&2
  echo "  Set CLAUDE_BIN=/path/to/real/claude and re-run." >&2
  exit 1
fi
echo "▶ Using claude binary: $CLAUDE_BIN"
if [ ! -d "$ROOT" ]; then
  echo "✗ Root directory not found: $ROOT" >&2
  exit 1
fi

# Find all .md files that still contain CJK characters
mapfile -t FILES < <(find "$ROOT" -name "*.md" -exec grep -l -P '[\x{4e00}-\x{9fff}\x{3040}-\x{309f}\x{30a0}-\x{30ff}]' {} \;)
total="${#FILES[@]}"
echo "▶ Found $total file(s) with CJK content under $ROOT"

if [ "$total" -eq 0 ]; then
  echo "✓ Nothing to translate."
  exit 0
fi

count=0
processed=0
for f in "${FILES[@]}"; do
  count=$((count + 1))

  # Stop after LIMIT processed files (only counts ones we actually attempt)
  if [ "$LIMIT" -gt 0 ] && [ "$processed" -ge "$LIMIT" ]; then
    echo "  ⏹  reached --limit $LIMIT — stopping"
    break
  fi

  if [ -f "$f.cjk-backup" ]; then
    echo "  [$count/$total] ⏭  $f  (backup exists — already processed; delete .cjk-backup to redo)"
    continue
  fi

  if [ "$DRY_RUN" = "1" ]; then
    echo "  [$count/$total] (dry-run) $f"
    continue
  fi

  echo "  [$count/$total] ▶ $f"

  # Translate via claude --print
  PROMPT="Translate the following markdown file from Chinese / Japanese / Korean to natural, idiomatic English. Strict requirements:

1. PRESERVE the markdown structure exactly: headings (##), 'By X' attribution lines, URLs, fenced code blocks (\`\`\`markdown ... \`\`\` or \`\`\`...\`\`\`).
2. Translate ALL prose content inside the file — including content inside code blocks, since those are prompt templates that need to function in English.
3. Keep author/proper-name pinyin spellings as-is. Don't transliterate URLs.
4. Do NOT add any preface, footer, or commentary. Output ONLY the translated markdown content, ready to write to disk.
5. Where the Chinese has cultural references (e.g. xiaohongshu, jianghu, 小红书), explain or translate naturally — use 'Xiaohongshu (RedNote)' or similar.

File content follows:
---
$(cat -- "$f")
---"

  # Backup original
  cp -- "$f" "$f.cjk-backup"

  # Call the real claude binary (bypassing cue's launch shim entirely).
  # Pipe the prompt via stdin (NOT -p) to avoid argv length limits on large
  # files (Linux argv cap ≈ 128 KB; some catalog files are 100 KB+).
  # 300s per-file timeout — protects the run if a single call hangs.
  if ! printf '%s' "$PROMPT" | timeout 300 "$CLAUDE_BIN" --print > "$f.new" 2> "$f.err"; then
    rc=$?
    if [ "$rc" -eq 124 ]; then
      echo "    ✗ claude timed out (>300s) — skipping"
    else
      echo "    ✗ claude failed (exit $rc) — see $f.err"
    fi
    mv -- "$f.cjk-backup" "$f"  # restore
    continue
  fi

  if [ ! -s "$f.new" ]; then
    echo "    ⚠ empty output — restoring backup"
    mv -- "$f.cjk-backup" "$f"
    rm -f "$f.new"
    continue
  fi

  mv -- "$f.new" "$f"
  rm -f "$f.err"
  processed=$((processed + 1))
  echo "    ✓ translated"
  # Brief pause to be gentle on the API and reduce transient-error rates
  sleep 1
done

echo ""
echo "✓ Translated $processed of $total files."
echo "  Originals backed up alongside each file as <filename>.cjk-backup"
echo "  To wipe backups after review:"
echo "    find $ROOT -name '*.cjk-backup' -delete"
