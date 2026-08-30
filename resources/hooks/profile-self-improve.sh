#!/usr/bin/env bash
# Stop hook — cue self-learner. Captures where the active profile's SKILLS fell
# short during a task, so profiles can auto-improve over time. OFF by default.
#
# Two layers in one hook (see docs/self-learner.md):
#   L1 (always, ~0 cost): grep the transcript for friction signals (failed
#       tools, retry loops, quality-gate vetoes, soft-loaded skills = capability
#       the profile lacked) and append ONE skill_gap event (source:"hook").
#   L0 (once per session): spawn a fresh, INDEPENDENT critic (headless
#       `claude -p`, Sonnet) that judges which skill/profile area was weak and
#       appends a skill_gap event (source:"critic"). Skipped if
#       CUE_SELF_IMPROVE_NO_CRITIC=1.
#
# This hook NEVER blocks the Stop (exit 0 always) — the profile's quality-gates
# remain the sole veto authority. It NEVER edits profile.yaml/SKILL.md; it only
# appends signal events to ~/.config/cue/analytics.jsonl. Mutation happens later
# behind `cue profile self-improve` (lint-gated + backup + log + revert).
#
# Opt-in: active only when BOTH exist:
#   ~/.config/cue/.auto-improve-enabled   (touch to enable, rm to disable)
#   ~/.config/cue/.telemetry-consent      (cue telemetry enable)
#
# Loop safety (mirrors auto-review.sh):
#   - recursion guard: CUE_AUTO_IMPROVE_INNER=1 makes the spawned critic's own
#     session a no-op, so it can't re-trigger this hook recursively.
#   - per-session sentinel: the critic runs at most once per session_id.
#
# Critic command is overridable for tests: set CUE_SELF_IMPROVE_CMD to a shell
# command that reads the prompt on stdin and prints the verdict JSON. Default
# spawns `claude -p --model sonnet`.
#
# Fail-open: any error (no claude, timeout, malformed input) → exit 0.

set -uo pipefail

# ─── Recursion guard ───────────────────────────────────────────────────────
[ "${CUE_AUTO_IMPROVE_INNER:-}" = "1" ] && exit 0

CFG="${XDG_CONFIG_HOME:-$HOME/.config}/cue"

# ─── Opt-in gates (feature flag AND telemetry consent) ─────────────────────
[ -f "$CFG/.auto-improve-enabled" ] || exit 0
[ -f "$CFG/.telemetry-consent" ]    || exit 0

payload="$(cat -)"
extract() {
  printf '%s' "$payload" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 \
    | sed "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"//; s/\"$//"
}
transcript_path="$(extract transcript_path)"
session_id="$(extract session_id)"
cwd="$(extract cwd)"
[ -z "$cwd" ] && cwd="$PWD"

# Need a readable transcript to learn anything.
[ -n "$transcript_path" ] && [ -r "$transcript_path" ] || exit 0

# Resolve the active profile (matches launch-time resolution).
profile=""
[ -f "$cwd/.cue-profile" ] && profile="$(head -1 "$cwd/.cue-profile" | tr -d '[:space:]')"
profile="${profile:-${CUE_PROFILE:-unknown}}"

LOG="$CFG/analytics.jsonl"
mkdir -p "$CFG" 2>/dev/null || exit 0

# ─── Substance gate — skip trivial turns ───────────────────────────────────
MIN_TOOLS="${CUE_SELF_IMPROVE_MIN_TOOLS:-3}"
tail_buf="$(tail -c 200000 "$transcript_path" 2>/dev/null)"
tool_uses="$(printf '%s' "$tail_buf" | grep -oiE '"type"[[:space:]]*:[[:space:]]*"tool_use"' | wc -l | tr -d ' ')"
[ "${tool_uses:-0}" -lt "$MIN_TOOLS" ] && exit 0

# Escape for embedding in a JSON string: drop C0 control chars (a raw tab/newline
# would make the whole analytics.jsonl line unparseable), then escape \ and ".
esc() { printf '%s' "$1" | tr -d '\000-\037' | sed 's/\\/\\\\/g; s/"/\\"/g'; }
ts="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

