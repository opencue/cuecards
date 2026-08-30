#!/usr/bin/env bash
# Live smoke for the cue description engine — the proxy→Claude transfer check.
#
# Always runs the OFFLINE gates (test suite + dry-runs). Then, IF a working DSPy
# stack and an LLM key are present, it runs a small real skill-routing loop and
# asserts the just-applied persona_routing phrase actually reaches the materialized
# CLAUDE.md router block (via `evolution.descriptions.smoke --from-log`). Without
# the native stack / key it stops after the offline gates and says what's missing,
# so the harness is always runnable.
#
#   bin/smoke.sh                                  # defaults below
#   SMOKE_SKILL=meta/smart-loader SMOKE_PROFILE=coolify SMOKE_ITERS=3 bin/smoke.sh
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"
py="$here/.venv/bin/python"
[ -x "$py" ] || py="$(command -v python3 || true)"
[ -n "$py" ] || { echo "smoke: no python found" >&2; exit 127; }

SKILL="${SMOKE_SKILL:-eu-funding/ted-tender-search}"
PROFILE="${SMOKE_PROFILE:-core}"
ITERS="${SMOKE_ITERS:-3}"
M="-m evolution.descriptions.evolve_description"

echo "== cue description-engine smoke =="
echo "   skill=$SKILL  profile=$PROFILE  iters=$ITERS"

echo; echo "-- offline gate: test suite --"
"$py" -m pytest tests/ -q || { echo "✗ offline tests FAILED"; exit 1; }

echo; echo "-- offline gate: dry-runs --"
"$py" $M --skill "$SKILL" --target skill --profile "$PROFILE" --dry-run || exit 1
"$py" $M --target persona --profile "$PROFILE" --dry-run || exit 1

# Live path needs the native stack AND a key; otherwise stop after offline gates.
if ! "$py" -c "import dspy" 2>/dev/null; then
  echo; echo "ℹ DSPy not importable here — offline smoke only."
  echo "  Install: pip install -e '.[optimize]' (needs a working native/libstdc++ stack)."
  exit 0
fi
if [ -z "${ANTHROPIC_API_KEY:-}${OPENAI_API_KEY:-}${OPENROUTER_API_KEY:-}" ]; then
  echo; echo "ℹ No LLM key set — skipping the live run. export ANTHROPIC_API_KEY=… to enable."
  exit 0
fi

echo; echo "-- live: skill routing ($ITERS iters) — may apply a persona_routing row --"
"$py" $M --skill "$SKILL" --target skill --profile "$PROFILE" \
        --iterations "$ITERS" --eval-source synthetic || exit 1

echo; echo "-- smoke: did the last applied row reach CLAUDE.md's router? --"
"$py" -m evolution.descriptions.smoke --profile "$PROFILE" --from-log
rc=$?
if [ "$rc" -eq 2 ]; then
  echo "ℹ No row was applied this run (gate not cleared) — nothing to assert. Not a failure."
  exit 0
fi
exit "$rc"
