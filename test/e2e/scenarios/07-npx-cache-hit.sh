#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"
ensure_temp_home

repo="$(fresh_repo 07-npx-cache-hit)"
install_deps "$repo"

rm -rf "$repo/profiles/_cache/npx"
mkdir -p "$repo/profiles/_cache/npx"

profile="npx-cache-e2e"
mkdir -p "$repo/profiles/$profile"
cat > "$repo/profiles/$profile/profile.yaml" <<'YAML'
name: npx-cache-e2e
description: E2E-only profile for proving npx cache hits
skills:
  npx:
    - repo: recodeee/cue-e2e-skills
      pin: tag@v0.0.1
      skills:
        - e2e-npx-skill
YAML

mock_bin="$SOUL_E2E_WORK/mock-bin"
log_file="$SOUL_E2E_WORK/07-npx.log"
mkdir -p "$mock_bin"
: > "$log_file"

cat > "$mock_bin/npx" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

echo "$PWD $*" >> "${SOUL_E2E_NPX_LOG:?}"
if [ "${SOUL_E2E_NPX_FAIL_ON_CALL:-0}" = "1" ]; then
  echo "mock npx was called during cache-hit phase" >&2
  exit 97
fi

skill=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --skill)
      skill="${2:-}"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

[ -n "$skill" ] || { echo "mock npx missing --skill" >&2; exit 2; }
mkdir -p "$PWD/$skill"
cat > "$PWD/$skill/SKILL.md" <<EOF
---
name: $skill
description: Mock npx skill for cue e2e.
---
# $skill
EOF
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

first_calls="$(wc -l < "$log_file" | tr -d ' ')"
[ "$first_calls" -gt 0 ] || fail "first cue use did not populate npx cache through mock npx"

: > "$log_file"
export SOUL_E2E_NPX_FAIL_ON_CALL=1
cue "$repo" use "$profile"

second_calls="$(wc -l < "$log_file" | tr -d ' ')"
[ "$second_calls" = "0" ] || fail "second cue use made $second_calls npx call(s)"

log "second cue use of $profile reuses the npx cache"
