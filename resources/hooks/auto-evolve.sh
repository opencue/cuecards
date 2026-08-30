#!/usr/bin/env bash
# Stop hook — cue AUTO-EVOLVE trigger. Closes the self-evolution loop: when both
# opt-in flags are set, at most once per cooldown window, pick the most-flagged
# skill from accumulated skill_gap signals and evolve it (single-shot, propose-
# only by default). Pairs with profile-self-improve.sh, which CAPTURES the gaps.
#
# This hook MUTATES skills (via proposals/applies), so it is stricter than the
# capture hook. It NEVER blocks the Stop (exit 0 always) and fails open.
#
# Opt-in: active only when ALL of:
#   ~/.config/cue/.auto-improve-enabled    (self-learner master switch)
#   ~/.config/cue/.auto-evolve-enabled     (skill-content mutation switch)
#   CUE_EVOLUTION_DIR points at <cue-repo>/evolution  (where the package lives;
#     the materialized hook can't find the repo by relative path). Falls back to
#     ~/Documents/cue/evolution.
#
# Tunables: CUE_AUTO_EVOLVE_COOLDOWN_HOURS (default 24),
#           CUE_AUTO_EVOLVE_APPLY=1 to allow auto-apply (else propose-only).

set -uo pipefail

# Recursion guard: a spawned `claude -p` (the optimizer's LM) must not re-trigger.
[ "${CUE_AUTO_IMPROVE_INNER:-}" = "1" ] && exit 0

CFG="${XDG_CONFIG_HOME:-$HOME/.config}/cue"
[ -f "$CFG/.auto-improve-enabled" ] || exit 0
[ -f "$CFG/.auto-evolve-enabled" ]  || exit 0

# Resolve the evolution/ package dir robustly so a core-wide promotion works
# regardless of where cue is checked out:
#   1. CUE_EVOLUTION_DIR wins (explicit override).
#   2. else derive it from THIS script's real path — the materialized hook is a
#      symlink back into the repo at resources/hooks/, so the repo root is two
#      dirs up and the package is <repo>/evolution. python3 (already required
#      below for portable mtime) does the realpath so this works on macOS too.
#   3. else the known default checkout.
_self="$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
_repo="$(cd "$(dirname "$_self")/../.." 2>/dev/null && pwd || true)"
EVO_DIR="${CUE_EVOLUTION_DIR:-${_repo:+$_repo/evolution}}"
[ -n "$EVO_DIR" ] && [ -x "$EVO_DIR/bin/auto-evolve" ] || EVO_DIR="$HOME/Documents/cue/evolution"
wrapper="$EVO_DIR/bin/auto-evolve"
[ -x "$wrapper" ] || exit 0

# Cooldown: at most once per COOLDOWN_HOURS (default 24) — never every Stop.
hours="${CUE_AUTO_EVOLVE_COOLDOWN_HOURS:-24}"
sentinel="$CFG/auto-evolve/last-run"
mkdir -p "$(dirname "$sentinel")" 2>/dev/null || exit 0
if [ -f "$sentinel" ]; then
  # Portable mtime (GNU `stat -c` is Linux-only; macOS uses `stat -f`). python3
  # is already required by the evolution package, so use it for cross-platform.
  mtime="$(python3 -c 'import os,sys; print(int(os.path.getmtime(sys.argv[1])))' "$sentinel" 2>/dev/null || echo 0)"
  age=$(( $(date +%s) - mtime ))
  [ "$age" -lt $(( hours * 3600 )) ] && exit 0
fi
touch "$sentinel" 2>/dev/null || true

apply_flag=""
[ "${CUE_AUTO_EVOLVE_APPLY:-}" = "1" ] && apply_flag="--apply"

# Fire in the background; never block the Stop. CUE_AUTO_IMPROVE_INNER=1 guards
# the nested claude -p against re-triggering this (and the capture) hook.
( CUE_AUTO_IMPROVE_INNER=1 "$wrapper" $apply_flag >/dev/null 2>&1 & )
exit 0
