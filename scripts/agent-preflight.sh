#!/usr/bin/env bash
# GitGuardex's local check for Cue. GitHub still runs the required CI checks.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/cue-preflight.XXXXXX")"
trap 'rm -rf -- "$scratch"' EXIT
unset ALLOW_BASH_ON_NON_AGENT_BRANCH ALLOW_CODE_EDIT_ON_PROTECTED_BRANCH
unset ALLOW_CODE_EDIT_ON_PRIMARY_WORKTREE ALLOW_COMMIT_ON_PROTECTED_BRANCH
unset ALLOW_PUSH_ON_PROTECTED_BRANCH GUARDEX_CLI_ENTRY GUARDEX_NODE_BIN

run_step() {
  local label="$1"
  shift
  echo "[agent-preflight] -> $label"
  if [[ "${GUARDEX_PREFLIGHT_VERBOSE:-0}" == 1 ]]; then
    "$@"
  elif ! "$@" >"$scratch/output" 2>&1; then
    echo "[agent-preflight] FAIL: $label" >&2
    tail -n "${GUARDEX_PREFLIGHT_FAIL_TAIL:-40}" "$scratch/output" >&2
    return 1
  fi
  echo "[agent-preflight]    ok"
}

submodules="$(git submodule status --recursive)"
if grep -Eq '^[+U]' <<<"$submodules"; then
  echo "[agent-preflight] Submodules do not match their recorded revisions; leaving them untouched." >&2
  printf '%s\n' "$submodules" >&2
  exit 1
fi
if grep -q '^-' <<<"$submodules"; then
  # A fresh submodule checkout must detach at the gitlink, not its own main.
  # Limit the Guardex checkout exception to this Git subprocess.
  run_step "initialize submodules" env GUARDEX_ALLOW_PRIMARY_BRANCH_SWITCH=1 \
    git submodule update --init --recursive --checkout
  submodules="$(git submodule status --recursive)"
  if grep -Eq '^[-+U]' <<<"$submodules"; then
    echo "[agent-preflight] Submodules do not match their recorded revisions after initialization." >&2
    printf '%s\n' "$submodules" >&2
    exit 1
  fi
fi

run_step "install CLI dependencies" bun install --frozen-lockfile
(cd web && run_step "install web dependencies" bun install --no-save)

# Do not pick up the user's agent configuration, hooks, or HOME-dependent shims.
tool_path="$(dirname "$(command -v bun)")"
if command -v node >/dev/null; then
  tool_path="$tool_path:$(dirname "$(command -v node)")"
fi
export HOME="$scratch/home" CI=true
mkdir -p "$HOME"
export PATH="$tool_path:/usr/local/bin:/usr/bin:/bin"
unset XDG_CONFIG_HOME XDG_CACHE_HOME XDG_DATA_HOME
unset CODEX_HOME CUE_CANONICAL_CODEX_HOME CLAUDE_CONFIG_DIR CUE_ALWAYS_PICK_MCPS CUE_CLAUDE_MEM_ISOLATE

run_step "typecheck" bun run typecheck
run_step "lint" bun run lint
run_step "test" bun run test
run_step "critical coverage" bun run test:critical:coverage
