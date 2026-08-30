#!/usr/bin/env bash
# SessionStart hook — once-a-day coding-agent spend summary via ccusage.
#
# Prints a one-line systemMessage (today / yesterday / last-7d cost) on the
# FIRST session of each day, so token spend is visible without asking. Pairs
# with the tools/ccusage skill (ask-for-details) and the ccusage statusline
# (live per-session view) — this hook is the daily digest between them.
#
# Always safe: emits nothing and exits 0 when ccusage, bun/npx, or jq are
# missing, the report fails, or it already ran today. No context tokens —
# systemMessage is display-only.
#
# Tunables:
#   CUE_CCUSAGE_DAILY_OFF=1   disable entirely
#   Stamp: ~/.config/cue/ccusage-daily-stamp (date of last run; delete to re-run)

set -uo pipefail

[ "${CUE_CCUSAGE_DAILY_OFF:-}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

# Prefer bun (ccusage's recommended runner, caches after first fetch), fall back to npx.
RUNNER=""
if command -v bun >/dev/null 2>&1; then RUNNER="bun x ccusage"
elif command -v npx >/dev/null 2>&1; then RUNNER="npx -y ccusage@latest"
else exit 0; fi

# Once per day: stamp file holds the date of the last successful report.
stamp_dir="${XDG_CONFIG_HOME:-$HOME/.config}/cue"
stamp="$stamp_dir/ccusage-daily-stamp"
today="$(date +%F)" || exit 0
[ -n "$today" ] || exit 0
[ -f "$stamp" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$today" ] && exit 0

since="$(date -d '6 days ago' +%F 2>/dev/null || date -v-6d +%F 2>/dev/null)" || exit 0
yesterday="$(date -d 'yesterday' +%F 2>/dev/null || date -v-1d +%F 2>/dev/null)" || exit 0

# --offline prices from the cached LiteLLM snapshot (fast, no network). If that
# fails (e.g. cold cache), retry once online before giving up.
json="$(timeout 45 $RUNNER daily --json --offline --since "$since" 2>/dev/null)" \
  || json="$(timeout 60 $RUNNER daily --json --since "$since" 2>/dev/null)" \
  || exit 0
[ -n "$json" ] || exit 0

# Rows carry `period` (YYYY-MM-DD) and `agent` ("all" in the unified report);
# keep only the "all" rows so per-agent rows can never double-count.
summary="$(printf '%s' "$json" | jq -r --arg t "$today" --arg y "$yesterday" '
  ([(.daily // [])[] | select((.agent // "all") == "all")]) as $d
  | def cost($day): (([$d[] | select(.period == $day) | .totalCost] | add) // 0) * 100 | round / 100;
  (([$d[].totalCost] | add // 0) * 100 | round / 100) as $week
  | "ccusage — today $\(cost($t)) · yesterday $\(cost($y)) · last 7d $\($week). Run `bunx ccusage` for the full table."
' 2>/dev/null)" || exit 0
[ -n "$summary" ] || exit 0

# JSON-encode first and verify, so a failed encode can never emit the
# malformed `{"systemMessage": }` — the hook contract is one valid JSON
# line or nothing. Stamp only after the encode is confirmed, so a failed
# day retries instead of being silenced until tomorrow.
encoded="$(printf '%s' "$summary" | jq -Rs .)" || exit 0
[ -n "$encoded" ] || exit 0
mkdir -p "$stamp_dir" 2>/dev/null && printf '%s' "$today" > "$stamp" 2>/dev/null

# systemMessage = shown to the user, not injected into model context.
printf '{"systemMessage": %s}\n' "$encoded"
exit 0
