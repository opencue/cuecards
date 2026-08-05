#!/usr/bin/env bash
# Throwaway. Prints the inputs the smart-loader hook scores against, so a CI
# runner and a developer box can be diffed line for line.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
export CUE_SMART_LOOKUP="$REPO/resources/skills/skills/meta/smart-loader/scripts/smart-lookup.sh"
export CUE_CATALOG="$REPO/resources/skills/catalog/catalog.json"
export CUE_SKILLS_ROOT="$REPO/resources/skills/skills"
IDX="$(mktemp -d)/skill-index"

echo "### env"
echo "bun=$(bun --version) awk=$(awk -W version 2>&1 | head -1) lang=${LANG:-unset} lcall=${LC_ALL:-unset}"
echo "skillmd_count=$(find "$CUE_SKILLS_ROOT" -name SKILL.md | wc -l)"
echo "catalog_sha=$(sha256sum "$CUE_CATALOG" | cut -c1-16)"
echo "submodule=$(git -C "$REPO/resources/skills" rev-parse --short HEAD 2>/dev/null || echo '?')"

echo "### build the index exactly as beforeAll does"
CUE_SKILL_INDEX_DIR="$IDX" bun -e '
  import { buildIndex, writeMatcherIndex } from "./src/lib/catalog-index";
  const idx = buildIndex({ catalog: process.env.CUE_CATALOG, root: process.env.CUE_SKILLS_ROOT });
  console.log("buildIndex keys=" + JSON.stringify(Object.keys(idx)));
  const stats = writeMatcherIndex(idx, process.env.CUE_SKILL_INDEX_DIR);
  console.log("writeMatcherIndex=" + JSON.stringify(stats));
'
echo "idx_files=$(ls -la "$IDX" | tail -n +4 | awk '{print $9"="$5}' | paste -sd' ' -)"
echo "weights=$(tr '\n' ' ' < "$IDX/weights.env")"
echo "terms_lines=$(wc -l < "$IDX/terms.idx") phrases_lines=$(wc -l < "$IDX/phrases.idx")"

echo "### the terms the two failing prompts depend on"
for t in checkout webhook fizetes adminban stripe payment; do
  echo "term[$t] -> $(awk -F'\t' -v t="$t" '$1==t {printf "%s(%s) ", $3, $2}' "$IDX/terms.idx" | head -c 300)"
done
echo "### phrases matching the Hungarian prompt"
awk -F'\t' 'tolower($1) ~ /zbeszerz|ly.zat|keres/ {printf "phrase[%s] %s(%s)\n", $1, $3, $2}' "$IDX/phrases.idx" | head -10

echo "### do the target SKILL.md files exist?"
for s in stripe/stripe-best-practices eu-funding/hu-grant-finder deployment/coolify; do
  echo "skill[$s] = $([ -f "$CUE_SKILLS_ROOT/$s/SKILL.md" ] && echo present || echo MISSING)"
done

echo "### hook scoring for the two failing prompts"
for p in "a fizetes nem megy az adminban, checkout es webhook hibas" "közbeszerzés pályázat keresés"; do
  echo "--- prompt: $p"
  H=$(mktemp -d)
  printf '{"prompt":"%s","session_id":"diag-%s","cwd":"/tmp"}' "$p" "$$-$RANDOM" \
    | HOME="$H" CUE_ACTIVE_PROFILE="" CLAUDE_CONFIG_DIR="" CUE_SKILL_INDEX_DIR="$IDX" \
      bash -x "$REPO/resources/hooks/smart-loader-suggest.sh" 2>&1 \
    | grep -E "^\+ scored=|^\+ rows=|^\+ ids=|^\+ query_words=|^\+ exit|Available skills|^   - " | head -12
  rm -rf "$H"
done
