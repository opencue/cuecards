#!/usr/bin/env bash
# UserPromptSubmit hook — when the user types the first prompt of a session,
# save it to ~/.config/cue/first-prompts/<cwd-hash>.json so the NEXT `cue launch`
# in the same cwd can auto-trigger smart-subset using this prompt as the hint.
#
# Cycle:
#   1. First launch in dir → full skill set (we have no prior prompt yet).
#   2. User types their first message → this hook captures it.
#   3. Second+ launch in dir with CUE_SMART_SUBSET=1 → cue launch reads the
#      captured prompt and calls claude --print to filter the skill list.
#
# Skips every prompt after the first one (cheap exit) so the hook adds
# negligible latency to subsequent prompts in the same session.
#
# No external deps. Reads UserPromptSubmit payload from stdin.

set -euo pipefail

payload="$(cat -)"

# Best-effort extract; payload is JSON.
extract() {
  printf '%s' "$payload" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"//; s/\"$//" || true
}

prompt="$(extract prompt)"
transcript_path="$(extract transcript_path)"
session_id="$(extract session_id)"

# Skip empty prompts (shouldn't happen, but defensive).
if [[ -z "$prompt" ]]; then exit 0; fi

# Decide: is this the FIRST user message of the session?
# Strategy: count user messages already in the transcript. The current prompt
# isn't written to the transcript yet at UserPromptSubmit time, so count > 0
# means "this is at least the second prompt" → skip.
if [[ -n "$transcript_path" && -r "$transcript_path" ]]; then
  # grep -c always prints a number to stdout, but exits 1 when no matches → the
  # || branch resets the var only on a hard failure (unreadable file etc).
  user_msg_count="$(grep -cE '"type":[[:space:]]*"user"' "$transcript_path" 2>/dev/null)" || user_msg_count=0
  if [[ "${user_msg_count:-0}" -gt 0 ]]; then
    exit 0
  fi
fi

# Storage: per-cwd JSON file keyed by a stable hash of the absolute cwd.
cwd_abs="$(cd "$(pwd)" && pwd -P)"
# sha1sum is in coreutils on Linux; on macOS it's `shasum`. Try both.
if command -v sha1sum >/dev/null 2>&1; then
  cwd_hash="$(printf '%s' "$cwd_abs" | sha1sum | head -c 16)"
elif command -v shasum >/dev/null 2>&1; then
  cwd_hash="$(printf '%s' "$cwd_abs" | shasum -a 1 | head -c 16)"
else
  # Last-resort fallback: collapse the path into a slug.
  cwd_hash="$(printf '%s' "$cwd_abs" | tr '/' '_' | tr -cd 'A-Za-z0-9_-' | tail -c 64)"
fi

dir="${HOME}/.config/cue/first-prompts"
mkdir -p "$dir"

ts="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

# Escape double-quotes and backslashes in the prompt for safe JSON embedding.
# (No newlines — UserPromptSubmit gives the prompt on a single logical line;
# if it had newlines, we collapse them.)
escaped_prompt="$(printf '%s' "$prompt" | tr '\n' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g')"

printf '{"ts":"%s","cwd":"%s","session_id":"%s","prompt":"%s"}\n' \
  "$ts" "$cwd_abs" "$session_id" "$escaped_prompt" > "$dir/$cwd_hash.json"

exit 0
