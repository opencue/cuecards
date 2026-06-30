#!/usr/bin/env bash
# UserPromptSubmit hook — nudge /clear or /compact when the session grows fat.
#
# Cache reads scale with turns × context length, so all-day conversations are
# the #1 token-cost driver (97%+ of spend in the 2026-06 ccusage audit). This
# prints ONE display-only systemMessage per threshold per session when the
# transcript crosses a size band, so the habit becomes automatic instead of
# remembered.
#
# Transcript size is a noisy proxy for live context (it includes tool output
# that may already be compacted away) — that's fine for a nudge; thresholds
# are deliberately conservative so it fires on marathons, not normal work.
#
# Always safe: any error or missing input → exit 0, no output.
#
# Tunables:
#   CUE_CONTEXT_NUDGE_OFF=1     disable entirely
#   CUE_CONTEXT_NUDGE_MB        first threshold in MB (default 3)
#   CUE_CONTEXT_NUDGE_MB2       second threshold in MB (default 8)

set -uo pipefail

[ "${CUE_CONTEXT_NUDGE_OFF:-}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

input="$(cat 2>/dev/null)" || exit 0
[ -n "$input" ] || exit 0

transcript="$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)" || exit 0
sid="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)" || exit 0
[ -n "$transcript" ] && [ -f "$transcript" ] && [ -n "$sid" ] || exit 0

bytes="$(stat -c %s "$transcript" 2>/dev/null || stat -f %z "$transcript" 2>/dev/null)" || exit 0
[ -n "$bytes" ] || exit 0

mb1="${CUE_CONTEXT_NUDGE_MB:-2}"
mb2="${CUE_CONTEXT_NUDGE_MB2:-5}"
t1=$(( mb1 * 1024 * 1024 ))
t2=$(( mb2 * 1024 * 1024 ))

tier=""
if   [ "$bytes" -ge "$t2" ]; then tier="2"
elif [ "$bytes" -ge "$t1" ]; then tier="1"
else exit 0; fi

# One nudge per tier per session.
stamp="${TMPDIR:-/tmp}/cue-context-nudge-${sid}-${tier}"
[ -f "$stamp" ] && exit 0
: > "$stamp" 2>/dev/null || exit 0

mbs=$(( bytes / 1024 / 1024 ))
if [ "$tier" = "2" ]; then
  msg="🧹 context nudge: transcript is ~${mbs}MB — every turn re-reads all of it. Strongly consider /clear (new task) or /compact now; cache reads are 97% of token spend."
else
  msg="🧹 context nudge: transcript passed ~${mbs}MB. If you're switching tasks, /clear; if mid-task, /compact trims the re-read cost."
fi

encoded="$(printf '%s' "$msg" | jq -Rs .)" || exit 0
[ -n "$encoded" ] || exit 0
printf '{"systemMessage": %s}\n' "$encoded"
exit 0
