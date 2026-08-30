# cue — Claude Code Lean Setup (macOS)

> **For Claude Code (the CLI), not Claude Desktop.** Claude Desktop is a chat app and cannot run installs. This prompt needs shell access — only Claude Code has that.

This is a self-contained setup prompt. Paste this entire file into your first Claude Code message in a fresh shell, answer the three questions in §9, and the assistant walks through the install one phase at a time.

---

### Easiest macOS path (recommended)

Open **Terminal** (⌘+Space → "Terminal" → Enter), paste this whole block in, hit Enter once. It installs everything the bootstrap will need:

```bash
# 1. Homebrew (skip if you have it)
[ -x "$(command -v brew)" ] || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Core tools (bun, node, python, uv for the Excel/Word MCPs, jq for JSON, rtk for token-savings hooks)
brew install bun node@22 python@3.12 uv jq rtk

# 3. Claude Code itself
curl -fsSL https://claude.ai/install.sh | sh
# (alternative: npm install -g @anthropic-ai/claude-code)

# 4. Wire RTK into Claude Code (auto-rewrites verbose commands to compact form, 60-90% token savings)
rtk init -g

# 5. Done. Now open Claude Code in any directory:
echo "Setup complete. Run:  claude"
```

That installs everything except the MCPs and plugins — those need Claude Code to be running, because they're configured *via* Claude Code. Step 5 ends with a `claude` prompt; once in there, paste **this entire file** as your first message and the assistant will handle the rest interactively.

### Long-form prereq options (if the block above doesn't fit your machine)