# first_prompt — best-effort trigger hint, capped at 160 chars, basic secret
# scrub. Leak-safe: capture ONLY when the first user turn's message.content is a
# STRING. A tool_result-array turn (or nested "content" fields) yields empty,
# never the raw transcript line. Prefer jq (parses correctly); fall back to a
# tool_result-guarded regex when jq is absent.
first_user_line="$(grep -m1 '"type":"user"' "$transcript_path" 2>/dev/null || true)"
raw_prompt=""
if [ -n "$first_user_line" ]; then
  if command -v jq >/dev/null 2>&1; then
    raw_prompt="$(printf '%s' "$first_user_line" \
      | jq -r 'if (.message.content | type) == "string" then .message.content else "" end' 2>/dev/null \
      | head -c 160)"
  elif ! printf '%s' "$first_user_line" | grep -q '"tool_result"'; then
    raw_prompt="$(printf '%s' "$first_user_line" \
      | grep -oE '"content"[[:space:]]*:[[:space:]]*"[^"]{0,160}' | head -1 \
      | sed -E 's/.*"content"[[:space:]]*:[[:space:]]*"//')"
  fi
fi
fp="$(printf '%s' "$raw_prompt" \
  | sed -E 's/(sk-[A-Za-z0-9_-]{6,}|gh[pousr]_[A-Za-z0-9]{6,}|AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z_-]{12,}|xox[baprs]-[A-Za-z0-9-]{6,})/REDACTED/g')"

# ─── L1: cheap friction signals (always) ───────────────────────────────────
signals=()
sig() { printf '%s' "$tail_buf" | grep -qiE "$2" && signals+=("$1"); }
sig "quality-gate-veto" 'cue:quality-gates BLOCKED'
sig "retry-loop"        'let me try (a different|again|another)'
sig "tool-error"        '"is_error"[[:space:]]*:[[:space:]]*true'
sig "test-fail"         'test.*(FAIL|failed)'
sig "manual-rollback"   'git reset --hard'
# Soft-loaded skills = a capability the profile did not have wired = gap signal.
while IFS= read -r sl; do
  [ -n "$sl" ] && signals+=("soft-load:$sl")
done < <(printf '%s' "$tail_buf" | grep -oE 'smart-lookup\.sh [a-z][a-z0-9-]+' | sed -E 's/.* //' | sort -u)

if [ "${#signals[@]}" -gt 0 ]; then
  sig_json="["
  for i in "${!signals[@]}"; do
    sig_json+="\"$(esc "${signals[$i]}")\""
    [ "$i" -lt "$(( ${#signals[@]} - 1 ))" ] && sig_json+=","
  done
  sig_json+="]"
  printf '{"ts":"%s","event":"skill_gap","profile":"%s","agent":"claude-code","cwd":"%s","session_id":"%s","source":"hook","signals":%s,"first_prompt":"%s"}\n' \
    "$ts" "$(esc "$profile")" "$(esc "$cwd")" "$(esc "$session_id")" "$sig_json" "$(esc "$fp")" >> "$LOG"
fi

# ─── L0: live critic (once per session) ─────────────────────────────────────
[ "${CUE_SELF_IMPROVE_NO_CRITIC:-}" = "1" ] && exit 0

sdir="$CFG/self-improve"
mkdir -p "$sdir" 2>/dev/null || exit 0
sid_key="$(printf '%s' "${session_id:-$cwd}" | tr -cd 'A-Za-z0-9._-')"
seen="$sdir/${sid_key}.critic"
[ -f "$seen" ] && exit 0

critic_prompt="You are the cue PROFILE CRITIC. The session transcript below ran under cue profile '$profile'.
Judge ONLY where the profile's SKILLS fell short: a capability the user needed that no loaded skill covered, a skill that should have triggered but did not, or a skill that fired but was incomplete. The transcript's opening CLAUDE.md block lists the skills that WERE available.
Output ONE line of JSON and nothing else:
{\"skill\":\"<category/slug or NONE>\",\"gap_type\":\"missing-skill|weak-description|weak-body|profile-composition|none\",\"suggestion\":\"<=140 chars, imperative\",\"confidence\":<1-10>}
If the profile served the task well, output exactly: {\"skill\":\"NONE\",\"gap_type\":\"none\",\"suggestion\":\"\",\"confidence\":1}
--- TRANSCRIPT TAIL ---
$(printf '%s' "$tail_buf" | head -c 60000)
--- END ---"

# Mark BEFORE spawning so a crash mid-run can never loop.
touch "$seen" 2>/dev/null || true

if [ -n "${CUE_SELF_IMPROVE_CMD:-}" ]; then
  verdict="$(printf '%s' "$critic_prompt" | timeout 240 bash -c "$CUE_SELF_IMPROVE_CMD" 2>/dev/null)"
else
  command -v claude >/dev/null 2>&1 || exit 0
  verdict="$(CUE_AUTO_IMPROVE_INNER=1 timeout 240 claude -p --model sonnet "$critic_prompt" 2>/dev/null)"
fi
[ -z "$verdict" ] && exit 0

vline="$(printf '%s' "$verdict" | grep -oE '\{.*\}' | head -1)"
[ -z "$vline" ] && exit 0

field() { printf '%s' "$vline" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed -E "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/"; }
cskill="$(field skill)"
cgap="$(field gap_type)"
csug="$(field suggestion)"
cconf="$(printf '%s' "$vline" | grep -oE '"confidence"[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$')"
[ -z "$cconf" ] && cconf=5

# Drop "no gap" verdicts — nothing to learn.
if [ "$cgap" = "none" ] || [ "$cskill" = "NONE" ] || [ -z "$cskill" ]; then
  exit 0
fi

printf '{"ts":"%s","event":"skill_gap","profile":"%s","agent":"claude-code","cwd":"%s","session_id":"%s","source":"critic","skill":"%s","gap_type":"%s","suggestion":"%s","confidence":%d,"first_prompt":"%s"}\n' \
  "$ts" "$(esc "$profile")" "$(esc "$cwd")" "$(esc "$session_id")" \
  "$(esc "$cskill")" "$(esc "$cgap")" "$(esc "$csug")" "$cconf" "$(esc "$fp")" >> "$LOG"

exit 0
