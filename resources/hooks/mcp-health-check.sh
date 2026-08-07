#!/usr/bin/env bash
# SessionStart hook — tell the agent which MCP servers in the active profile
# are actually dead.
#
# A broken MCP is invisible: the server fails to start, its tools never appear,
# and the agent simply concludes the capability does not exist — then works
# around it or tells the user it is unavailable. secret-mcp sat dead in eight
# profiles for weeks that way, and `cue mcps health` reported it green the whole
# time because the old check only ran `which` on the wrapper command.
#
# So: run the real handshake probe once a day, and if anything is down, say so
# in context where the agent can act on it — including which skills declare a
# dependency on the dead server, and the exact command to drop it.
#
# Always safe: emits nothing and exits 0 when jq or cue are missing, the probe
# fails, or it already ran today.
#
# Tunables:
#   CUE_MCP_HEALTH_OFF=1   disable entirely
#   Stamp: ~/.config/cue/mcp-health-stamp (date of last run; delete to re-run)

set -uo pipefail

[ "${CUE_MCP_HEALTH_OFF:-}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v cue >/dev/null 2>&1 || exit 0

# Once per day. The probe spawns every server in the profile, so it is far too
# expensive to run on every session.
stamp_dir="${XDG_CONFIG_HOME:-$HOME/.config}/cue"
stamp="$stamp_dir/mcp-health-stamp"
today="$(date +%F)" || exit 0
[ -n "$today" ] || exit 0
[ -f "$stamp" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$today" ] && exit 0

# Exits 1 when something is down, which is the interesting case — so ignore the
# status and read the payload.
health="$(timeout 90 cue mcps health --json 2>/dev/null)" || true
[ -n "$health" ] || exit 0
echo "$health" | jq -e 'type == "array"' >/dev/null 2>&1 || exit 0

mkdir -p "$stamp_dir" 2>/dev/null && printf '%s' "$today" > "$stamp" 2>/dev/null

dead="$(echo "$health" | jq -r '[.[] | select(.status == "down")]')"
count="$(echo "$dead" | jq -r 'length')"
[ "${count:-0}" -gt 0 ] 2>/dev/null || exit 0

# Skills that declare a dependency on a dead server are dead too, in the sense
# that their documented flow cannot run. Naming them saves the agent from
# discovering it mid-task.
catalog=""
for candidate in \
  "$HOME/Documents/cue/resources/skills/catalog/index.json" \
  "${CUE_HOME:-}/resources/skills/catalog/index.json"; do
  [ -f "$candidate" ] && { catalog="$candidate"; break; }
done

printf '⚠️  MCP health: %s server(s) in this profile are not running.\n\n' "$count"

echo "$dead" | jq -r '.[] | "   ✗ \(.id) — \(.reason // "no response")"'

if [ -n "$catalog" ]; then
  affected="$(
    echo "$dead" | jq -r '.[].id' | while read -r id; do
      [ -n "$id" ] || continue
      # The parens around the index() are load-bearing: `|` binds looser than
      # `and`, so without them jq pipes a boolean into index() and dies.
      jq -r --arg id "$id" '
        (if type == "object" and has("skills") then .skills else . end)
        | (if type == "object" then [.[]] else . end)
        | map(select(type == "object" and ((.requires.mcps // []) | index($id))))
        | .[] | "   ↳ skill \(.id // .name) needs \($id)"
      ' "$catalog" 2>/dev/null
    done
  )"
  [ -n "$affected" ] && { printf '\n'; printf '%s\n' "$affected"; }
fi

cat <<'EOF'

These tools are unavailable this session — do not report their capability as
missing without saying why. Offer the user the removal, do not run it unasked:
  cue mcps remove <id>
EOF

exit 0
