#!/usr/bin/env bash
# Stop hook — audit the liedetector tags Claude wrote this turn against the
# tool calls the harness actually observed. The integrity-protocol tagging
# discipline (🟢 [VERIFIED], 🟢 [KNOWN], etc.) is self-applied by the model;
# nothing stops the model from labelling a fabrication as "verified".
#
# This hook re-grounds the tag in observable behaviour:
#   - For every [VERIFIED] claim in the last assistant turn, the same turn
#     must contain at least one verification tool call (Read, Bash with
#     inspection commands, Grep, etc.).
#   - For every [KNOWN] claim that mentions a time-sensitive subject
#     (versions, "latest", "current"), warn — training data goes stale.
#
# It also reports the turn's TAG MIX — the green/yellow/orange/red split of
# the claims, with a "% grounded" and "% guess-or-worse" readout. The audits
# above catch violations; the mix answers the plainer question the tags exist
# for: how much of this answer did the model actually check? Prints on turns
# with >=3 tags. Disable with CUE_TAG_MIX_OFF=1.
#
# When mismatches are detected, the hook emits a "⚠ Tag audit" block to
# stderr (which Claude Code surfaces). It never blocks; it only flags.
# Suppress per-turn via [skip-tag-audit] anywhere in the assistant response.
#
# No external deps beyond jq. Exits 0 always.

set -uo pipefail

payload="$(cat -)"
extract() {
  printf '%s' "$payload" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 \
    | sed "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"//; s/\"$//"
}

