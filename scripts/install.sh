#!/usr/bin/env bash
# cue installer — `curl -fsSL cue.dev/install | sh`
#
# Detects the available runtime (bun > pnpm > npm) and installs cue-ai
# globally. Falls back to git clone + bun if no global package manager
# is available. Idempotent.
#
# Env overrides:
#   CUE_INSTALL_METHOD=npm|pnpm|bun|source
#   CUE_INSTALL_REF=main          # git ref for `source` method
#   CUE_INSTALL_DIR=$HOME/.cue    # for `source` method
#   CUE_NO_POST_INSTALL=1         # skip the postinstall message

set -euo pipefail

# ── Style helpers (TTY only) ────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_CYAN=$'\033[36m'
else
  C_RESET= C_BOLD= C_DIM= C_GREEN= C_YELLOW= C_RED= C_CYAN=
fi
info()  { printf "%s ▶ %s%s\n" "$C_CYAN" "$1" "$C_RESET"; }
ok()    { printf "%s ✓ %s%s\n" "$C_GREEN" "$1" "$C_RESET"; }
warn()  { printf "%s ⚠ %s%s\n" "$C_YELLOW" "$1" "$C_RESET" >&2; }
die()   { printf "%s ✗ %s%s\n" "$C_RED" "$1" "$C_RESET" >&2; exit 1; }

has()   { command -v "$1" >/dev/null 2>&1; }

# ── Banner ───────────────────────────────────────────────────────────────────
cat <<'EOF'

   ▄████▄  █    ██ ▓█████
  ▒██▀ ▀█  ██  ▓██▒▓█   ▀
  ▒▓█    ▄▓██  ▒██░▒███
  ▒▓▓▄ ▄██▒▓▓█  ░██░▒▓█  ▄
  ▒ ▓███▀ ░▒▒█████▓ ░▒████▒
  ░ ░▒ ▒  ░░▒▓▒ ▒ ▒ ░░ ▒░ ░
    ░  ▒   ░░▒░ ░ ░  ░ ░  ░
  ░         ░░░ ░ ░    ░
  ░ ░         ░        ░  ░

  Profile manager + skill discovery for Claude Code, Codex, Cursor, and 10+ AI agents
  https://github.com/opencue/cuecards · MIT

EOF

# ── Decide install method ───────────────────────────────────────────────────
METHOD="${CUE_INSTALL_METHOD:-}"
if [ -z "$METHOD" ]; then
  if has bun; then METHOD=bun
  elif has pnpm; then METHOD=pnpm
  elif has npm; then METHOD=npm
  else METHOD=source
  fi
fi

case "$METHOD" in
  bun|pnpm|npm|source) ;;
  *) die "Unknown CUE_INSTALL_METHOD: $METHOD (expected: bun|pnpm|npm|source)" ;;
esac

info "Install method: $METHOD"

# ── Install ─────────────────────────────────────────────────────────────────
case "$METHOD" in
  bun)
    has bun || die "bun not found (set CUE_INSTALL_METHOD=npm to use npm)"
    bun add -g cue-ai
    ;;
  pnpm)
    has pnpm || die "pnpm not found"
    pnpm add -g cue-ai
    ;;
  npm)
    has npm || die "npm not found (install Node.js 18+ first: https://nodejs.org/)"
    npm install -g cue-ai
    ;;
  source)
    has git || die "git not found"
    has bun || die "bun not found — source install needs bun. brew/apt/curl install bun first."
    DIR="${CUE_INSTALL_DIR:-$HOME/.cue}"
    REF="${CUE_INSTALL_REF:-main}"
    if [ -d "$DIR/.git" ]; then
      info "Updating existing checkout at $DIR"
      git -C "$DIR" fetch origin "$REF"
      git -C "$DIR" reset --hard "origin/$REF"
    else
      info "Cloning opencue/cuecards@$REF to $DIR"
      git clone --depth 1 --branch "$REF" https://github.com/opencue/cuecards "$DIR"
    fi
    info "Initializing submodules (skills, mcps)"
    git -C "$DIR" submodule update --init --recursive --depth 1 2>/dev/null || \
      warn "Submodule init failed; smart-loader catalog will fall back to live filesystem scan"
    (cd "$DIR" && bun install --frozen-lockfile)
    # Rebuild local catalog from the freshly-cloned skills tree so smart-loader's
    # fast path works from first launch instead of waiting for the next mtime check.
    if [ -x "$DIR/resources/skills/scripts/rebuild-catalog-local.sh" ]; then
      info "Building skill catalog index"
      CUE_SKILLS_ROOT="$DIR/resources/skills/skills" \
        CUE_CATALOG_DIR="$DIR/resources/skills/catalog" \
        bash "$DIR/resources/skills/scripts/rebuild-catalog-local.sh" >/dev/null 2>&1 || \
        warn "Catalog rebuild failed; first smart-lookup will trigger one"
    fi
    # Symlink the bin into a directory likely on PATH
    BIN_DIR=""
    for candidate in "$HOME/.local/bin" "$HOME/bin" "/usr/local/bin"; do
      if [ -d "$candidate" ] && [ -w "$candidate" ]; then
        BIN_DIR="$candidate"; break
      fi
    done
    if [ -z "$BIN_DIR" ]; then
      warn "No writable bin dir found on PATH; add this to your shell rc:"
      printf "    %sexport PATH=\"%s/bin:\$PATH\"%s\n" "$C_DIM" "$DIR" "$C_RESET"
    else
      ln -sf "$DIR/bin/cue" "$BIN_DIR/cue"
      ok "Symlinked cue → $BIN_DIR/cue"
    fi
    ;;
esac

# ── Verify ──────────────────────────────────────────────────────────────────
if has cue; then
  CUE_VERSION="$(cue --version 2>/dev/null || echo unknown)"
  ok "cue installed: $CUE_VERSION"
else
  warn "cue is installed but not on PATH. Open a new shell or restart your terminal."
fi

# ── Post-install hint ───────────────────────────────────────────────────────
if [ "${CUE_NO_POST_INSTALL:-0}" != "1" ]; then
  cat <<EOF

  ${C_BOLD}Next steps:${C_RESET}

    ${C_GREEN}1.${C_RESET} cd into a project
    ${C_GREEN}2.${C_RESET} ${C_BOLD}cue init${C_RESET}        ${C_DIM}# auto-detects project, suggests a profile${C_RESET}
    ${C_GREEN}3.${C_RESET} ${C_BOLD}cue discover${C_RESET}    ${C_DIM}# browse community skills, scored + ranked${C_RESET}
    ${C_GREEN}4.${C_RESET} ${C_BOLD}claude${C_RESET}          ${C_DIM}# cue auto-resolves the right profile for this cwd${C_RESET}

  Docs:    ${C_CYAN}https://opencue.github.io/cue/${C_RESET}
  Issues:  ${C_CYAN}https://github.com/opencue/cuecards/issues${C_RESET}

EOF
fi
