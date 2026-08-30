# cue — Claude Code Lean Setup (Linux)

> **For Claude Code (the CLI), not Claude Desktop.** This prompt needs shell access — only Claude Code has that.

Self-contained setup prompt for Linux. Tested on Ubuntu 22.04+, Debian 12+, Fedora 39+, Arch (rolling). Paste this entire file into your first Claude Code message in a fresh shell, answer the three questions in §9, and the assistant walks through the install one phase at a time.

---

### Easiest Linux path (recommended)

Open a terminal, paste this whole block in, hit Enter. It installs everything the bootstrap needs using upstream installers (no distro-specific package manager assumptions):

```bash
# 1. System packages (jq, curl, build essentials, git) — pick your distro
if   command -v apt    >/dev/null; then sudo apt update && sudo apt install -y curl git jq build-essential python3 python3-pip
elif command -v dnf    >/dev/null; then sudo dnf install -y curl git jq @development-tools python3 python3-pip
elif command -v pacman >/dev/null; then sudo pacman -S --noconfirm curl git jq base-devel python python-pip
else echo "Unsupported distro — install curl, git, jq, python3, build tools manually."; exit 1; fi

# 2. Bun (JS runtime for gbrain)
[ -x "$(command -v bun)" ] || curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

# 3. uv (Python venv manager for the Excel/Word MCPs)
[ -x "$(command -v uv)" ] || curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

# 4. RTK (Rust Token Killer — 60-90% shell-output savings)
if ! command -v rtk >/dev/null; then
  curl -fsSL https://github.com/rtk-ai/rtk/releases/latest/download/rtk-x86_64-unknown-linux-gnu.tar.gz \
    | tar xz -C /tmp && sudo install /tmp/rtk /usr/local/bin/rtk
fi

# 5. Claude Code itself
curl -fsSL https://claude.ai/install.sh | sh
# (alternative if you prefer npm: sudo apt install -y nodejs npm && sudo npm install -g @anthropic-ai/claude-code)

# 6. Wire RTK into Claude Code (auto-rewrites verbose commands to compact form)
rtk init -g

# 7. Done. Now open Claude Code in any directory:
echo "Setup complete. Run:  claude"
```

That installs everything except the MCPs and plugins — those need Claude Code to be running, because they're configured *via* Claude Code. Step 7 ends with a `claude` prompt; once in there, paste **this entire file** as your first message and the assistant will handle the rest interactively.

### Long-form prereq options

| Your machine has | Use |
|---|---|
| Bare Linux | The block above. Distro-detects + installs upstream. |
| Bun already | Skip step 2 |
| Node/npm already | Use `npm install -g @anthropic-ai/claude-code` in step 5 instead of the curl installer |
| asdf / mise managing runtimes | `asdf install bun latest && asdf install nodejs 22` then continue from step 3 |

**Then:** open a terminal → `claude` → paste this whole file as your first message. Claude Code reads it, asks the 3 questions in §9, and executes the remaining bootstrap phases (gbrain, MCP wrappers, Excel/Word MCPs, plugin enabling) with your confirmation between each.

## TL;DR

A Claude Code setup focused on:
- **Cross-session memory** so Claude remembers prior work (`claude-mem` plugin)
- **Token compression** for cheaper, faster replies (`caveman` plugin)
- **Persistent knowledge brain** for notes/recall across machines (`gbrain` MCP)
- **RTK (Rust Token Killer)** — CLI hook that filters command outputs, cuts shell-tool token usage by 60–90%
- **Excel + Word opensource MCPs** so Claude can read, write, format `.xlsx` / `.docx` natively

---

## 1. What you'll have after bootstrap

| Layer | What it does | Disk | Per-session RAM |
|---|---|---|---|
| **claude-mem** (plugin) | Captures session observations; future sessions search them with `mem-search`. | ~25 MB | ~120 MB worker daemon |
| **caveman** (plugin) | `/caveman` shrinks Claude's replies. `/caveman-commit` writes Conventional Commit messages. | ~5 MB | none |
| **RTK** (CLI hook) | Filters command outputs before Claude sees them — `ls`/`cat`/`git`/tests get 60–90% smaller. | ~15 MB | none |
| **gbrain** (MCP server) | Personal knowledge brain (PGLite + embeddings). | ~50 MB DB | ~250 MB |
| **excel-mcp-server** (MCP) | Read/write/format `.xlsx` via openpyxl. github.com/haris-musa/excel-mcp-server | ~50 MB | ~100 MB |
| **office-word-mcp-server** (MCP) | Read/write `.docx` via python-docx. github.com/GongRzhe/Office-Word-MCP-Server | ~30 MB | ~80 MB |

Total cold footprint per Claude session: ~550 MB.

### 1.1 claude-mem vs gbrain — use both, different lanes

Same as the macOS setup. claude-mem captures observations passively; gbrain is your manually-curated knowledge wiki. Both recommended.

---

## 2. MCP servers — gbrain + Excel + Word