transcript_path="$(extract transcript_path)"
session_id="$(extract session_id)"
[ -z "$transcript_path" ] || [ ! -r "$transcript_path" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

CACHE_DIR="${XDG_RUNTIME_DIR:-/tmp}/cue-tag-audit"
mkdir -p "$CACHE_DIR" 2>/dev/null || exit 0

# Throttle: once per Stop event per session.
throttle="$CACHE_DIR/throttle.${session_id:-default}"
now=$(date +%s)
last=$(stat -c '%Y' "$throttle" 2>/dev/null || echo 0)
[ $((now - last)) -lt 5 ] && exit 0
touch "$throttle"

# ─── Find the last user message index ──────────────────────────────────────
# Stop hooks fire after Claude finishes responding. Everything since the
# most-recent user message is "this turn".
last_user_line=$(awk 'BEGIN{n=0; last=0} {n++} /"type":"user"/{last=n} END{print last}' "$transcript_path")
[ "$last_user_line" = "0" ] && exit 0

# Slice the transcript: just this turn's lines. Session-scoped — concurrent
# Claude sessions share $CACHE_DIR, and an unscoped path lets one session's
# Stop hook overwrite another's slice mid-read.
turn_jsonl="$CACHE_DIR/turn.${session_id:-default}.jsonl"
tail -n +"$last_user_line" "$transcript_path" > "$turn_jsonl"

# ─── Extract assistant text + tool_use names from this turn ────────────────
assistant_text=$(jq -r '
  select(.type == "assistant") |
  .message.content |
  if type == "array" then .[] else . end |
  select(.type == "text") |
  .text
' "$turn_jsonl" 2>/dev/null)

tool_calls=$(jq -r '
  select(.type == "assistant") |
  .message.content |
  if type == "array" then .[] else . end |
  select(.type == "tool_use") |
  [.name, ((.input.command // "") | tostring | .[:200])] | @tsv
' "$turn_jsonl" 2>/dev/null)

# ─── Bail on opt-out ───────────────────────────────────────────────────────
if grep -qF "[skip-tag-audit]" <<< "$assistant_text"; then exit 0; fi

# ─── Count tags in the response ────────────────────────────────────────────
# Match [VERIFIED], 🟢 [VERIFIED], `[VERIFIED]`, etc. Single regex with
# optional brackets/backticks.
count_tag() { grep -oE "\[$1[^]]*\]" <<< "$assistant_text" | wc -l | tr -d '\n'; }

verified_count=$(count_tag VERIFIED);   verified_count=${verified_count:-0}
known_count=$(count_tag KNOWN);         known_count=${known_count:-0}
inferred_count=$(count_tag INFERRED);   inferred_count=${inferred_count:-0}
assumed_count=$(count_tag ASSUMED);     assumed_count=${assumed_count:-0}
guessed_count=$(count_tag GUESSED);     guessed_count=${guessed_count:-0}
stale_count=$(count_tag STALE);         stale_count=${stale_count:-0}
unknown_count=$(count_tag UNKNOWN);     unknown_count=${unknown_count:-0}
correction_count=$(count_tag CORRECTION); correction_count=${correction_count:-0}

green_count=$((verified_count + known_count))
yellow_count=$((inferred_count + assumed_count))
orange_count=$((guessed_count + stale_count))
red_count=$unknown_count
claim_count=$((green_count + yellow_count + orange_count + red_count))

# ─── Count verification tool calls ─────────────────────────────────────────
# A "verification action" is one of:
#   - Read tool (any path)
#   - Grep tool
#   - Bash with: grep, cat, head, tail, less, ls, find, test, diff, file,
#                wc, stat, hexdump, sha, md5, git log/diff/show/blame/status,
#                npm test, pytest, cargo test, go test, jest, vitest, tsc,
#                eslint, ruff, pylint, lint-skill, jq (read), curl --head
#   - WebFetch / WebSearch (verification by lookup)
#   - Any MCP tool with "search" or "get" or "read" in its name
verification_count=0
non_verification_count=0
while IFS=$'\t' read -r name cmd; do
  [ -z "$name" ] && continue
  case "$name" in
    Read|Grep|WebFetch|WebSearch)
      verification_count=$((verification_count + 1))
      ;;
    Bash)
      # Inspect the command's first token.
      first_word=$(printf '%s' "$cmd" | awk '{print $1}' | tr -d '`"')
      case "$first_word" in
        grep|cat|head|tail|less|ls|find|test|diff|file|wc|stat|hexdump|sha256sum|md5sum| \
        git|jq|cargo|npm|pnpm|yarn|bun|pytest|jest|vitest|tsc|eslint|ruff|pylint| \
        echo|printf|date|which|whereis|env|printenv|true|false|sed|awk|cut|sort|uniq| \
        curl|wget|tree|column|tr)
          # Need to refine git/npm/cargo: only verification subcommands count.
          # Coarse heuristic: anything that doesn't write is verification.
          if [[ "$cmd" =~ (git[[:space:]]+(log|diff|show|blame|status|grep|ls-files)| \
              npm[[:space:]]+(test|run[[:space:]]+test|ls|view)| \
              cargo[[:space:]]+(test|check|tree)| \
              pnpm[[:space:]]+test| \
              ^(grep|cat|head|tail|less|ls|find|file|wc|stat|sha|md5|jq|sed|awk|cut|sort|uniq|tr|column|tree|test|diff|hexdump|env|printenv|date|which|whereis|echo|printf|true|false|curl[[:space:]]+(-I|--head))) ]]; then
            verification_count=$((verification_count + 1))
          else
            non_verification_count=$((non_verification_count + 1))
          fi
          ;;
        *)
          non_verification_count=$((non_verification_count + 1))
          ;;
      esac
      ;;
    mcp__*search*|mcp__*get*|mcp__*read*|mcp__*list*)
      verification_count=$((verification_count + 1))
      ;;
    Edit|Write|MultiEdit|NotebookEdit)
      non_verification_count=$((non_verification_count + 1))
      ;;
    *)
      non_verification_count=$((non_verification_count + 1))
      ;;
  esac
done <<< "$tool_calls"

# ─── Detect time-sensitive [KNOWN] claims ──────────────────────────────────
# Look for [KNOWN] within ~80 chars of a time-sensitive trigger.
stale_known=0
if [ "$known_count" -gt 0 ]; then
  # Search for any [KNOWN ...] line that also contains a staleness signal.
  stale_known=$(grep -oE '.{0,80}\[KNOWN[^]]*\].{0,80}' <<< "$assistant_text" \
    | grep -ciE "latest|newest|current(ly)?|today|recently|just (released|came out)|version[[:space:]]+[0-9]|GPT-[0-9]|Claude[[:space:]]*[0-9]|Node[[:space:]]*[0-9]|python[[:space:]]*[0-9]|released[[:space:]]+in" \
    || echo 0)
  stale_known=$(printf '%s' "$stale_known" | tr -d '\n')
  [ -z "$stale_known" ] && stale_known=0
fi

