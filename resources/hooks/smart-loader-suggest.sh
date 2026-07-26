#!/usr/bin/env bash
# UserPromptSubmit hook — Tier 1 of on-demand skill resolution.
#
# For every user prompt, decide whether some skill OUTSIDE the active profile is
# worth surfacing, and print it as a "💡 Available skills" context block.
#
# This script is a GATE, not a ranker. `smart-lookup.sh` already owns the
# authoritative scoring, the loaded-skill set (from the materializer manifest)
# and MCP-availability detection; duplicating any of that here would mean two
# implementations drifting apart. All this decides is *whether* to call it, and
# *with which words*.
#
# The old gate was the bug this rewrite fixes: it only fired when a prompt token
# was literally a skill NAME or CATEGORY (length >=4). "coolify" matched;
# "a fizetés nem megy az adminban" never reached the matcher at all, so
# stripe-best-practices could not be surfaced. The gate now runs against the
# enriched index (`cue resolve --rebuild`), which carries trigger phrases mined
# from every skill's description, plus tags, capability and anti-scope.
#
# Performance contract: <200ms p95. Achieved by:
#   - Pre-built flat index files with the WEIGHTS ALREADY BAKED IN, so this
#     script only ever sums a numeric column and never encodes a weight.
#   - One awk pass over ~18k lines (phrases + terms) — no per-keyword fan-out.
#   - A single smart-lookup call with the matched terms, not one call per word.
#   - Throttling per-session to once per ~500ms (epoch-ms stored in file).
#
# Degradation: when the index files are absent (fresh clone, never resolved),
# this falls back to the legacy name-only keyword gate and kicks off ONE
# background rebuild, so the next prompt gets the good path.
#
# Exit codes: 0 always (observability hook, never a gate).

set -uo pipefail

payload="$(cat -)"
LOOKUP="${CUE_SMART_LOOKUP:-$HOME/Documents/cue/resources/skills/skills/meta/smart-loader/scripts/smart-lookup.sh}"
CATALOG="${CUE_CATALOG:-$HOME/Documents/cue/resources/skills/catalog/catalog.json}"
IDX_DIR="${CUE_SKILL_INDEX_DIR:-$HOME/.cache/cue/skill-index}"
JOURNAL="${CUE_RESOLVE_JOURNAL:-${XDG_CONFIG_HOME:-$HOME/.config}/cue/skill-resolve.jsonl}"
CACHE_DIR="${XDG_RUNTIME_DIR:-/tmp}/cue-smart-loader-suggest"
KW_INDEX="$CACHE_DIR/vendor-keywords.txt"
mkdir -p "$CACHE_DIR" 2>/dev/null || exit 0

extract() {
  printf '%s' "$payload" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 \
    | sed "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"//; s/\"$//"
}

prompt="$(extract prompt)"
session_id="$(extract session_id)"
cwd="$(extract cwd)"
[ -z "$cwd" ] && cwd="$PWD"
[ -z "$prompt" ] && exit 0
[ "${#prompt}" -lt 8 ] && exit 0

# Per-session throttle, millisecond resolution. Skip if last run <500ms ago.
throttle_file="$CACHE_DIR/throttle.${session_id:-default}"
now_ms=$(date +%s%3N)
last_ms=$(cat "$throttle_file" 2>/dev/null || echo 0)
if [ $((now_ms - last_ms)) -lt 500 ]; then exit 0; fi
printf '%s' "$now_ms" > "$throttle_file"

prompt_lc=$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]')

# ─── Tunables, straight from the index build ──────────────────────────────
# Defaults mirror src/lib/catalog-index.ts. weights.env overrides them, so a
# change to the TypeScript constants propagates here on the next rebuild
# instead of drifting silently.
CUE_IDX_THRESHOLD=6
CUE_IDX_MULTI_BONUS=1.5
CUE_IDX_MIN_TERM=4
# shellcheck disable=SC1090
[ -f "$IDX_DIR/weights.env" ] && . "$IDX_DIR/weights.env" 2>/dev/null

# ─── Background rebuild when the index is missing ─────────────────────────
# One attempt per hour, detached, output discarded. This turn still uses the
# legacy path; the next one gets the enriched index.
maybe_rebuild() {
  local stamp="$CACHE_DIR/rebuild.stamp" last=0 now_s="${now_ms%???}"
  [ -f "$stamp" ] && last=$(cat "$stamp" 2>/dev/null || echo 0)
  [ $(( now_s - last )) -lt 3600 ] && return 0
  printf '%s' "$now_s" > "$stamp"
  command -v cue >/dev/null 2>&1 || return 0
  ( cue resolve --rebuild >/dev/null 2>&1 & ) &
}

