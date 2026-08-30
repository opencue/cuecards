#!/usr/bin/env bash
# Update GitHub topics on opencue/cuecards (or any repo via REPO env var).
#
# GitHub caps topics at 20 per repo. The list below is curated for highest
# search intent: claude/anthropic/codex/openai surfaces in both ai-agent and
# CLI-tool searches; mcp-server/mcp-tools/agent-skill catch the discovery
# topic feeds.
#
# Usage:
#   bash scripts/update-repo-topics.sh           # update opencue/cuecards
#   REPO=org/other-repo bash scripts/update-repo-topics.sh
#   DRY_RUN=1 bash scripts/update-repo-topics.sh
set -euo pipefail

REPO="${REPO:-opencue/cuecards}"

TOPICS=(
  ai-agents
  ai-coding
  agent-framework
  agent-skill
  anthropic
  claude
  claude-code
  claude-cli
  claude-skill
  cli
  codex
  codex-cli
  developer-tools
  mcp
  mcp-server
  mcp-tools
  openai
  plugins
  profile-manager
  skills
)

if [ "${#TOPICS[@]}" -gt 20 ]; then
  echo "✗ GitHub caps topics at 20 — got ${#TOPICS[@]}. Trim the list." >&2
  exit 1
fi

echo "▶ Repo: $REPO"
echo "▶ Setting ${#TOPICS[@]} topics:"
printf '    %s\n' "${TOPICS[@]}"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "✓ Dry-run. No changes made."
  exit 0
fi

# Build --field args
ARGS=()
for t in "${TOPICS[@]}"; do
  ARGS+=("--field" "names[]=$t")
done

gh api -X PUT "repos/$REPO/topics" "${ARGS[@]}" --jq '.names | length' >/dev/null
echo "✓ Topics updated"
gh api "repos/$REPO" --jq '.topics | .[]' | sed 's/^/    /'
