#!/usr/bin/env bash
# Stop hook — independent reviewer-agent loop (the enforced arm of
# "review before finishing"). OFF by default.
#
# When the MAIN agent finishes a code-producing turn, this hook spawns a fresh,
# INDEPENDENT reviewer agent (headless `claude -p`, Sonnet) that runs the
# code-review-deep pass over the working-tree diff. If the reviewer reports
# CRITICAL/HIGH findings, the hook returns {"decision":"block","reason":<feedback>}
# so the main agent CANNOT stop — it must address the feedback, VERIFY the fix,
# and only then finish. A clean review (or nothing to review) lets it stop.
#
# The soft arm of this behaviour is the `core` persona rule (always on); this
# hook is the hard backstop and is opt-in, mirroring careful-mode / next-steps.
#
# Opt-in: active only when ${HOME}/.config/cue/auto-review-enabled exists.
#   Enable:  touch ${HOME}/.config/cue/auto-review-enabled
#   Disable: rm    ${HOME}/.config/cue/auto-review-enabled
# Suppress one turn with [skip-auto-review] anywhere in the response.
#
# Loop safety (belt + suspenders):
#   - recursion guard: CUE_AUTO_REVIEW_INNER=1 makes the reviewer's own session
#     a no-op, so the reviewer can't re-trigger this hook recursively.
#   - diff-hash state: we record the diff we last reviewed. If the agent stops
#     again WITHOUT changing the diff, it can't make progress → let it go.
#   - round cap (MAX_ROUNDS): hard ceiling on consecutive blocks per cwd.
#
# Reviewer command is overridable for tests: set CUE_AUTO_REVIEW_CMD to a shell
# command that reads the diff on stdin and prints the verdict. Default spawns
# `claude -p --model sonnet`.
#
# Fail-open: any error (no git, no claude, timeout, malformed input) → exit 0.

set -uo pipefail

MAX_ROUNDS=2
DIFF_BUDGET=60000   # cap chars sent to the reviewer

# ─── Recursion guard ───────────────────────────────────────────────────────
[ "${CUE_AUTO_REVIEW_INNER:-}" = "1" ] && exit 0

# ─── Opt-in gate ───────────────────────────────────────────────────────────
state_file="${HOME}/.config/cue/auto-review-enabled"
[ -f "$state_file" ] || exit 0

payload="$(cat -)"
extract() {
  printf '%s' "$payload" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 \
    | sed "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"//; s/\"$//"
}
transcript_path="$(extract transcript_path)"
cwd="$(extract cwd)"
[ -z "$cwd" ] && cwd="$PWD"

# ─── Need a git repo with changes to review ────────────────────────────────
command -v git >/dev/null 2>&1 || exit 0
git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Tracked changes vs HEAD (covers staged + unstaged). Fall back to index diff
# when the repo has no commits yet.
diff="$(git -C "$cwd" diff HEAD 2>/dev/null || git -C "$cwd" diff 2>/dev/null)"

# New, untracked files are the common "agent wrote a fresh module" case — fold
# their contents in so the reviewer sees them too.
while IFS= read -r f; do
  [ -z "$f" ] && continue
  diff="${diff}
=== new file: ${f} ===
$(head -n 400 "$cwd/$f" 2>/dev/null)"
done < <(git -C "$cwd" ls-files --others --exclude-standard 2>/dev/null)

# Nothing of substance → let the turn stop.
[ -z "$(printf '%s' "$diff" | tr -d '[:space:]')" ] && exit 0
diff="$(printf '%s' "$diff" | head -c "$DIFF_BUDGET")"

# ─── Opt-out marker (scan the tail of this turn's transcript) ──────────────
if [ -n "$transcript_path" ] && [ -r "$transcript_path" ]; then
  if tail -c 20000 "$transcript_path" 2>/dev/null | grep -qF "[skip-auto-review]"; then
    exit 0
  fi
fi

# ─── Loop state: per-cwd diff hash + round count ───────────────────────────
hash_of() {
  if command -v sha1sum >/dev/null 2>&1; then printf '%s' "$1" | sha1sum | awk '{print $1}'
  else printf '%s' "$1" | shasum 2>/dev/null | awk '{print $1}'; fi
}
cwd_key="$(hash_of "$cwd")"
diff_hash="$(hash_of "$diff")"
sdir="${HOME}/.config/cue/auto-review"
mkdir -p "$sdir" 2>/dev/null || exit 0
sfile="$sdir/${cwd_key}.state"
last_hash=""; rounds=0
if [ -r "$sfile" ]; then
  last_hash="$(sed -n '1p' "$sfile" 2>/dev/null)"
  rounds="$(sed -n '2p' "$sfile" 2>/dev/null)"; rounds="${rounds:-0}"
fi

# Same diff we already reviewed → the agent didn't change anything → let it go.
if [ "$diff_hash" = "$last_hash" ]; then
  printf '%s\n0\n' "$diff_hash" > "$sfile"
  exit 0