# ═══ Legacy gate ══════════════════════════════════════════════════════════
# Name/category-only keyword intersection. Kept verbatim as the fallback for
# when the enriched index isn't built yet — worse recall, but never worse than
# what shipped before.
legacy_keywords() {
  local need_rebuild=0 cat_mtime idx_mtime toks
  if [ ! -f "$KW_INDEX" ]; then
    need_rebuild=1
  elif [ -f "$CATALOG" ]; then
    cat_mtime=$(stat -c '%Y' "$CATALOG" 2>/dev/null || echo 0)
    idx_mtime=$(stat -c '%Y' "$KW_INDEX" 2>/dev/null || echo 0)
    [ "$cat_mtime" -gt "$idx_mtime" ] && need_rebuild=1
  fi
  if [ "$need_rebuild" -eq 1 ] && [ -f "$CATALOG" ] && command -v jq >/dev/null 2>&1; then
    jq -r '
      .installed[] |
      [
        ((.name // "") | ascii_downcase),
        ((.category // "") | ascii_downcase)
      ] +
      ((.name // "") | ascii_downcase | split("-") | . as $parts |
       [range(1; length) | $parts[0:.] | join("-")]) |
      .[] |
      select(length >= 4)
    ' "$CATALOG" 2>/dev/null \
      | sort -u > "$KW_INDEX.tmp" && mv "$KW_INDEX.tmp" "$KW_INDEX"
  fi
  [ ! -s "$KW_INDEX" ] && return 1

  toks=$(printf '%s' "$prompt_lc" | tr -c 'a-z0-9_-' '\n' \
    | awk -v m="$CUE_IDX_MIN_TERM" 'length($0) >= m && length($0) <= 30' | sort -u)
  [ -z "$toks" ] && return 1
  grep -Fxf "$KW_INDEX" <<< "$toks" 2>/dev/null | head -3
}

# ═══ Indexed gate ═════════════════════════════════════════════════════════
# Score the prompt against the enriched index and emit the matched terms of the
# top-scoring skills — those become the smart-lookup query.
#
# Both index files are `<key>\t<weight>\t<skill-id>`; the weight column is
# computed in TypeScript at build time (WEIGHTS in catalog-index.ts). Negative
# weights are anti-scope ("NOT for ...") and correctly subtract here.
indexed_terms() {
  [ -s "$IDX_DIR/phrases.idx" ] || return 1
  [ -s "$IDX_DIR/terms.idx" ] || return 1

  # MUST mirror tokenize()/foldPlural() in src/lib/catalog-index.ts: terms.idx
  # is written with plurals folded, so a raw prompt token would silently fail
  # to match. The hook test asserts the two agree behaviourally.
  local tokfile="$CACHE_DIR/tokens.$$"
  printf '%s' "$prompt_lc" | tr -c '[:alnum:]_-' '\n' \
    | awk -v m="$CUE_IDX_MIN_TERM" '
        length($0) >= m && length($0) <= 30 {
          t = $0
          # ASCII only — a trailing "s" is a plural in English but not in
          # Hungarian, where folding would wreck "közbeszerzés".
          if (length(t) > m && t ~ /^[a-z0-9-]+$/ && t ~ /s$/ && t !~ /(ss|us|is)$/)
            t = substr(t, 1, length(t) - 1)
          if (length(t) >= m) print t
        }' \
    | sort -u > "$tokfile"
  if [ ! -s "$tokfile" ]; then rm -f "$tokfile"; return 1; fi

  awk -v prompt=" $prompt_lc " \
      -v thr="$CUE_IDX_THRESHOLD" \
      -v bonus="$CUE_IDX_MULTI_BONUS" \
      -v tokf="$tokfile" \
      -F '\t' '
    FILENAME == tokf { tok[$0] = 1; next }

    # Trigger phrases: substring match against the whole prompt, so multi-word
    # phrases ("find EU tenders", "közbeszerzés") work.
    FILENAME ~ /phrases\.idx$/ {
      if (index(prompt, $1) > 0) {
        score[$3] += $2
        if (!seen[$3 SUBSEP $1]++) { nhit[$3]++; terms[$3] = terms[$3] " " $1 }
      }
      next
    }

    # Single terms: set membership against the prompt token set.
    {
      if ($1 in tok) {
        score[$3] += $2
        # Only positive fields earn a distinct-hit credit; anti-scope terms
        # subtract but must never buy the multi-token bonus.
        if ($2 > 0 && !seen[$3 SUBSEP $1]++) { nhit[$3]++; terms[$3] = terms[$3] " " $1 }
      }
    }

    END {
      for (id in score) {
        s = score[id]
        if (nhit[id] >= 2) s = s * bonus
        if (s >= thr) printf "%d\t%s\t%s\n", s, id, terms[id]
      }
    }
  ' "$tokfile" "$IDX_DIR/phrases.idx" "$IDX_DIR/terms.idx" \
    | sort -t$'\t' -k1,1nr | head -5

  rm -f "$tokfile"
}

# ─── Run the gate ─────────────────────────────────────────────────────────
[ ! -x "$LOOKUP" ] && exit 0

query_words=""
rows=""
if scored=$(indexed_terms) && [ -n "$scored" ]; then
  # The index already ranked these. smart-lookup is asked only for the two
  # things the hook can't compute cheaply — is it already loaded, and are its
  # MCPs available — via --annotate, which reads just the named SKILL.md files.
  # Calling its search path here instead would cost ~6s: it greps every
  # SKILL.md body per token and scores candidates in a bash loop.
  ids=$(printf '%s' "$scored" | cut -f2 | head -3 | paste -sd' ' -)
  # Matched terms, deduped — only used for the `cue resolve` hint line.
  query_words=$(printf '%s' "$scored" | cut -f3- | tr ' ' '\n' \
    | awk 'NF' | awk '!seen[$0]++' | head -5 | paste -sd' ' -)
  # shellcheck disable=SC2086  # deliberate word-splitting into an id list
  [ -n "$ids" ] && rows=$(bash "$LOOKUP" --annotate --exclude-loaded $ids 2>/dev/null)
else
  # Legacy fallback: the enriched index isn't built yet, so we have keywords
  # rather than ids and must pay for the search path. One call with all
  # keywords, not the old one-call-per-keyword loop.
  maybe_rebuild
  query_words=$(legacy_keywords | paste -sd' ' -)
  [ -z "$query_words" ] && exit 0
  # shellcheck disable=SC2086  # deliberate word-splitting into a query
  rows=$(bash "$LOOKUP" --exclude-loaded --no-fuzzy --limit 3 $query_words 2>/dev/null)
fi

[ -z "$rows" ] && exit 0

declare -A seen_skills
hits=()
while IFS=$'\t' read -r cat_name path score desc mcp_status; do
  [ -z "$cat_name" ] && continue
  # Drop the smart-loader self-reference — its description lists examples of
  # every vendor, so it matches almost anything.
  [ "$cat_name" = "meta/smart-loader" ] && continue
  [ -n "${seen_skills[$cat_name]:-}" ] && continue
  seen_skills[$cat_name]=1
  short_desc=$(printf '%s' "$desc" | cut -c1-70)
  mcp_note=""
  case "$mcp_status" in
    missing:*) mcp_note=" (needs MCP: ${mcp_status#missing:})" ;;
  esac
  hits+=("$cat_name|$short_desc|$mcp_note")
  [ "${#hits[@]}" -ge 3 ] && break
done <<< "$rows"

[ "${#hits[@]}" -eq 0 ] && exit 0

# ─── Promotion counter ────────────────────────────────────────────────────
# How many times has this skill been resolved in THIS directory before? Three
# is the point where "keep it" beats re-resolving. Read-only: we print the
# command, we never run it.
promo_for() {
  local id="$1" n
  [ -f "$JOURNAL" ] || return 0
  # id and cwd are matched independently so this doesn't depend on JSON key
  # order. tail bounds the cost as the journal grows.
  n=$(tail -n 2000 "$JOURNAL" 2>/dev/null \
    | grep -F "\"id\":\"$id\"" 2>/dev/null \
    | grep -Fc "\"cwd\":\"$cwd\"" 2>/dev/null || true)
  [ -z "$n" ] && n=0
  [ "$n" -ge 3 ] && printf '%s' "$n"
  return 0
}

printf '💡 Available skills (not in active profile):\n'
for hit in "${hits[@]}"; do
  IFS='|' read -r cat_name short_desc mcp_note <<< "$hit"
  printf '   - %s%s\n' "$cat_name" "$mcp_note"
  [ -n "$short_desc" ] && printf '     %s\n' "$short_desc"
  n=$(promo_for "$cat_name")
  [ -n "$n" ] && printf '     ↑ resolved %s× here — keep it: cue loadout keep %s\n' "$n" "$cat_name"
done
printf '   Use meta/smart-loader to read the SKILL.md from disk.\n'
printf '   Full ranking + fidelity check: cue resolve %s\n' "$query_words"

# ─── Journal ──────────────────────────────────────────────────────────────
# Best-effort append; feeds the promotion counter above. Local only, no
# telemetry gate (mirrors src/lib/skill-resolve-journal.ts).
if mkdir -p "$(dirname "$JOURNAL")" 2>/dev/null; then
  ts=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  for hit in "${hits[@]}"; do
    IFS='|' read -r cat_name _ _ <<< "$hit"
    printf '{"ts":"%s","id":"%s","cwd":"%s","profile":"","tier":1,"score":0}\n' \
      "$ts" "$cat_name" "$cwd" >> "$JOURNAL" 2>/dev/null || true
  done
fi

exit 0
