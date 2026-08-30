#!/usr/bin/env bash
# PreToolUse(Read) hook — nudge delegation when the main session grinds files.
#
# Heavy file-reading in the MAIN session is a token-cost trap: every file read
# lives in context and is re-read (cache-read) on every later turn. Subagents
# (Explore/Agent, Sonnet-pinned) read the same files, return the conclusion,
# and their context dies with them. This counts Read calls per session and
# prints ONE display-only nudge when the count crosses a threshold.
#
# Never blocks: emits no permissionDecision, only an optional systemMessage.
# Always safe: any error → exit 0, the Read proceeds untouched.
#
# Tunables:
#   CUE_READ_NUDGE_OFF=1     disable entirely
#   CUE_READ_NUDGE_AT        Read-call count that triggers the nudge (default 25)

set -uo pipefail

[ "${CUE_READ_NUDGE_OFF:-}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

input="$(cat 2>/dev/null)" || exit 0
[ -n "$input" ] || exit 0

sid="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)" || exit 0
[ -n "$sid" ] || exit 0

counter="${TMPDIR:-/tmp}/cue-read-count-${sid}"
count="$(cat "$counter" 2>/dev/null || echo 0)"
case "$count" in (*[!0-9]*|'') count=0;; esac
count=$(( count + 1 ))
printf '%s' "$count" > "$counter" 2>/dev/null

at="${CUE_READ_NUDGE_AT:-25}"
[ "$count" -eq "$at" ] || exit 0   # fire exactly once, at the threshold

msg="📚 delegation nudge: ${count} file reads in this session — each one is re-read every later turn. For broad exploration, hand it to an Explore/Agent subagent (Sonnet-pinned): it returns the conclusion and its context dies with it."
encoded="$(printf '%s' "$msg" | jq -Rs .)" || exit 0
[ -n "$encoded" ] || exit 0
printf '{"systemMessage": %s}\n' "$encoded"
exit 0