fi
# Round ceiling hit → stop nagging, let it finish.
if [ "$rounds" -ge "$MAX_ROUNDS" ]; then
  printf '%s\n0\n' "$diff_hash" > "$sfile"
  exit 0
fi

# ─── Triviality gate (conservative): comment/whitespace/docs-only → skip ───
# An independent reviewer agent on a stale-comment fix or a docs tweak is pure
# overhead. Skip ONLY when every changed line is a comment, blank, or lone
# punctuation — any real code line falls through to review. Untracked (new)
# files are never trivial, so the gate is bypassed when any exist.
if [ -z "$(git -C "$cwd" ls-files --others --exclude-standard 2>/dev/null)" ]; then
  # (a) Docs/prose-only: every changed file is markdown/text → skip regardless
  # of content (a reworded README needs no code review).
  changed_files="$(git -C "$cwd" diff HEAD --name-only 2>/dev/null || git -C "$cwd" diff --name-only 2>/dev/null)"
  if [ -n "$changed_files" ] && ! printf '%s\n' "$changed_files" \
      | grep -qivE '\.(md|mdx|markdown|txt|rst|adoc)$|(^|/)(CHANGELOG|LICENSE|AUTHORS|NOTICE|README)([.-][^/]*)?$'; then
    printf '%s\n0\n' "$diff_hash" > "$sfile"
    exit 0
  fi
  # (b) Comment/whitespace-only across code files.
  # Changed content lines (added/removed), minus the +++/--- file headers,
  # with the leading +/- and surrounding whitespace stripped.
  bodies="$(printf '%s\n' "$diff" \
    | grep -E '^[+-]' | grep -Ev '^(\+\+\+|---)' \
    | sed -E 's/^[+-]//; s/^[[:space:]]+//; s/[[:space:]]+$//')"
  # Drop blanks, lone brackets/punctuation, and the common comment-line shapes
  # (//, #, /* */, leading-* JSDoc continuations, <!-- -->, SQL/Lua --). What
  # remains is "substantive code"; if nothing remains, the diff is trivial.
  code_lines="$(printf '%s\n' "$bodies" \
    | grep -vE '^$' \
    | grep -vE '^[][(){},;:]+$' \
    | grep -vE '^(//|#)' \
    | grep -vE '^/\*|\*/$' \
    | grep -vE '^\*( |$)' \
    | grep -vE '^(<!--|-->)' \
    | grep -vE '^--( |$)')"
  if [ -z "$(printf '%s' "$code_lines" | tr -d '[:space:]')" ]; then
    printf '%s\n0\n' "$diff_hash" > "$sfile"
    exit 0
  fi
fi

# ─── Live progress channel (best-effort; see docs/review-visibility.md) ─────
# A second pane running `cue-review-watch` renders these events live, so the user
# sees which file/dimension is under review and findings as they land instead of
# an opaque spinner. Every write is fail-open (errors ignored).
rp_dir="${HOME}/.config/cue/review-progress"
rp_id="rev-$(date -u +%Y%m%dT%H%M%SZ)-$$"
rp_file="$rp_dir/$rp_id.jsonl"
rp_esc() { printf '%s' "${1:-}" | tr -d '\000-\037' | sed 's/\\/\\\\/g; s/"/\\"/g'; }
rp_now() { date -u +%Y-%m-%dT%H:%M:%S.000Z; }
rp_write() { printf '%s\n' "$1" >> "$rp_file" 2>/dev/null || true; }
if mkdir -p "$rp_dir" 2>/dev/null; then
  printf '%s' "$rp_id" > "$rp_dir/latest" 2>/dev/null || true
  : > "$rp_file" 2>/dev/null || true
  rp_write "$(printf '{"ts":"%s","id":"%s","kind":"start","title":"auto-review","detail":"%s"}' "$(rp_now)" "$rp_id" "$(rp_esc "$cwd")")"
fi
# Parse one streamed reviewer line into a progress event.
#   PROGRESS: <file> | <what is being checked>
#   FOUND: <CRITICAL|HIGH> | <file>:<line> | <short title>
rp_line() {
  local ln="$1" rest sev loc title file dim
  case "$ln" in
    PROGRESS:*)
      rest="${ln#PROGRESS:}"; file="${rest%%|*}"; dim="${rest#*|}"
      [ "$dim" = "$rest" ] && dim=""
      file="$(printf '%s' "$file" | sed 's/^ *//; s/ *$//')"
      dim="$(printf '%s' "$dim" | sed 's/^ *//; s/ *$//')"
      rp_write "$(printf '{"ts":"%s","id":"%s","kind":"dim","file":"%s","dim":"%s"}' "$(rp_now)" "$rp_id" "$(rp_esc "$file")" "$(rp_esc "$dim")")"
      ;;
    FOUND:*)
      rest="${ln#FOUND:}"; sev="${rest%%|*}"; rest="${rest#*|}"; loc="${rest%%|*}"; title="${rest#*|}"
      [ "$loc" = "$rest" ] && { title=""; }
      sev="$(printf '%s' "$sev" | tr -d ' ' | tr '[:lower:]' '[:upper:]')"
      loc="$(printf '%s' "$loc" | sed 's/^ *//; s/ *$//')"
      title="$(printf '%s' "$title" | sed 's/^ *//; s/ *$//')"
      rp_write "$(printf '{"ts":"%s","id":"%s","kind":"finding","file":"%s","severity":"%s","title":"%s"}' "$(rp_now)" "$rp_id" "$(rp_esc "$loc")" "$(rp_esc "$sev")" "$(rp_esc "$title")")"
      ;;
  esac
}

