#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"
ensure_temp_home

repo="$(fresh_repo 05-validate-all)"
install_deps "$repo"

# Smoke test the validate command on the always-clean core profile.
# A full `validate --all` sweep is too slow for CI (npx skill fetches across
# 20+ profiles) and would also surface content drift in user-added profiles —
# which is not a CLI bug. Trust validate-profiles.yml on PRs for the full sweep.
cue "$repo" validate core

log "core profile validates cleanly"
