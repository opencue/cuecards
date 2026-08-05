#!/usr/bin/env bash
# cue — Agent Profile Manager installer
#
# Idempotent; safe to re-run. Confirms before any destructive step.
#
# Usage:
#   ./install.sh                # interactive: prompts for shim install
#   ./install.sh --yes          # non-interactive; install claude shim
#   ./install.sh --yes --codex  # also install the codex shim
#   ./install.sh --uninstall    # remove symlinks + shims; leaves the repo
#
# Pre-reqs the installer verifies (but does NOT auto-install):
#   - git
#   - bun (https://bun.sh)
#
# Sources read for config (with defaults):
#   CUE_DIR        repo location  (default: dir of this script)
#   SHIM_DIR       where the `cue` symlink goes  (default: $HOME/.local/bin)
#   CUE_SHIMS      where the agent shims go
#                  (default: ${XDG_CONFIG_HOME:-$HOME/.config}/cue/shims)

set -euo pipefail

# Resolve the directory this script lives in, following symlinks.
__src="${BASH_SOURCE[0]}"
while [ -h "$__src" ]; do
  __dir="$(cd -P "$(dirname "$__src")" && pwd)"
  __src="$(readlink "$__src")"
  [[ "$__src" != /* ]] && __src="$__dir/$__src"
done
CUE_DIR="${CUE_DIR:-$(cd -P "$(dirname "$__src")" && pwd)}"
SHIM_DIR="${SHIM_DIR:-$HOME/.local/bin}"
# Agent shims live in a dir cue owns outright. ~/.local/bin belongs to the
# native Claude installer: its `claude` is a symlink to the real binary, often
# the only one on PATH, and it gets rewritten on every Claude update.
CUE_SHIMS="${CUE_SHIMS:-${XDG_CONFIG_HOME:-$HOME/.config}/cue/shims}"

say()  { printf '%s\n' "$*" >&2; }
ok()   { say "  ${GREEN}✓${RESET} $*"; }
warn() { say "  ${YELLOW}!${RESET} $*"; }
die()  { say "  ${RED}✗${RESET} $*"; exit 1; }

if [ -t 2 ]; then
  GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; DIM='\033[2m'; RESET='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; DIM=''; RESET=''
fi

# ---------- argv ----------
ASSUME_YES=0
INSTALL_CODEX=0
UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    --codex)  INSTALL_CODEX=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *) die "Unknown option: $arg" ;;
  esac
done

# ---------- uninstall ----------
if [ "$UNINSTALL" = "1" ]; then
  say "${DIM}→ Removing cue shims and symlinks${RESET}"
  for f in "$SHIM_DIR/cue" "$CUE_SHIMS/claude" "$CUE_SHIMS/codex" "$SHIM_DIR/claude" "$SHIM_DIR/codex"; do
    [ -L "$f" ] || [ -e "$f" ] || continue
    agent="$(basename "$f")"
    target="$(readlink "$f" 2>/dev/null || true)"
    # Only remove what is provably ours: a symlink into the cue repo, or a
    # shim whose body calls `cue launch`. A bare symlink is NOT proof —
    # ~/.local/bin/claude is a symlink on every native Claude install.
    if [[ "$target" == "$CUE_DIR"* ]] || { grep -q "launch $agent" "$f" 2>/dev/null && grep -qi "cue" "$f" 2>/dev/null; }; then
      rm "$f"
      ok "Removed $f"
    else
      warn "Skipped $f — not managed by cue (target: ${target:-<file>})"
    fi
  done
  say ""
  ok "Uninstall complete. The repo at $CUE_DIR is untouched."
  exit 0
fi

# ---------- install ----------
say ""
say "${DIM}cue — Agent Profile Manager for Claude Code & Codex${RESET}"
say "${DIM}Installing from: $CUE_DIR${RESET}"
say ""

# 1. Required deps
say "${DIM}Step 1/6 — checking dependencies${RESET}"
command -v git  >/dev/null || die "git not found. Install git first."
ok "git ($(git --version | head -1))"
command -v bun  >/dev/null || die "bun not found. Install from https://bun.sh and re-run."
ok "bun ($(bun --version))"

# 2. JS dependencies in the repo
say ""
say "${DIM}Step 2/6 — installing JS dependencies${RESET}"
cd "$CUE_DIR"
bun install --silent 2>&1 | tail -3
ok "dependencies installed"

# 3. Self-check the binary
say ""
say "${DIM}Step 3/6 — verifying cue binary${RESET}"
"$CUE_DIR/bin/cue" --version >/dev/null || die "cue binary failed self-check"
ok "cue $("$CUE_DIR/bin/cue" --version) works"

# 4. Symlink cue into ~/.local/bin
say ""
say "${DIM}Step 4/6 — exposing cue on PATH${RESET}"
mkdir -p "$SHIM_DIR"
if [ -L "$SHIM_DIR/cue" ] && [ "$(readlink "$SHIM_DIR/cue")" = "$CUE_DIR/bin/cue" ]; then
  ok "$SHIM_DIR/cue already points at $CUE_DIR/bin/cue"
elif [ -e "$SHIM_DIR/cue" ]; then
  warn "$SHIM_DIR/cue exists and is not a cue symlink — skipping (remove manually if you want cue here)"
else
  ln -s "$CUE_DIR/bin/cue" "$SHIM_DIR/cue"
  ok "symlinked $SHIM_DIR/cue → $CUE_DIR/bin/cue"
fi

case ":$PATH:" in
  *":$SHIM_DIR:"*) ok "$SHIM_DIR is on PATH" ;;
  *)
    warn "$SHIM_DIR is NOT on your PATH"
    say "   add this to your shell rc (~/.bashrc or ~/.zshrc) and restart the shell:"
    say "     export PATH=\"\$HOME/.local/bin:\$PATH\""
    ;;
esac

# 5. authmux (multi-account auth multiplexer)
say ""
say "${DIM}Step 5/6 — authmux${RESET}"
if command -v authmux >/dev/null 2>&1; then
  ok "authmux $(authmux --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' | head -1) already installed"
elif ! command -v npm >/dev/null 2>&1; then
  warn "npm not found — skipping authmux install (install Node.js + npm, then run: npm install -g authmux)"
else
  say "  Installing authmux globally…"
  npm install -g authmux 2>&1 | tail -3
  if command -v authmux >/dev/null 2>&1; then
    ok "authmux installed"
  else
    warn "authmux install failed — install manually: npm install -g authmux"
  fi
fi

# 6. Shims for claude and codex
say ""
say "${DIM}Step 6/6 — agent shims${RESET}"

install_shim() {
  local agent="$1"
  local shim_path="$CUE_SHIMS/$agent"

  mkdir -p "$CUE_SHIMS"
  cat > "$shim_path" <<EOF
#!/usr/bin/env bash
exec "$CUE_DIR/bin/cue" launch $agent "\$@"
EOF
  chmod +x "$shim_path"
  ok "wrote $shim_path"

  # Migrate: older installers wrote the shim into ~/.local/bin, where it now
  # shadows the real binary. Remove only what is provably ours — never a
  # native-installer symlink.
  # ...but only when it is a DIFFERENT file. With SHIM_DIR and CUE_SHIMS set to
  # the same directory, `legacy` is the shim written three lines up, and this
  # migration deletes the thing it was asked to install.
  local legacy="$SHIM_DIR/$agent"
  if [ "$legacy" != "$shim_path" ] \
     && grep -q "launch $agent" "$legacy" 2>/dev/null && grep -qi "cue" "$legacy" 2>/dev/null; then
    rm -f "$legacy"
    ok "removed legacy cue shim at $legacy"
  fi

  case ":$PATH:" in
    *":$CUE_SHIMS:"*) ;;
    *)
      warn "$CUE_SHIMS is NOT on PATH — the $agent shim is inert until it is"
      say "     bash/zsh: export PATH=\"$CUE_SHIMS:\$PATH\""
      say "     fish:     fish_add_path -g -p $CUE_SHIMS"
      ;;
  esac
}

want_claude=1
want_codex="$INSTALL_CODEX"

if [ "$ASSUME_YES" = "0" ] && [ -t 0 ] && [ -t 1 ]; then
  printf "  Install $CUE_SHIMS/claude shim now? [Y/n] " >&2
  read -r ans
  case "$ans" in [Nn]*) want_claude=0 ;; esac

  if [ "$want_codex" = "0" ]; then
    printf "  Install $CUE_SHIMS/codex shim too? [y/N] " >&2
    read -r ans
    case "$ans" in [Yy]*) want_codex=1 ;; esac
  fi
fi

[ "$want_claude" = "1" ] && install_shim claude || true
[ "$want_codex"  = "1" ] && install_shim codex  || true

# ---------- done ----------
say ""
say "${GREEN}━━━━ install complete ━━━━${RESET}"
say ""
say "Next steps:"
say "  ${DIM}1.${RESET} If PATH wasn't already set above, restart your shell (or 'source ~/.bashrc')"
say "  ${DIM}2.${RESET} cd into a project and pin a profile:"
say "       echo marketing > .cue-profile"
say "  ${DIM}3.${RESET} Type 'claude' — cue intercepts, materializes, and launches with that profile"
say ""
say "Useful commands:"
say "  cue list                                  # show available profiles"
say "  cue current                               # what profile is active in this cwd"
say "  cue launch claude --cue-profile X --dry-run   # preview without launching"
say "  $CUE_DIR/install.sh --uninstall           # remove shims + symlinks"
say ""
say "Docs: $CUE_DIR/README.md · $CUE_DIR/docs/launch.md"
