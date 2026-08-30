#!/usr/bin/env bash
# Stop hook — scan the full session transcript for skill SKILL.md references
# and append one skill_hit event per unique skill to ~/.config/cue/analytics.jsonl.
#
# Replaces the 50KB regex scrape in src/lib/analytics.ts:recordSkillUsage with
# a full-transcript scan that catches skills mentioned anywhere in the session,
# not just the first 50KB.
#
# No external deps (no jq). Reads the Stop payload from stdin.

set -euo pipefail

payload="$(cat -)"
log_dir="${HOME}/.config/cue"
log="${log_dir}/analytics.jsonl"
journal="${log_dir}/skill-resolve.jsonl"
mkdir -p "$log_dir"

# Extract fields from payload — best-effort, no jq.
extract() {
  printf '%s' "$payload" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"//; s/\"$//" || true
}

session_id="$(extract session_id)"
transcript_path="$(extract transcript_path)"
cwd="$(pwd)"

# Determine the cue profile in this cwd (matches the resolution cue launch uses).
profile=""
if [[ -f .cue-profile ]]; then
  profile="$(head -1 .cue-profile | tr -d '[:space:]')"
fi
profile="${profile:-${CUE_PROFILE:-unknown}}"

# Without a transcript we have nothing to scan. Fail silent — this is an
# observability hook, not a gate.
if [[ -z "$transcript_path" || ! -r "$transcript_path" ]]; then
  exit 0
fi

# Skill IDs are `<category>/<slug>` and appear in the transcript as part of
# SKILL.md absolute paths injected at session start. Extract uniques.
# Pattern: `skills/<cat>/<slug>/SKILL.md` (the bit cue uses) — we don't
# anchor on `^` because the path is embedded in transcript JSON strings.
skills="$(grep -oE 'skills/[a-z][a-z0-9-]*/[a-z][a-z0-9-]*/SKILL\.md' "$transcript_path" \
  | sed -E 's|skills/([a-z][a-z0-9-]*/[a-z][a-z0-9-]*)/SKILL\.md|\1|' \
  | sort -u || true)"

if [[ -z "$skills" ]]; then
  exit 0
fi

ts="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
agent="claude-code"

# Capture the first user prompt of the session so description-optimizer can
# correlate skill_hit events with the prompts that triggered them. Strategy:
# find the first transcript line with `"type":"user"`, extract the first 200
# chars of message content, then JSON-escape for safe embedding.
first_prompt=""
raw_prompt="$(grep -m1 '"type":"user"' "$transcript_path" 2>/dev/null \
  | sed -E 's/.*"message"[[:space:]]*:[[:space:]]*\{[^}]*"content"[[:space:]]*:[[:space:]]*"([^"]{0,200}).*/\1/' \
  || true)"
if [[ -n "$raw_prompt" && "$raw_prompt" != *'"type":"user"'* ]]; then
  # Already JSON-escaped in the transcript; pass through verbatim.
  first_prompt="$raw_prompt"
fi

# Append one skill_hit event per detected skill. We include session_id (the
# in-process recorder doesn't), which is what `cue profile evolve` uses to
# group skills into co-firing sets, plus first_prompt for trigger-attribution.
while IFS= read -r skill; do
  [[ -z "$skill" ]] && continue
  printf '{"ts":"%s","event":"skill_hit","profile":"%s","agent":"%s","cwd":"%s","skill":"%s","session_id":"%s","first_prompt":"%s","source":"hook"}\n' \
    "$ts" "$profile" "$agent" "$cwd" "$skill" "$session_id" "$first_prompt" >> "$log"
  printf '{"ts":"%s","id":"%s","cwd":"%s","profile":"%s","stage":"loaded"}\n' \
    "$ts" "$skill" "$cwd" "$profile" >> "$journal"
done <<< "$skills"

exit 0