# ─── Decide whether to warn ────────────────────────────────────────────────
warnings=()
if [ "$verified_count" -gt 0 ] && [ "$verification_count" -eq 0 ]; then
  warnings+=("⚠ Tag audit: ${verified_count}× [VERIFIED] this turn with zero observable verification action (no Read/Grep/inspection Bash). Self-grading without evidence. Treat as [INFERRED] until re-checked.")
fi
if [ "$verified_count" -gt $((verification_count * 3 + 2)) ]; then
  warnings+=("⚠ Tag audit: ${verified_count}× [VERIFIED] but only ${verification_count} verification tool calls. Claim density exceeds evidence density. Some [VERIFIED] are likely [INFERRED] at best.")
fi
if [ "$stale_known" -gt 0 ]; then
  warnings+=("⚠ Tag audit: ${stale_known}× [KNOWN] tag on time-sensitive subject(s) (versions / 'latest' / 'current'). Training data goes stale. Downgrade to [STALE] or re-verify via web search.")
fi

# ─── Tag mix: how much of this turn was grounded vs guessed ────────────────
# Everything above detects protocol *violations*. This block answers the
# plainer question the tags exist for: how much of what I just said did I
# actually check? Prints whenever the turn carries enough tags to form a
# distribution (>=3), so one-tag asides stay quiet. Disable: CUE_TAG_MIX_OFF=1.
mix_line=""
if [ "${CUE_TAG_MIX_OFF:-}" != "1" ] && [ "$claim_count" -ge 3 ]; then
  green_pct=$((green_count * 100 / claim_count))
  soft_pct=$(((orange_count + red_count) * 100 / claim_count))
  mix_line="$(printf '🕵 Tag mix (%d claims): 🟢%d 🟡%d 🟠%d 🔴%d — %d%% grounded, %d%% guess-or-worse' \
    "$claim_count" "$green_count" "$yellow_count" "$orange_count" "$red_count" \
    "$green_pct" "$soft_pct")"
  [ "$correction_count" -gt 0 ] && mix_line="${mix_line} | ${correction_count}x [CORRECTION]"
fi

[ "${#warnings[@]}" -eq 0 ] && [ -z "$mix_line" ] && exit 0

# ─── Opt-in: auto-log detected miscalibrations to the calibration scoreboard ─
# The always-on audit detects exactly the events the scoreboard wants to tally
# (evidence-less [VERIFIED], stale [KNOWN]). When the auto-log gate exists,
# append one JSONL record per detected event in the same format as
# scripts/calibration-log.sh, so no cross-tree path dependency. Gated so the
# log doesn't grow unasked. Fail-open: any error is ignored.
# Enable: touch ${HOME}/.config/cue/liedetector-calibration-auto
cal_gate="${HOME}/.config/cue/liedetector-calibration-auto"
if [ -f "$cal_gate" ]; then
  cal_log="${HOME}/.config/cue/liedetector-calibration.log"
  cal_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  cal_append() {  # $1=tag  $2=note
    local t n
    t="$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    n="$(printf '%s' "$2" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    printf '{"ts":"%s","tag":"%s","note":"%s"}\n' "$cal_ts" "$t" "$n" >> "$cal_log" 2>/dev/null || true
  }
  if [ "$verified_count" -gt 0 ] && [ "$verification_count" -eq 0 ]; then
    cal_append "VERIFIED" "auto(tag-audit): ${verified_count}x [VERIFIED] with 0 verification tool calls"
  fi
  if [ "$verified_count" -gt $((verification_count * 3 + 2)) ]; then
    cal_append "VERIFIED" "auto(tag-audit): verified-density (${verified_count}) exceeds evidence-density (${verification_count})"
  fi
  if [ "$stale_known" -gt 0 ]; then
    cal_append "KNOWN" "auto(tag-audit): ${stale_known}x time-sensitive [KNOWN] claim"
  fi
fi

# ─── Emit warnings to stderr (Claude Code surfaces) ────────────────────────
{
  printf '\n'
  [ -n "$mix_line" ] && printf '%s\n' "$mix_line"
  if [ "${#warnings[@]}" -gt 0 ]; then
    for w in "${warnings[@]}"; do printf '%s\n' "$w"; done
    printf '   (turn tool calls: %d verification, %d non-verification | suppress with [skip-tag-audit])\n' \
      "$verification_count" "$non_verification_count"
  fi
} >&2

exit 0