These three MCP servers get configured in `~/.claude.json` under `mcpServers`. We'll write them automatically in §5.

```jsonc
{
  "mcpServers": {
    "gbrain": {
      "command": "/home/<you>/.local/bin/gbrain-mcp-wrapper.sh"
    },
    "excel": {
      "command": "uvx",
      "args": ["excel-mcp-server", "stdio"]
    },
    "word": {
      "command": "uvx",
      "args": ["--from", "office-word-mcp-server", "word_mcp_server"]
    }
  }
}
```

### gbrain wrapper — why and how

Bun-based MCPs (gbrain runs on Bun) leak RAM if Claude Code exits abruptly. Two mitigations:

1. **`bun --smol`** — runs Bun's GC more aggressively. ~25% less RSS per gbrain process.
2. **Parent-PID watcher** — if Claude Code dies, the wrapper kills its gbrain child instead of letting it orphan to `systemd`/`init`.

The wrapper is installed in §5 step 4.

---

## 3. Plugins — claude-mem + caveman

Plugins are installed via the `/plugin` interactive command inside Claude Code.

| Plugin | Marketplace | Add command (inside Claude) |
|---|---|---|
| **claude-mem** | thedotmack | `/plugin marketplace add thedotmack` |
| **cavekit (caveman-*)** | cavekit-marketplace | `/plugin marketplace add cavekit-marketplace` |

After adding marketplaces, restart Claude Code. The `enabledPlugins` block we write in §5 flips them on.

## 3.5 RTK — already installed in the block above

If you skipped the easiest-path block:

```bash
curl -fsSL https://github.com/rtk-ai/rtk/releases/latest/download/rtk-x86_64-unknown-linux-gnu.tar.gz \
  | tar xz -C /tmp && sudo install /tmp/rtk /usr/local/bin/rtk
rtk init -g
# verify:
rtk --version
rtk gain
```

