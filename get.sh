#!/usr/bin/env bash
# cue — one-line installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/recodeee/cue/main/get.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/recodeee/cue/main/get.sh | bash -s -- --yes
#
# Environment variables:
#   CUE_DIR     — where to clone (default: ~/Documents/cue)
#   CUE_BRANCH  — git branch to clone (default: main)

set -euo pipefail

CUE_DIR="${CUE_DIR:-$HOME/Documents/cue}"
CUE_BRANCH="${CUE_BRANCH:-main}"
CUE_REPO="https://github.com/recodeee/cue.git"

# Colors
if [ -t 2 ] && [ -t 1 ]; then
  ORANGE='\033[38;5;208m'
  GREEN='\033[38;5;82m'
  CYAN='\033[38;5;81m'
  DIM='\033[2m'
  BOLD='\033[1m'
  RED='\033[38;5;196m'
  YELLOW='\033[38;5;220m'
  RESET='\033[0m'
  BG='\033[48;5;235m'
else
  ORANGE='' GREEN='' CYAN='' DIM='' BOLD='' RED='' YELLOW='' RESET='' BG=''
fi

say()  { printf '%s\n' "$*" >&2; }
ok()   { say "  ${GREEN}✓${RESET} $*"; }
warn() { say "  ${YELLOW}⚠${RESET} $*"; }
err()  { say "  ${RED}✗${RESET} $*"; }
die()  { err "$*"; exit 1; }
step() { say ""; say "${ORANGE}━━━ $1 ━━━${RESET}"; }

# Banner
say ""
say "${ORANGE}   ██████╗██╗   ██╗███████╗${RESET}"
say "${ORANGE}  ██╔════╝██║   ██║██╔════╝${RESET}"
say "${ORANGE}  ██║     ██║   ██║█████╗  ${RESET}"
say "${ORANGE}  ██║     ██║   ██║██╔══╝  ${RESET}"
say "${ORANGE}  ╚██████╗╚██████╔╝███████╗${RESET}"
say "${ORANGE}   ╚═════╝ ╚═════╝ ╚══════╝${RESET}"
say ""
say "  ${BOLD}Agent Profile Manager${RESET} for Claude Code & Codex"
say "  ${DIM}https://github.com/recodeee/cue${RESET}"
say "  ${DIM}npm: cue-ai${RESET}"
say ""

# Step 1: Prerequisites
step "Step 1/4 — checking prerequisites"

if ! command -v git >/dev/null 2>&1; then
  die "git is required. Install it first:
     macOS:  xcode-select --install
     Ubuntu: sudo apt install git
     Fedora: sudo dnf install git"
fi
ok "git $(git --version | cut -d' ' -f3)"

if ! command -v bun >/dev/null 2>&1; then
  say "  ${DIM}Installing bun...${RESET}"
  curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
  export PATH="$HOME/.bun/bin:$PATH"
  if ! command -v bun >/dev/null 2>&1; then
    die "bun install failed. Install manually: https://bun.sh"
  fi
  ok "bun installed ($(bun --version))"
else
  ok "bun $(bun --version)"
fi

# Step 2: Clone/update repo
step "Step 2/4 — installing cue"

if [ -d "$CUE_DIR/.git" ]; then
  say "  ${DIM}Updating existing install at ${CUE_DIR}...${RESET}"
  cd "$CUE_DIR"
  git pull --ff-only origin "$CUE_BRANCH" 2>/dev/null || true
  ok "repo updated"
else
  say "  ${DIM}Cloning to ${CUE_DIR}...${RESET}"
  git clone --depth 1 --branch "$CUE_BRANCH" "$CUE_REPO" "$CUE_DIR" 2>/dev/null
  ok "cloned"
fi

# Step 3: Install dependencies
step "Step 3/4 — installing dependencies"

cd "$CUE_DIR"
bun install --frozen-lockfile 2>/dev/null || bun install 2>/dev/null
ok "dependencies installed"

# Verify binary
if "$CUE_DIR/bin/cue" --version >/dev/null 2>&1; then
  ok "cue $($CUE_DIR/bin/cue --version) works"
else
  die "cue binary check failed"
fi

# Step 4: Set up PATH + shims
step "Step 4/4 — setting up PATH"

SHIM_DIR="$HOME/.local/bin"
mkdir -p "$SHIM_DIR"

# Symlink cue
if [ -L "$SHIM_DIR/cue" ] || [ -f "$SHIM_DIR/cue" ]; then
  rm -f "$SHIM_DIR/cue"
fi
ln -s "$CUE_DIR/bin/cue" "$SHIM_DIR/cue"
ok "cue → $SHIM_DIR/cue"

# Claude shim
cat > "$SHIM_DIR/claude" << 'SHIM'
#!/usr/bin/env bash
exec "$(dirname "$(readlink -f "$0")")/cue" launch claude "$@"
SHIM
chmod +x "$SHIM_DIR/claude"
ok "claude shim → $SHIM_DIR/claude"

# Check PATH
if echo "$PATH" | tr ':' '\n' | grep -qx "$SHIM_DIR"; then
  ok "$SHIM_DIR is on PATH"
else
  warn "$SHIM_DIR is NOT on PATH"
  say "    ${DIM}Add to your shell rc:${RESET}"
  say "    ${CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${RESET}"
fi

# Done!
say ""
say "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
say "${GREEN}  ✓ cue installed successfully!${RESET}"
say "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
say ""
say "  ${BOLD}Get started:${RESET}"
say ""
say "    ${CYAN}cd ~/your-project${RESET}"
say "    ${CYAN}cue init${RESET}              ${DIM}# set up a profile${RESET}"
say "    ${CYAN}claude${RESET}                ${DIM}# launch with profile${RESET}"
say ""
say "  ${BOLD}Useful commands:${RESET}"
say ""
say "    ${CYAN}cue list${RESET}              ${DIM}# show profiles${RESET}"
say "    ${CYAN}cue optimizer${RESET}         ${DIM}# visual dashboard${RESET}"
say "    ${CYAN}cue marketplace search \"X\"${RESET}  ${DIM}# find MCPs/skills${RESET}"
say "    ${CYAN}cue --help${RESET}            ${DIM}# all commands${RESET}"
say ""
say "  ${BOLD}Shell hook${RESET} (auto-switch profile on cd):"
say ""
say "    ${CYAN}echo 'eval \"\$(cue shell hook)\"' >> ~/.bashrc${RESET}"
say ""
say "  ${DIM}Docs: $CUE_DIR/README.md${RESET}"
say ""
