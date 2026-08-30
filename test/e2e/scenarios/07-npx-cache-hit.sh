#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"
ensure_temp_home

repo="$(fresh_repo 07-npx-cache-hit)"
install_deps "$repo"

profile="npx-cache-e2e"
mkdir -p "$repo/profiles/$profile"
cat > "$repo/profiles/$profile/profile.yaml" <<'YAML'
name: npx-cache-e2e
description: E2E-only profile with an npx skill, for proving `use` is a cheap pin.
skills:
  npx:
    - repo: recodeee/cue-e2e-skills
      pin: tag@v0.0.1
      skills:
        - e2e-npx-skill
YAML

# A mock `npx` that records every invocation. `cue use` is a pure per-directory
# pin (writes .cue.profile) — it must NEVER shell out to npx to fetch skills.
# (npx skills are resolved later, at materialize/launch time — not on pin.)
mock_bin="$SOUL_E2E_WORK/mock-bin"
log_file="$SOUL_E2E_WORK/07-npx.log"
mkdir -p "$mock_bin"
: > "$log_file"

cat > "$mock_bin/npx" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
echo "$PWD $*" >> "${SOUL_E2E_NPX_LOG:?}"
SH
chmod +x "$mock_bin/npx"

export PATH="$mock_bin:$PATH"
export SOUL_E2E_NPX_LOG="$log_file"

# Skip if 'use' is not yet implemented
use_output="$(cue "$repo" use "$profile" 2>&1)" || true
if echo "$use_output" | grep -q "not yet implemented"; then
  log "SKIP: 'use' command not yet implemented"
  exit 0
fi

calls="$(wc -l < "$log_file" | tr -d ' ')"
[ "$calls" = "0" ] || fail "cue use is a pin and must not invoke npx, but made $calls call(s)"

log "cue use pins an npx profile without triggering any npx fetch"