**Caveats** — Only hooks **Bash** tool calls. Telemetry is **opt-in only**. Restart Claude Code after `rtk init -g`. The URL above is **x86_64**; on ARM Linux (aarch64) grab the matching `aarch64` asset from the [RTK releases page](https://github.com/rtk-ai/rtk/releases) instead.

---

## 4. Memory tuning — only if you run multiple sessions

Linux already has compressed memory available via zram if your distro ships it. **Skip this section unless you run 3+ Claude Code panes at once.** If you do:

- Verify swap or zram: `swapon --show` / `zramctl`
- Close idle Claude sessions you're not using. Each pins ~500 MB.
- The optional claude-mem `--smol` patch (3 files, see §7) cuts the worker daemon from ~120 MB → ~85 MB. Worthwhile only with 4+ concurrent sessions.

---

## 5. Bootstrap commands

After you confirm, the assistant runs these one phase at a time. Each phase ends with a verification command.

```bash
# Phase 1: prereqs (skip if you already ran the easiest-path block)
if   command -v apt    >/dev/null; then sudo apt update && sudo apt install -y curl git jq build-essential python3 python3-pip
elif command -v dnf    >/dev/null; then sudo dnf install -y curl git jq @development-tools python3 python3-pip
elif command -v pacman >/dev/null; then sudo pacman -S --noconfirm curl git jq base-devel python python-pip
fi
[ -x "$(command -v bun)" ] || curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
[ -x "$(command -v uv)"  ] || curl -LsSf https://astral.sh/uv/install.sh | sh
if ! command -v rtk >/dev/null; then
  curl -fsSL https://github.com/rtk-ai/rtk/releases/latest/download/rtk-x86_64-unknown-linux-gnu.tar.gz \
    | tar xz -C /tmp && sudo install /tmp/rtk /usr/local/bin/rtk
fi
# verify:
bun --version && uv --version && rtk --version

# Phase 2: install Claude Code + wire RTK hook
curl -fsSL https://claude.ai/install.sh | sh
rtk init -g
# verify:
claude --version

# Phase 3: install gbrain
bun install -g gbrain
gbrain init --pglite
# verify:
gbrain doctor --fast

# Phase 4: gbrain MCP wrapper (kills gbrain when Claude exits + uses --smol)
mkdir -p ~/.local/bin
cat > ~/.local/bin/gbrain-mcp-wrapper.sh <<'SH'
#!/usr/bin/env bash
set -u
export GBRAIN_HOME="${GBRAIN_HOME:-$HOME/.gbrain}"
GBRAIN_SCRIPT=$(readlink -f "$(which gbrain)")
BUN_BIN=$(which bun)
# Parent-PID watcher: if Claude Code dies, kill our process group.
parent_pid=$PPID
( while kill -0 "$parent_pid" 2>/dev/null; do sleep 10; done; kill -TERM 0 2>/dev/null ) &
exec "$BUN_BIN" --smol "$GBRAIN_SCRIPT" serve 2>/tmp/gbrain-mcp.stderr
SH
chmod +x ~/.local/bin/gbrain-mcp-wrapper.sh
# verify:
[ -x ~/.local/bin/gbrain-mcp-wrapper.sh ] && echo "wrapper ok"

# Phase 5: register MCP servers in ~/.claude.json
mkdir -p ~/.claude
python3 - <<'PY'
import json, pathlib, os
p = pathlib.Path(os.path.expanduser('~/.claude.json'))
d = json.loads(p.read_text()) if p.exists() else {}
d.setdefault('mcpServers', {}).update({
    'gbrain': {
        'command': os.path.expanduser('~/.local/bin/gbrain-mcp-wrapper.sh')
    },
    'excel': {
        'command': 'uvx',
        'args': ['excel-mcp-server', 'stdio']
    },
    'word': {
        'command': 'uvx',
        'args': ['--from', 'office-word-mcp-server', 'word_mcp_server']
    },
})
p.write_text(json.dumps(d, indent=2))
print('mcpServers registered: gbrain, excel, word')
PY

# Phase 6: add plugin marketplaces (interactive). Run these INSIDE Claude Code:
#   /plugin marketplace add thedotmack
#   /plugin marketplace add cavekit-marketplace
# Then in a normal shell, enable them:
python3 - <<'PY'
import json, pathlib, os
p = pathlib.Path(os.path.expanduser('~/.claude/settings.json'))
d = json.loads(p.read_text()) if p.exists() else {}
d.setdefault('enabledPlugins', {}).update({
    'claude-mem@thedotmack': True,
    'cavekit@cavekit-marketplace': True,
    'pm-skills@claude-code-skills': False,
    'engineering-skills@claude-code-skills': False,
    'product-skills@claude-code-skills': False,
    'marketing-skills@claude-code-skills': False,
})
p.write_text(json.dumps(d, indent=2))
print('enabledPlugins updated')
PY

# Phase 7: token-effective CLAUDE.md defaults
cat > ~/.claude/CLAUDE.md <<'EOF'
# Claude Code Local Instructions

Response style: terse, act-first, no preambles, no trailing summaries.

Minimal safe mode:
- Don't start MCP servers, plugins, or hooks unless explicitly asked.
- Prefer direct local work over orchestration.
- Ask before network access, destructive actions, or long-running background commands.

Excel/Word:
- Use mcp__excel__* tools for .xlsx; mcp__word__* for .docx.
- Confirm the file path with the user before overwriting an existing document.
EOF

# Phase 8: final verification
claude --version
ls ~/.claude/skills 2>/dev/null | wc -l
echo "Done. Open Claude Code: 'claude' — your MCPs and plugins are wired up."
```

---

## 6. Token-effective conventions

Same as macOS — `/caveman`, `/caveman-commit`, let claude-mem capture passively, one Claude Code window at a time.

---

## 7. Optional: claude-mem `--smol` patch

If you run **4+ Claude Code sessions concurrently**, the claude-mem worker daemon is the biggest leak source. After `/plugin install` fetches it:

1. Locate the plugin cache: `ls ~/.claude/plugins/cache/thedotmack/claude-mem/`
2. In the highest version dir's `scripts/bun-runner.js`, change `let spawnArgs = args;` to `let spawnArgs = process.env.BUN_NO_SMOL ? args : ['--smol', ...args];`
3. In `scripts/worker-wrapper.cjs`, change `process.execPath,[l]` to `process.execPath,(process.env.BUN_NO_SMOL?[l]:["--smol",l])`
4. In `scripts/worker-service.cjs`, prepend `"--smol"` to both `[e,"--daemon"]` and `[t,"--daemon"]` arrays.

**Caveat:** these edits get wiped on the next `claude-mem` plugin upgrade. Re-apply after an upgrade.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `uvx: command not found` | `uv` not on PATH | `export PATH=$HOME/.local/bin:$PATH` (add to `.bashrc` / `.zshrc`) |
| Excel MCP returns no tools | First run is downloading the package | Wait 30 s — uvx caches after that |
| gbrain MCP doesn't appear | Path in `~/.claude.json` wrong | `which gbrain` and verify the wrapper points to a real binary |
| `bun: command not found` for the wrapper | Bun not on PATH for Claude's env | Use absolute path `$HOME/.bun/bin/bun` in the wrapper |
| Plugin not showing skills after enabling | Need to restart Claude Code | `pkill -f claude && claude` |
| RAM keeps climbing across sessions | Stale gbrain processes orphaning | `pgrep -af 'gbrain serve'` — kill any with PPID 1 |
| `rtk: command not found` after install | `/usr/local/bin` not in PATH | `which rtk` or add to PATH |

---

## 9. Ask before running

Read the above, then ask:

1. Which distro / package manager? (apt / dnf / pacman / other) Confirms the Phase 1 path.
2. Do you want both **claude-mem** *and* **gbrain**, or just one? They serve different lanes — see §1.1 — and both are recommended.
3. RTK telemetry — leave it disabled (default) or opt in for usage stats? Disabled = nothing leaves your machine.

Then run Phase 1, verify, proceed to Phase 2, and so on. Don't run the whole script as one blob — confirm each phase.
