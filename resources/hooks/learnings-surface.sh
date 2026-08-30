#!/usr/bin/env bash
# SessionStart hook — surface recent cross-session LEARNINGS so the model reads
# them automatically instead of relying on prose telling it to run a search.
#
# Closes the read-back half of the learnings loop: bin/cue-learnings logs to an
# append-only learnings.jsonl per project; this injects the top few back into
# context at session start as additionalContext.
#
# Always safe: emits nothing (exit 0, no output) when there are no learnings, the
# tool is missing, or anything errors. Output, when present, is a single JSON
# object on stdout in the SessionStart hook contract.
#
# Tunables:
#   CUE_LEARNINGS_SURFACE_MAX   how many to show (default 5)
#   CUE_LEARNINGS_SURFACE_OFF=1 disable entirely

set -uo pipefail

[ "${CUE_LEARNINGS_SURFACE_OFF:-}" = "1" ] && exit 0
[ "${CUE_AUTO_IMPROVE_INNER:-}" = "1" ] && exit 0   # don't surface into spawned critics

# Locate cue-learnings: next to this hook's repo bin, or on PATH.
LEARN=""
for cand in "$HOME/Documents/cue/bin/cue-learnings" "$(command -v cue-learnings 2>/dev/null || true)"; do
  [ -n "$cand" ] && [ -x "$cand" ] && { LEARN="$cand"; break; }
done
[ -n "$LEARN" ] || exit 0

max="${CUE_LEARNINGS_SURFACE_MAX:-5}"
# `search` with no pattern returns most-recent-first, pre-formatted one-per-line.
lines="$("$LEARN" search 2>/dev/null | grep -viE '^no learnings' | head -n "$max")"
[ -n "$lines" ] || exit 0

# Build the context block; escape for embedding in a JSON string.
esc() { printf '%s' "$1" | tr -d '\000-\037' | sed 's/\\/\\\\/g; s/"/\\"/g'; }
body="Recent project learnings (from past sessions via cue-learnings — verify before acting on any that name a file/flag):"
while IFS= read -r ln; do
  [ -n "$ln" ] && body="$body\n- $(esc "$ln")"
done <<< "$lines"

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$body"
exit 0
