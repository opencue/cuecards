#!/usr/bin/env bash
# Record the cue demo inside a headless Kitty + tmux session so brand-logo
# PNGs render via the real Kitty graphics protocol (not emoji fallback).
#
# Pipeline: Xvfb (virtual X display) → kitty + tmux → ffmpeg x11grab → GIF
#
# Outputs: docs/assets/demo.gif

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Config ───────────────────────────────────────────────────────────────────
DISPLAY_NUM=":99"
WIDTH=1500
HEIGHT=900
GIF_WIDTH=1200
RECORD_SECONDS=42
FFMPEG="${FFMPEG:-$(command -v ffmpeg 2>/dev/null)}"
[[ -x "${FFMPEG:-}" ]] || { echo "ffmpeg not found; set FFMPEG=/path/to/ffmpeg" >&2; exit 1; }
OUT_MP4=/tmp/cue-demo-raw.mp4
OUT_PALETTE=/tmp/cue-demo-palette.png
OUT_GIF=docs/assets/demo.gif

# ── Flashpaste guard ─────────────────────────────────────────────────────────
# flashpasted mirrors host clipboard into nested Wayland sessions, so kitty
# inside the recorder picks up image pastes and feeds them to claude as
# `[Image #N]`. Pause it for the duration of the recording.
FLASHPASTE_UNITS=(flashpasted.service flashpaste-screenshot-watcher.service)
FLASHPASTE_STOPPED=()
stop_flashpaste() {
  for unit in "${FLASHPASTE_UNITS[@]}"; do
    if systemctl --user is-active --quiet "$unit" 2>/dev/null; then
      systemctl --user stop "$unit" 2>/dev/null && FLASHPASTE_STOPPED+=("$unit")
    fi
  done
  [[ ${#FLASHPASTE_STOPPED[@]} -gt 0 ]] && echo "▸ paused flashpaste: ${FLASHPASTE_STOPPED[*]}"
}
start_flashpaste() {
  for unit in "${FLASHPASTE_STOPPED[@]}"; do
    systemctl --user start "$unit" 2>/dev/null
  done
}

# ── Cleanup on exit ──────────────────────────────────────────────────────────
cleanup() {
  set +e
  [[ -n "${FFMPEG_PID:-}" ]] && kill -TERM "$FFMPEG_PID" 2>/dev/null
  pkill -f "kitty.*cue-demo" 2>/dev/null
  tmux -L cue-demo kill-server 2>/dev/null
  [[ -n "${XVFB_PID:-}" ]] && kill -TERM "$XVFB_PID" 2>/dev/null
  rm -f /tmp/cue-demo-tmux.conf
  start_flashpaste
}
trap cleanup EXIT INT TERM

stop_flashpaste

# ── 1. Virtual X display ─────────────────────────────────────────────────────
echo "▸ starting Xvfb on $DISPLAY_NUM (${WIDTH}x${HEIGHT})"
Xvfb "$DISPLAY_NUM" -screen 0 "${WIDTH}x${HEIGHT}x24" -nolisten tcp &
XVFB_PID=$!
sleep 1.5

# ── 2. Demo working dir ──────────────────────────────────────────────────────
rm -rf /tmp/cue-demo
mkdir -p /tmp/cue-demo

# ── 3. tmux config with kitty graphics passthrough ───────────────────────────
cat > /tmp/cue-demo-tmux.conf <<'EOF'
set -g allow-passthrough on
set -g default-terminal "xterm-kitty"
set -as terminal-features ",xterm-kitty:RGB"
set -g status off
set -g mouse off
EOF

# ── 4. Start tmux server detached ────────────────────────────────────────────
echo "▸ spinning up tmux session 'demo'"
DISPLAY=$DISPLAY_NUM tmux -L cue-demo -f /tmp/cue-demo-tmux.conf \
  new-session -d -s demo -x $((WIDTH/10)) -y $((HEIGHT/22)) \
  "cd /tmp/cue-demo && bash --noprofile --norc -i"

# Prime the inner shell environment
SEND() { tmux -L cue-demo send-keys -t demo "$@"; }

SEND 'unset CUE_LAUNCHING CLAUDE_CONFIG_DIR CLAUDECODE CLAUDE_CODE_SESSION_ID CLAUDE_EFFORT AI_AGENT CODEX_HOME' Enter
# Derive the active node binary directory at record time so the demo PATH
# doesn't break if the Node version changes or a different version manager is used.
_NODE_BIN="$(command -v node 2>/dev/null || true)"
_NODE_BIN_DIR="${_NODE_BIN:+$(dirname "$_NODE_BIN")}"
[[ -z "$_NODE_BIN_DIR" ]] && _NODE_BIN_DIR='$HOME/.local/bin'
SEND "export PATH=\"\$HOME/.local/bin:${_NODE_BIN_DIR}:\$HOME/Documents/cue/bin:\$PATH\"" Enter
SEND 'export TERM=xterm-kitty' Enter
SEND 'export CUE_KITTY=1' Enter
SEND 'PS1="\[\033[38;5;213m\]➜\[\033[0m\] \[\033[38;5;111m\]demo\[\033[0m\] "' Enter
SEND 'clear' Enter
sleep 0.6

# ── 5. Attach a real kitty window to the virtual display ─────────────────────
echo "▸ launching kitty in Xvfb (will attach to tmux)"
DISPLAY=$DISPLAY_NUM kitty \
  --class cue-demo \
  --start-as=fullscreen \
  --override font_family="JetBrainsMono Nerd Font" \
  --override font_size=14 \
  --override background="#0f0f1a" \
  --override foreground="#f1f5f9" \
  --override window_padding_width=14 \
  --override cursor_blink_interval=0 \
  --override enable_audio_bell=no \
  --override scrollback_lines=10000 \
  --override remember_window_size=no \
  --override initial_window_width=${WIDTH} \
  --override initial_window_height=${HEIGHT} \
  --override hide_window_decorations=yes \
  -- tmux -L cue-demo attach -t demo >/dev/null 2>&1 &
KITTY_PID=$!
sleep 2.8

# Belt-and-suspenders: explicitly resize/move kitty window in case fullscreen needs a WM
DISPLAY=$DISPLAY_NUM xdotool search --class cue-demo windowsize ${WIDTH} ${HEIGHT} windowmove 0 0 windowfocus 2>/dev/null || true
sleep 0.4

# ── Preflight: confirm kitty actually rendered to Xvfb ───────────────────────
if command -v xwd >/dev/null && command -v convert >/dev/null; then
  DISPLAY=$DISPLAY_NUM xwd -root | convert xwd:- /tmp/cue-preflight.png 2>/dev/null
  mean=$(identify -format '%[mean]' /tmp/cue-preflight.png 2>/dev/null || echo "0")
  size=$(stat -c%s /tmp/cue-preflight.png 2>/dev/null || echo "0")
  echo "▸ preflight Xvfb screenshot: ${size} bytes, mean pixel intensity ${mean}"
  if [[ "$size" -lt 5000 ]]; then
    echo "  ⚠ preflight image is suspiciously small — kitty may not have rendered. Recording anyway."
  fi
fi

# ── 6. Start ffmpeg recording ────────────────────────────────────────────────
echo "▸ starting ffmpeg x11grab (recording ${RECORD_SECONDS}s)"
"$FFMPEG" -y -loglevel error \
  -f x11grab -video_size "${WIDTH}x${HEIGHT}" -framerate 15 -i "$DISPLAY_NUM" \
  -t "$RECORD_SECONDS" -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
  "$OUT_MP4" &
FFMPEG_PID=$!
sleep 1.2

# ── 7. Drive the demo via tmux send-keys ─────────────────────────────────────
echo "▸ running demo commands"

# Phase 1: install (faked)
SEND '# 1. install' Enter
sleep 0.6
SEND 'npm install -g cue-ai' Enter
sleep 1.0
SEND 'clear' Enter; sleep 0.4

# Phase 2: optimizer (THIS is where kitty graphics show off real PNG logos)
SEND '# 2. audit what loads' Enter
sleep 0.5
SEND 'cue optimizer readme-writer' Enter
sleep 7.5

SEND 'clear' Enter; sleep 0.4

# Phase 3: pin + claude actual launch
SEND '# 3. type claude — picker, then load' Enter
sleep 0.5
SEND 'claude' Enter
sleep 3.0

# Arrow down to readme-writer (14 from "full")
for i in $(seq 1 14); do
  SEND Down
  sleep 0.08
done
sleep 0.7
SEND Enter            # selects readme-writer
sleep 1.6             # wait for "Pin to this directory?" prompt to render
SEND Enter            # answers Yes (default) → pins + launches claude
sleep 7.5             # let Claude Code boot screen render

# ── 8. Wait for ffmpeg to finish ─────────────────────────────────────────────
echo "▸ waiting for ffmpeg to finalize"
wait $FFMPEG_PID || true

# ── 9. Convert mp4 → palette → gif (2-pass = sharp colors) ───────────────────
echo "▸ palettegen"
"$FFMPEG" -y -loglevel error -i "$OUT_MP4" \
  -vf "fps=12,scale=${GIF_WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff" \
  "$OUT_PALETTE"

echo "▸ paletteuse → $OUT_GIF"
"$FFMPEG" -y -loglevel error -i "$OUT_MP4" -i "$OUT_PALETTE" \
  -lavfi "fps=12,scale=${GIF_WIDTH}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4" \
  "$OUT_GIF"

echo "✓ $OUT_GIF written ($(du -h "$OUT_GIF" | cut -f1))"
