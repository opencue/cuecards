#!/usr/bin/env bash
# UserPromptSubmit hook — classify a user prompt by task hardness and inject a
# one-line model-routing reminder. Pairs with the "Model routing" persona block
# in profiles/core/profile.yaml.
#
#   🧠 HARD (plan/architect/decide/root-cause/security/big-refactor)
#        → keep the main session on Opus; don't delegate the judgment.
#   🔍 EASY/SEARCH (web search/find/look up/scrape/summarize/list)
#        → delegate to a Sonnet subagent (Agent/Explore); cheaper, automatic.
#   ⚙️ MECHANICAL (rename/reformat/version bump/typo/boilerplate)
#        → delegate to a Sonnet/Haiku subagent, or just do it inline if trivial.
#
# Token-effective by design: emits AT MOST one short line, ONLY on a confident
# match, throttled once per ~5 min per session. Silent on everything ambiguous
# so it adds ~0 per-message tokens. Non-blocking: exit 0 always; never gates a
# prompt. Suppress for a single turn with [skip-route] in the prompt.

set -uo pipefail

payload="$(cat -)"
CACHE_DIR="${XDG_RUNTIME_DIR:-/tmp}/cue-model-route-nudge"
mkdir -p "$CACHE_DIR" 2>/dev/null || exit 0

extract() {
  printf '%s' "$payload" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 \
    | sed "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"//; s/\"$//"
}

prompt="$(extract prompt)"
session_id="$(extract session_id)"
[ -z "$prompt" ] && exit 0
[ "${#prompt}" -lt 12 ] && exit 0

prompt_lc="$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]')"

# Per-turn suppression.
case "$prompt_lc" in
  *"[skip-route]"*) exit 0 ;;
esac

# Classify. HARD is checked FIRST: a prompt that mentions both planning and a
# lookup ("plan how to search the index") is HARD — never delegate the judgment.
# Patterns are deliberately conservative — a false HARD nudge mis-routes a user
# on their first prompt and then the throttle silences real ones for 5 min, so
# only consequential signals match (not bare "design"/"architecture"/"security").
class=""
if printf '%s' "$prompt_lc" | grep -qE \
  'plan (the|a|an|this|our|out|for|how)|\barchitect\b|architecture (of|for|decision|review|change)|design (the|a|this|our) (system|architecture|api|schema|database|service|workflow|protocol|approach|strategy|solution|data model)|trade.?off|\bdecide\b|which approach|how should (we|i) (approach|architect|design|structure|model|choose|decide|handle)|root.?cause|debug why|why is .* (broken|failing|slow|crashing)|\bsecurity\b|vulnerab|threat model|refactor .*(across|all|every|whole|entire|multiple)|rethink|\bstrateg(y|ic)\b'; then
  class=hard
elif printf '%s' "$prompt_lc" | grep -qE \
  '\bsearch\b|web search|google|look up|look for|find (the |a |an )?(docs?|documentation|examples?|reference|api|package|librar|module|gem|crate|tool|where|how)|docs? for|documentation|scrape|summari[sz]e|list (the|all|every)|research '; then
  class=search
elif printf '%s' "$prompt_lc" | grep -qE \
  '\brename\b|re-?format|\bformat (the|this|all)|bump (the )?version|version bump|typo|boilerplate|find and replace|lint fix|fix lint|reindent'; then
  class=mechanical
else
  exit 0
fi

# Throttle: once per 300s per session. Guard date so an exotic env (no date)
# fails OPEN (exit 0) rather than crashing — a non-zero exit blocks the prompt.
throttle_file="$CACHE_DIR/throttle.${session_id:-default}"
now_s=$(date +%s 2>/dev/null) || exit 0
[ -z "$now_s" ] && exit 0
last_s=$(cat "$throttle_file" 2>/dev/null || echo 0)
if [ $((now_s - last_s)) -lt 300 ]; then exit 0; fi
printf '%s' "$now_s" > "$throttle_file"

case "$class" in
  hard)
    printf '🧠 Model routing (cue): this looks HARD (planning/architecture/decision/security). Keep the main session on Opus — suggest /model claude-opus-4-8 if on Sonnet. Suppress with [skip-route].\n' ;;
  search)
    printf '🔍 Model routing (cue): this looks like EASY/SEARCH work. Delegate it to a Sonnet subagent (Agent/Explore, already pinned via CLAUDE_CODE_SUBAGENT_MODEL) and keep the conclusion, not the dumps. Suppress with [skip-route].\n' ;;
  mechanical)
    printf '⚙️ Model routing (cue): this looks MECHANICAL. Delegate to a Sonnet/Haiku subagent rather than burning Opus tokens inline (or just do it if trivial). Suppress with [skip-route].\n' ;;
esac

exit 0
