#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.."; pwd)/lib.sh"
ensure_temp_home

repo="$(fresh_repo 02-use-per-dir)"
install_deps "$repo"
require_profile "$repo" "medusa-dev"

# Skip if 'use' is not yet implemented
output="$(cue "$repo" use medusa-dev 2>&1)" || true
if echo "$output" | grep -q "not yet implemented"; then
  log "SKIP: 'use' command not yet implemented"
  exit 0
fi

# `cue use <profile>` pins the per-directory profile by writing a `.cue.profile`
# marker in the CWD (see src/commands/use.ts). It does NOT materialize a runtime
# under the repo — that lives in ~/.config/cue/runtime/ and is built on launch.
marker="$repo/.cue.profile"
assert_file "$marker"
grep -q "medusa-dev" "$marker" || fail ".cue.profile should record 'medusa-dev', got: $(cat "$marker")"

log "use medusa-dev writes .cue.profile marker in the directory"