| Your machine has | Use |
|---|---|
| Nothing — bare macOS | The block above. Installs Homebrew, then everything else. |
| Homebrew but no Node | `brew install node@22 && npm install -g @anthropic-ai/claude-code` |
| Node/npm already | `npm install -g @anthropic-ai/claude-code` |
| Want to avoid Homebrew entirely | `curl -fsSL https://claude.ai/install.sh \| sh` (Claude Code only — you'll still need to install bun/uv manually for MCPs later) |

**Then:** open Terminal → `claude` → paste this whole file as your first message. Claude Code will read it, ask the 3 questions in §9, and execute the remaining bootstrap phases (gbrain, MCP wrappers, Excel/Word MCPs, plugin enabling) with your confirmation between each.

## TL;DR

A Claude Code setup focused on:
- **Cross-session memory** so Claude remembers prior work (`claude-mem` plugin)
- **Token compression** for cheaper, faster replies (`caveman` plugin)
- **Persistent knowledge brain** for notes/recall across machines (`gbrain` MCP)
- **RTK (Rust Token Killer)** — a CLI hook that filters command outputs, cuts shell-tool token usage by 60–90% (separate from plugins; see §3.5)
- **Excel + Word opensource skills** so Claude can read, write, format `.xlsx` / `.docx` natively

No codex-fleet, no Colony, no Medusa tooling, no Linux-specific tuning. Just what one person needs for office + AI-assisted work.

---

## 1. What you'll have after bootstrap

| Layer | What it does | Disk | Per-session RAM |
|---|---|---|---|
| **claude-mem** (plugin) | Captures session observations; future sessions search them with `mem-search`. Solves "did we already figure this out?" | ~25 MB | ~120 MB worker daemon |
| **caveman** (plugin) | `/caveman` shrinks Claude's replies to terse form (saves tokens). `/caveman-commit` writes Conventional Commit messages. | ~5 MB | none |
| **RTK** (CLI hook, not a plugin) | Filters command outputs before Claude sees them — `ls`/`cat`/`git`/tests get 60–90% smaller. Installed once via `brew install rtk && rtk init -g`. See §3.5 | ~15 MB binary | none (runs inline on each Bash call) |
| **gbrain** (MCP server) | Personal knowledge brain (PGLite + embeddings). Cross-session recall via `mcp__gbrain__*`. | ~50 MB DB | ~250 MB |
| **excel-mcp-server** (MCP) | Read/write/format `.xlsx` files via openpyxl. Opensource: github.com/haris-musa/excel-mcp-server | ~50 MB | ~100 MB |
| **office-word-mcp-server** (MCP) | Read/write `.docx` files via python-docx. Opensource: github.com/GongRzhe/Office-Word-MCP-Server | ~30 MB | ~80 MB |

Total cold footprint per Claude session: ~550 MB. Fine on any modern Mac.

### 1.1 claude-mem vs gbrain — use both, different lanes

They're complementary, not interchangeable:

| | claude-mem | gbrain |
|---|---|---|
| **What it stores** | Auto-captured *observations* from your sessions (hooks attach to SessionStart / PostToolUse) | *Pages* you (or Claude) explicitly write — like a personal wiki with tags, links, timeline |
| **How you retrieve** | `mem-search "topic"` — semantic search over prior session activity | `mcp__gbrain__search` / `query` / `traverse_graph` — structured pages, backlinks, timeline |
| **Write style** | **Passive** — claude-mem hooks decide what to capture; you don't manage it | **Active** — you say "save this as a page", Claude writes it; you curate |
| **Best for** | "Did we solve this before? What was the fix?" | "What do I know about <topic>? Show me the canonical doc." |
| **Cost per session** | ~120 MB worker daemon | ~250 MB Bun MCP |

Running both means: claude-mem watches your work passively, gbrain is your manually-curated knowledge base. They never conflict — different data stores, different APIs.

---

## 2. MCP servers — gbrain + Excel + Word

These three MCP servers get configured in `~/.claude.json` under `mcpServers`. Inside this file we'll write the entries automatically in §5; the snippet below shows what gets added.

```jsonc
{
  "mcpServers": {
    "gbrain": {
      "command": "/Users/<you>/.local/bin/gbrain-mcp-wrapper.sh"
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

`uvx` (from the `uv` Python tool) auto-fetches and runs Python MCP servers in isolated environments — no global pip pollution. We install `uv` in §5.

### gbrain wrapper — why and how

Bun-based MCPs (gbrain runs on Bun) leak RAM if Claude Code exits abruptly. Two mitigations baked into the wrapper:

1. **`bun --smol`** — runs Bun's GC more aggressively. ~25% less RSS per gbrain process.
2. **Parent-PID watcher** — if Claude Code dies, the wrapper kills its gbrain child instead of letting it orphan to `launchd`.

The wrapper is installed in §5 step 4.

---

## 3. Plugins — claude-mem + caveman

Plugins are installed via the `/plugin` interactive command inside Claude Code, then enabled in `~/.claude/settings.json`. The settings.json edit is automated in §5.

| Plugin | Marketplace | Add command (inside Claude) |
|---|---|---|
| **claude-mem** | thedotmack | `/plugin marketplace add thedotmack` |
| **cavekit (caveman-*)** | cavekit-marketplace | `/plugin marketplace add cavekit-marketplace` |

After adding marketplaces, restart Claude Code; the plugins become available. The `enabledPlugins` block we write in §5 flips them on.

## 3.5 RTK (Rust Token Killer) — not a plugin, separate CLI

RTK is a **standalone Rust binary**, not a Claude Code plugin. It installs a `PreToolUse` hook that intercepts Bash commands and rewrites them to compact equivalents *before* Claude sees the output. Example: `git status` → ~200 tokens instead of ~2,000. Across a typical Claude Code session it saves **60–90% of shell-command tokens**.

Already installed in the "Easiest macOS path" block above (`brew install rtk && rtk init -g`). If you ran the long-form prereqs instead, do it now:

```bash
brew install rtk             # Homebrew picks the native arm64/x86_64 build; if the formula is missing, grab a darwin binary from https://github.com/rtk-ai/rtk/releases
rtk init -g                  # writes the Claude Code hook + RTK.md guidance
# verify:
rtk --version
rtk gain                     # shows token-savings stats once you start using it
```

**Caveats** (from rtk docs):
- Only hooks **Bash** tool calls. Claude Code's built-in `Read`/`Grep`/`Glob` tools bypass the hook — for those you'd need to use `cat`/`rg`/`find` shell commands explicitly.
- Telemetry is **opt-in only** (disabled by default). Run `rtk telemetry status` to confirm.

Restart Claude Code after `rtk init -g` so the hook activates.

---

## 4. (Optional) Memory tuning — only if you run multiple sessions

macOS has built-in compressed memory; nothing to tune at the kernel level. **Skip this section unless you run 3+ Claude Code panes at once.** If you do:

- Ensure dynamic swap is enabled: `sysctl vm.swapusage` — should show a `/private/var/vm/swapfile*` growing as needed.
- Close idle Claude sessions you're not using. Each one pins ~500 MB.
- The optional claude-mem `--smol` patch (3 files, see §7) cuts the claude-mem worker daemon from ~120 MB → ~85 MB. Worthwhile only with 4+ concurrent sessions.

---

## 5. Bootstrap commands

After you confirm, the assistant will run these one phase at a time. Each phase ends with a verification command.

```bash
# Phase 1: prereqs + RTK (skip if you already ran the "Easiest macOS path" block above)
[ -x "$(command -v brew)" ] || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install bun node@22 jq uv python@3.12 rtk
# verify:
bun --version && node --version && uv --version && rtk --version

# Phase 2: install Claude Code + wire RTK hook
curl -fsSL https://claude.ai/install.sh | sh
rtk init -g
# verify:
claude --version

# Phase 3: install gbrain (Bun-based personal knowledge brain)
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
    # Disable Anthropic's default noisy bundles you're not using:
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
ls ~/.claude/skills 2>/dev/null | wc -l   # baseline count (will populate as plugins fetch)
echo "Done. Open Claude Code: 'claude' — your MCPs and plugins are wired up."
```

---

## 6. Token-effective conventions

These keep your context cheap session-to-session:

- **`/caveman`** at the start of a chat — Claude responds in compressed form. Toggle off with `/caveman off`.
- **`/caveman-commit`** instead of "write a commit message" — produces clean Conventional Commit subject + body.
- **Let claude-mem capture observations passively** (it hooks into SessionStart). Don't manually call `memory_add` — the plugin does it for you. Search prior sessions with `mem-search "topic"`.
- **One Claude Code window at a time, when possible.** Each window keeps its MCPs warm = real RAM cost. Close ones you're not actively using.

---

## 7. Optional: claude-mem `--smol` patch

If you run **4+ Claude Code sessions concurrently**, the claude-mem worker daemon is the biggest leak source. Apply this after `/plugin install` fetches it:

1. Locate the plugin cache: `ls ~/.claude/plugins/cache/thedotmack/claude-mem/`
2. Open the highest version dir's `scripts/bun-runner.js`. Find `let spawnArgs = args;` and change to `let spawnArgs = process.env.BUN_NO_SMOL ? args : ['--smol', ...args];`
3. In the same dir's `scripts/worker-wrapper.cjs`, find `process.execPath,[l]` and change to `process.execPath,(process.env.BUN_NO_SMOL?[l]:["--smol",l])`
4. In `scripts/worker-service.cjs`, find both `_h(t,[e,"--daemon"]` and `_h(o?s:i,o?[i,t,"--daemon"]:[t,"--daemon"]` and prepend `"--smol"` to each array.

**Caveat:** these edits live in the plugin cache and will be wiped on the next `claude-mem` plugin upgrade. After an upgrade, re-apply.

For 1–3 sessions, skip this — overhead isn't worth it.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `uvx: command not found` | `uv` not installed | `brew install uv` |
| Excel MCP returns no tools | First run is downloading the package | Wait 30 s on the first invocation — uvx caches after that |
| gbrain MCP doesn't appear | Path in `~/.claude.json` wrong | `which gbrain` and verify the wrapper points to a real binary |
| `bun: command not found` for the wrapper | Bun not on PATH for Claude's environment | Use absolute path `/opt/homebrew/bin/bun` in the wrapper |
| Plugin not showing skills after enabling | Need to restart Claude Code | `pkill -f claude && claude` |
| RAM keeps climbing across sessions | Stale gbrain processes orphaning | `pgrep -af 'gbrain serve'` — if any have PPID 1, kill them; the wrapper's parent-watcher should prevent this going forward |

---

## 9. Ask before running

Read the above, then ask:

1. Are you on Apple Silicon (`/opt/homebrew`) or Intel (`/usr/local`)? Affects the Bun path in the gbrain wrapper.
2. Do you want both **claude-mem** *and* **gbrain**, or just one? They serve different lanes — see §1.1 — and both are recommended. Pick "both" unless you want a lighter footprint.
3. RTK telemetry — leave it disabled (default) or opt in for usage stats? Disabled = nothing leaves your machine. Opt-in = aggregate command counts + version + token-savings totals once per day. Up to you.

Then run Phase 1, verify, proceed to Phase 2, and so on. Don't run the whole script as one blob — confirm each phase.
