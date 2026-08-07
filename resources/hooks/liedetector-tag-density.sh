#!/usr/bin/env bash
# Stop hook — advisory nudge on liedetector tag hygiene (opt-in, non-blocking).
#
# The integrity protocol asks the model to mark decision-relevant claims with
# confidence tags (🟢 [VERIFIED], 🟡 [INFERRED ~80%], 🟠 [GUESSED ~30%],
# 🔴 [UNKNOWN], etc.). Three failure modes degrade that signal:
#   (a) a long, substantive response with ZERO tags — no confidence signal at
#       all where the reader most needs one;
#   (b) a yellow/orange tag with no ~N%, or an ~N% that isn't on its tier's
#       ladder — the tier alone can't order claims against each other;
#   (c) tag-spam — a tag on nearly every clause, which trains the reader to
#       ignore the tags entirely.
# This hook nudges on all three. It NEVER blocks the Stop; it only prints one
# line to stderr (which Claude Code surfaces) so the model can self-correct.
#
# Honest about its limits: this is a crude heuristic. It cannot tell whether a
# response was actually "decision-relevant" — it uses response length (>1500
# chars) as a rough proxy for "substantive". So the zero-tag check will
# false-positive on long-but-casual output (a code dump, a file listing, a
# narrative explanation). To keep the false-positive rate low it only fires on
# CLEARLY long, completely tag-free responses, and stays silent otherwise. The
# density check needs at least 4 tags before it can call something "spam".
# Treat those two nudges as a question ("did this response need tags?"), not a
# verdict. Check (b) is the exception: the protocol names the legal ~N% values,
# so a missing or off-ladder percent is a fact, not a heuristic.
#
# Reliability: parsing the transcript can fail for many reasons (missing file,
# truncated JSONL, schema drift). Every failure path FAILS OPEN — any error
# exits 0 silently. A hygiene nudge is never worth interrupting the user.
#
# Opt-in only: active when ${HOME}/.config/cue/liedetector-tag-check exists.
# Enable:  touch ${HOME}/.config/cue/liedetector-tag-check
# Disable: rm    ${HOME}/.config/cue/liedetector-tag-check
# Off by default. Suppress one turn with [skip-tag-density] in the response.
#
# No deps beyond python3. Exits 0 always.
set -euo pipefail

state_file="${HOME}/.config/cue/liedetector-tag-check"
[[ -f "$state_file" ]] || exit 0

payload="$(cat -)"

# Extract transcript_path defensively (fail open on any parse error).
transcript_path="$(printf '%s' "$payload" | python3 -c 'import sys,json
try:
    print(json.load(sys.stdin).get("transcript_path","") or "")
except Exception:
    pass' 2>/dev/null || true)"
[[ -n "$transcript_path" && -r "$transcript_path" ]] || exit 0

# Pull the LAST assistant text message from the JSONL transcript, then apply
# the two heuristics in python3 (avoids brittle bash regex over prose). Emits a
# single advisory line to stdout, or nothing. Any exception → silent exit 0.
nudge="$(python3 - "$transcript_path" <<'PY' 2>/dev/null || true
import sys, json, re

TAGS = ("VERIFIED", "KNOWN", "INFERRED", "ASSUMED",
        "GUESSED", "STALE", "UNKNOWN", "CORRECTION")
TAG_RE = re.compile(r"\[(?:%s)[^\]]*\]" % "|".join(TAGS))

# The protocol requires a ~N% on every yellow and orange tag, drawn from that
# tier's ladder. Yellow spans ~50-85%, orange ~20-45%, so the ladders don't
# overlap each other or green (>=90%).
LADDER = {
    "INFERRED": {"50", "60", "70", "80"},
    "ASSUMED":  {"50", "60", "70", "80"},
    "GUESSED":  {"20", "30", "40"},
    "STALE":    {"20", "30", "40"},
}
CAL_RE = re.compile(r"\[(%s)([^\]]*)\]" % "|".join(LADDER))
PCT_RE = re.compile(r"~\s*(\d+)\s*%")

LONG_CHARS = 1500          # proxy for "substantive response"
SPAM_MIN_TAGS = 4          # need real density before calling it spam
SPAM_WORDS_PER_TAG = 25    # > 1 tag / 25 words = spam

last = None
try:
    with open(sys.argv[1], encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            if rec.get("type") != "assistant":
                continue
            content = (rec.get("message") or {}).get("content")
            if isinstance(content, list):
                text = "".join(
                    b.get("text", "")
                    for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                )
            elif isinstance(content, str):
                text = content
            else:
                text = ""
            if text.strip():
                last = text
except Exception:
    sys.exit(0)

if not last:
    sys.exit(0)
if "[skip-tag-density]" in last:
    sys.exit(0)

n_chars = len(last)
n_tags = len(TAG_RE.findall(last))
n_words = len(last.split())

# (a) long + zero tags → likely an untagged decision-relevant response.
if n_chars > LONG_CHARS and n_tags == 0:
    print("liedetector: %d-char response with zero confidence tags. "
          "If any claim here is decision-relevant, tag it "
          "(\U0001F7E2 [VERIFIED] / \U0001F7E1 [INFERRED ~80%%] / "
          "\U0001F7E0 [GUESSED ~30%%] / \U0001F534 [UNKNOWN]). "
          "Skip this nudge with [skip-tag-density]." % n_chars)
    sys.exit(0)

# (b) calibration format → a yellow/orange tag with no ~N%, or with one that
#     isn't on its tier's ladder. Unlike the two heuristics around it this is
#     an exact check: the protocol names the legal values, so a miss is a
#     violation rather than a guess about intent.
missing, offladder = [], []
for tag, rest in CAL_RE.findall(last):
    pct = PCT_RE.search(rest)
    if not pct:
        missing.append(tag)
    elif pct.group(1) not in LADDER[tag]:
        offladder.append("%s ~%s%%" % (tag, pct.group(1)))

if missing or offladder:
    parts = []
    if missing:
        parts.append("%d tag(s) with no ~N%% (%s)"
                     % (len(missing), ", ".join(sorted(set(missing)))))
    if offladder:
        parts.append("%d off-ladder (%s)"
                     % (len(offladder), ", ".join(sorted(set(offladder)))))
    print("liedetector: %s. Yellow ([INFERRED]/[ASSUMED]) takes ~50/60/70/80%%, "
          "orange ([GUESSED]/[STALE]) takes ~20/30/40%% — nothing else. "
          "Skip with [skip-tag-density]." % "; ".join(parts))
    sys.exit(0)

# (c) tag-spam → density trains the reader to ignore the tags.
if n_tags >= SPAM_MIN_TAGS and n_words > 0:
    words_per_tag = n_words / n_tags
    if words_per_tag < SPAM_WORDS_PER_TAG:
        print("liedetector: %d tags across ~%d words (1 per %.0f words). "
              "Tag-spam trains the reader to ignore tags — one tag per "
              "*claim*, not per clause. Skip with [skip-tag-density]."
              % (n_tags, n_words, words_per_tag))
        sys.exit(0)
PY
)"

[[ -n "$nudge" ]] && printf '\n⚠ %s\n' "$nudge" >&2

exit 0
