#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"
ensure_temp_home

repo="$(fresh_repo 04-doctor-detects-drift)"
install_deps "$repo"
require_profile "$repo" "medusa-dev"

# Skip if 'use' is not yet implemented
use_output="$(cue "$repo" use medusa-dev --global 2>&1)" || true
if echo "$use_output" | grep -q "not yet implemented"; then
  log "SKIP: 'use' command not yet implemented"
  exit 0
fi

skills_dir="$HOME/.claude/skills"
broken="$(first_symlink_under "$skills_dir")"
[ -n "$broken" ] || fail "expected a materialized global skill symlink"

rm "$broken"
ln -s "__missing_cue_e2e_target__" "$broken"

if cue "$repo" doctor > "$SOUL_E2E_WORK/04-doctor.out" 2>&1; then
  fail "cue doctor should exit non-zero for a broken symlink"
fi

cue "$repo" doctor --fix
[ -e "$broken" ] || fail "doctor --fix did not repair $broken"
assert_symlink_tree_ok "$skills_dir"

log "doctor detects drift and --fix repairs it"