# ─── Run the independent reviewer ──────────────────────────────────────────
review_prompt="You are an INDEPENDENT code reviewer running the code-review-deep pass.
Review ONLY the diff below. Report blocking issues only:
  CRITICAL: security holes, data loss, crashes, injection, broken auth.
  HIGH:     real bugs, broken contracts, race conditions, wrong logic.

While you work, EMIT LIVE PROGRESS so the user can watch — print these as you go:
  PROGRESS: <file> | <what you are checking now>     (when you start on a file/area)
  FOUND: <CRITICAL|HIGH> | <file>:<line> | <short title>   (the moment you spot one)

THEN, as the LAST thing you output, give the verdict:
  one terse bullet per finding, each prefixed with 'CRITICAL:' or 'HIGH:',
  or exactly REVIEW_CLEAN if there are no CRITICAL or HIGH issues.
Do not restate the diff. Do not praise. Do not list LOW/style nits. Max 12 verdict bullets.

--- DIFF ---
${diff}
--- END DIFF ---"

run_reviewer() {
  if [ -n "${CUE_AUTO_REVIEW_CMD:-}" ]; then
    printf '%s' "$diff" | timeout 180 bash -c "$CUE_AUTO_REVIEW_CMD" 2>/dev/null
  else
    command -v claude >/dev/null 2>&1 || return 1
    CUE_AUTO_REVIEW_INNER=1 timeout 240 claude -p --model sonnet "$review_prompt" 2>/dev/null
  fi
}

# Capture the reviewer output IN FULL first — verdict integrity is must-have, and
# under-blocking is the dangerous direction, so we never risk a broken pipe
# truncating the verdict. Then replay PROGRESS/FOUND lines to the live log. The
# side-channel is best-effort here; the Agent-subagent reviewer streams in real
# time by calling cue-review-progress directly (see docs/review-visibility.md).
verdict=""
out_tmp="$(mktemp 2>/dev/null || true)"
if [ -n "$out_tmp" ]; then
  run_reviewer > "$out_tmp" 2>/dev/null || true
  verdict="$(cat "$out_tmp" 2>/dev/null)"
  grep -E '^(PROGRESS|FOUND):' "$out_tmp" 2>/dev/null | while IFS= read -r ln; do rp_line "$ln"; done || true
  rm -f "$out_tmp"
else
  verdict="$(run_reviewer)"
fi
rp_write "$(printf '{"ts":"%s","id":"%s","kind":"end","title":"review done"}' "$(rp_now)" "$rp_id")"
[ -z "$verdict" ] && exit 0   # reviewer failed → fail-open, allow stop

# Strip the live-progress side-channel before verdict parsing, so a PROGRESS/FOUND
# line whose text mentions "CRITICAL:"/"HIGH:" can't be misread as a verdict bullet
# (which would spuriously block a clean turn).
verdict_only="$(printf '%s' "$verdict" | grep -vE '^(PROGRESS|FOUND):' || true)"

# Clean → record this diff and allow stop.
if printf '%s' "$verdict_only" | grep -qF "REVIEW_CLEAN"; then
  printf '%s\n0\n' "$diff_hash" > "$sfile"
  exit 0
fi
# No real findings parsed → don't block on noise.
if ! printf '%s' "$verdict_only" | grep -qE 'CRITICAL:|HIGH:'; then
  printf '%s\n0\n' "$diff_hash" > "$sfile"
  exit 0
fi

# ─── Block: feed the reviewer's findings back to the main agent ────────────
rounds=$((rounds + 1))
printf '%s\n%s\n' "$diff_hash" "$rounds" > "$sfile"
findings="$(printf '%s' "$verdict_only" | grep -E 'CRITICAL:|HIGH:' | head -12)"
reason="An independent reviewer agent (code-review-deep on Sonnet, round ${rounds}/${MAX_ROUNDS}) flagged issues in your diff:

${findings}

Address every CRITICAL and HIGH item above, then VERIFY the fix by running the test/build/check that proves it, and say what you changed. Finish only once these are resolved. If a finding is a false positive, state why. Suppress the reviewer for one turn with [skip-auto-review]."

if command -v jq >/dev/null 2>&1; then
  jq -nc --arg r "$reason" '{decision:"block", reason:$r}'
else
  esc="$(printf '%s' "$reason" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null)"
  [ -z "$esc" ] && exit 0
  printf '{"decision":"block","reason":%s}\n' "$esc"
fi
exit 0
