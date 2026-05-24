#!/usr/bin/env bash
set -euo pipefail

if [ "${BASH_VERSION:-}" = "" ]; then
  echo "cue e2e: bash is required" >&2
  exit 2
fi

SOUL_E2E_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOUL_E2E_ROOT="${SOUL_E2E_ROOT:-$(cd "$SOUL_E2E_LIB_DIR/../.." && pwd)}"
SOUL_E2E_WORK="${SOUL_E2E_WORK:-$(mktemp -d "${TMPDIR:-/tmp}/cue-e2e.XXXXXX")}"
SOUL_E2E_NPX_CACHE="${SOUL_E2E_NPX_CACHE:-$SOUL_E2E_ROOT/profiles/_cache/npx}"
BUN_INSTALL_CACHE_DIR="${BUN_INSTALL_CACHE_DIR:-$SOUL_E2E_ROOT/profiles/_cache/bun}"

export SOUL_E2E_ROOT
export SOUL_E2E_WORK
export SOUL_E2E_NPX_CACHE
export BUN_INSTALL_CACHE_DIR

EXPECTED_PROFILES="core medusa-dev fleet-control creative-media caveman-quick docs-writer research frontend backend full coolify hostinger nvidia marketing readme-writer"

log() {
  printf '[e2e] %s\n' "$*"
}

fail() {
  printf '[e2e] FAIL: %s\n' "$*" >&2
  exit 1
}

ensure_bun() {
  command -v bun >/dev/null 2>&1 || fail "bun is required in PATH"
  mkdir -p "$BUN_INSTALL_CACHE_DIR"
}

ensure_temp_home() {
  if [ "${SOUL_E2E_HOME_READY:-0}" != "1" ]; then
    export HOME="$SOUL_E2E_WORK/home"
    mkdir -p "$HOME"
    # Stub plugin dirs so the validate resolver finds them in the temp HOME.
    # The resolver only checks the plugin dir exists; an empty skills/ tree
    # is valid and contributes zero plans.
    mkdir -p \
      "$HOME/.claude/plugins/claude-mem" \
      "$HOME/.claude/plugins/marketing-skills" \
      "$HOME/.claude/plugins/claude-video-vision"
    SOUL_E2E_HOME_READY=1
    export SOUL_E2E_HOME_READY
  fi
}

fresh_repo() {
  local name="$1"
  local dest="$SOUL_E2E_WORK/$name/repo"

  rm -rf "$SOUL_E2E_WORK/$name"
  mkdir -p "$SOUL_E2E_WORK/$name"

  if command -v rsync >/dev/null 2>&1; then
    rsync -a \
      --exclude '.git' \
      --exclude '.omc' \
      --exclude '.omx' \
      --exclude '.codex' \
      --exclude '.agents' \
      --exclude '.claude' \
      --exclude 'node_modules' \
      --exclude 'profiles/_cache/*' \
      --exclude 'profiles/_active/current' \
      --exclude 'profiles/*/workspace' \
      "$SOUL_E2E_ROOT/" "$dest/"
  else
    mkdir -p "$dest"
    (
      cd "$SOUL_E2E_ROOT"
      tar \
        --exclude='./.git' \
        --exclude='./.omc' \
        --exclude='./.omx' \
        --exclude='./.codex' \
        --exclude='./.agents' \
        --exclude='./.claude' \
        --exclude='./node_modules' \
        --exclude='./profiles/_cache/*' \
        --exclude='./profiles/_active/current' \
        --exclude='./profiles/*/workspace' \
        -cf - .
    ) | (
      cd "$dest"
      tar -xf -
    )
  fi

  mkdir -p "$dest/profiles/_cache" "$SOUL_E2E_NPX_CACHE"
  rm -rf "$dest/profiles/_cache/npx"
  ln -s "$SOUL_E2E_NPX_CACHE" "$dest/profiles/_cache/npx"

  printf '%s\n' "$dest"
}

install_deps() {
  local repo="$1"
  ensure_bun
  (cd "$repo" && bun install)
}

cue() {
  local repo="$1"
  shift
  (cd "$repo" && "$repo/bin/cue" "$@")
}

profile_count() {
  local repo="$1"
  find "$repo/profiles" -mindepth 2 -maxdepth 2 -name profile.yaml -print | wc -l | tr -d ' '
}

require_profile() {
  local repo="$1"
  local profile="$2"
  [ -f "$repo/profiles/$profile/profile.yaml" ] || fail "missing profiles/$profile/profile.yaml"
}

assert_file() {
  [ -f "$1" ] || fail "expected file: $1"
}

assert_dir() {
  [ -d "$1" ] || fail "expected directory: $1"
}

assert_symlink_tree_ok() {
  local dir="$1"
  local links="$SOUL_E2E_WORK/links.$RANDOM.txt"

  assert_dir "$dir"
  find "$dir" -type l -print > "$links"
  [ -s "$links" ] || fail "expected at least one symlink under $dir"

  while IFS= read -r link; do
    [ -e "$link" ] || fail "broken symlink: $link -> $(readlink "$link")"
    case "$(readlink "$link")" in
      /*) fail "symlink target should be relative: $link -> $(readlink "$link")" ;;
    esac
  done < "$links"
}

first_symlink_under() {
  local dir="$1"
  find "$dir" -type l -print | sed -n '1p'
}
