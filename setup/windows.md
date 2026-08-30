# cue — Claude Code Lean Setup (Windows)

> **For Claude Code (the CLI), not Claude Desktop.** This prompt needs shell access — only Claude Code has that. On Windows you have two options: **native PowerShell** (this file) or **WSL2** (use [setup/linux.md](./linux.md) inside WSL).

Self-contained setup prompt for Windows 10/11. Paste this entire file into your first Claude Code message in a fresh PowerShell, answer the three questions in §9, and the assistant walks through the install one phase at a time.

---

### Easiest Windows path (recommended)

Open **PowerShell** (Win → "PowerShell" → Enter). If you've never run remote scripts, first run:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Then paste this whole block in:

```powershell
# 1. winget — comes pre-installed on Windows 11 and recent Windows 10. If missing:
#    https://learn.microsoft.com/windows/package-manager/winget/

# 2. Core tools (Node, Python, jq, git)
winget install --id OpenJS.NodeJS.LTS         --silent --accept-source-agreements --accept-package-agreements
winget install --id Python.Python.3.12         --silent --accept-source-agreements --accept-package-agreements
winget install --id stedolan.jq                --silent --accept-source-agreements --accept-package-agreements
winget install --id Git.Git                    --silent --accept-source-agreements --accept-package-agreements

# refresh PATH for this session so the next steps see node/python
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# 3. Bun (JS runtime for gbrain)
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    irm bun.sh/install.ps1 | iex
}

# 4. uv (Python venv manager for Excel/Word MCPs)
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    irm https://astral.sh/uv/install.ps1 | iex
}

# 5. RTK (Rust Token Killer) — 60-90% shell-output savings
if (-not (Get-Command rtk -ErrorAction SilentlyContinue)) {
    $rtkUrl = "https://github.com/rtk-ai/rtk/releases/latest/download/rtk-x86_64-pc-windows-msvc.zip"
    $tmp = "$env:TEMP\rtk.zip"
    Invoke-WebRequest -Uri $rtkUrl -OutFile $tmp
    Expand-Archive -Path $tmp -DestinationPath "$env:USERPROFILE\.local\bin" -Force
    [System.Environment]::SetEnvironmentVariable("Path", "$env:USERPROFILE\.local\bin;" + [System.Environment]::GetEnvironmentVariable("Path","User"), "User")
}

# 6. Claude Code itself (via npm — easiest on Windows)
npm install -g @anthropic-ai/claude-code

# 7. Wire RTK into Claude Code
rtk init -g

# 8. Done. Now open Claude Code in any directory:
Write-Host "Setup complete. Run:  claude"
```

That installs everything except the MCPs and plugins — those need Claude Code to be running, because they're configured *via* Claude Code. Step 8 ends with a `claude` prompt; once in there, paste **this entire file** as your first message and the assistant will handle the rest interactively.

### Long-form prereq options

| Your machine has | Use |
|---|---|
| Bare Windows 11 | The block above. Uses winget for everything. |
| WSL2 already + prefer Linux feel | Use [setup/linux.md](./linux.md) inside your WSL distro instead. Cleaner. |
| Node/npm already | Skip the `winget install OpenJS.NodeJS.LTS` line and `npm install -g @anthropic-ai/claude-code` directly |
| Scoop / Chocolatey user | `scoop install nodejs python bun uv jq` (or choco equivalents) then continue from step 5 |

**Then:** open PowerShell → `claude` → paste this whole file as your first message. Claude Code reads it, asks the 3 questions in §9, and executes the remaining bootstrap phases.

## TL;DR

Same lean stack as macOS/Linux:
- **Cross-session memory** via `claude-mem` plugin
- **Token compression** via `caveman` plugin
- **Persistent knowledge brain** via `gbrain` MCP
- **RTK** for 60-90% shell-output token savings
- **Excel + Word MCPs** for native `.xlsx` / `.docx` work

---

## 1. What you'll have after bootstrap

| Layer | What it does | Disk | Per-session RAM |
|---|---|---|---|
| **claude-mem** (plugin) | Captures session observations; future sessions search them with `mem-search`. | ~25 MB | ~120 MB worker daemon |
| **caveman** (plugin) | `/caveman` shrinks Claude's replies. `/caveman-commit` writes Conventional Commit messages. | ~5 MB | none |
| **RTK** (CLI hook) | Filters command outputs before Claude sees them. | ~15 MB | none |
| **gbrain** (MCP server) | Personal knowledge brain (PGLite + embeddings). | ~50 MB DB | ~250 MB |
| **excel-mcp-server** (MCP) | Read/write/format `.xlsx`. github.com/haris-musa/excel-mcp-server | ~50 MB | ~100 MB |
| **office-word-mcp-server** (MCP) | Read/write `.docx`. github.com/GongRzhe/Office-Word-MCP-Server | ~30 MB | ~80 MB |

Total cold footprint per Claude session: ~550 MB.

### 1.1 claude-mem vs gbrain — use both

Same as the macOS/Linux setup. claude-mem captures passively; gbrain is your manually-curated wiki.

---

## 2. MCP servers — gbrain + Excel + Word

These three MCP servers get configured in `%USERPROFILE%\.claude.json` under `mcpServers`. We'll write them automatically in §5.

```jsonc
{
  "mcpServers": {
    "gbrain": {
      "command": "C:\\Users\\<you>\\.local\\bin\\gbrain-mcp-wrapper.cmd"
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

Bun-based MCPs leak RAM if Claude Code exits abruptly. The Windows wrapper is a `.cmd` script that:

1. Sets `BUN_SMOL=1` so gbrain runs with aggressive GC
2. Uses `taskkill` on parent-PID death to clean up orphans

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

```powershell
$rtkUrl = "https://github.com/rtk-ai/rtk/releases/latest/download/rtk-x86_64-pc-windows-msvc.zip"
Invoke-WebRequest -Uri $rtkUrl -OutFile "$env:TEMP\rtk.zip"
Expand-Archive -Path "$env:TEMP\rtk.zip" -DestinationPath "$env:USERPROFILE\.local\bin" -Force
rtk init -g
# verify:
rtk --version
```

**Caveats** — Only hooks **Bash** tool calls (works through PowerShell when Claude Code spawns commands). Telemetry **opt-in only**. Restart Claude Code after `rtk init -g`. The URL above is **x86_64** (Windows on ARM runs it under emulation); if you want a native build, check the [RTK releases page](https://github.com/rtk-ai/rtk/releases).

---

## 4. Memory tuning — only if you run multiple sessions

Windows has its own compressed memory (Memory Compression service). **Skip this section unless you run 3+ Claude Code panes at once.** If you do:

- Close idle Claude sessions you're not using. Each pins ~500 MB.
- The optional claude-mem `--smol` patch (§7) cuts the worker daemon from ~120 MB → ~85 MB.

---

## 5. Bootstrap commands

After you confirm, the assistant runs these one phase at a time.

```powershell
# Phase 1: prereqs (skip if you already ran the easiest-path block)
winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
winget install --id Python.Python.3.12 --silent --accept-source-agreements --accept-package-agreements
winget install --id stedolan.jq --silent --accept-source-agreements --accept-package-agreements
winget install --id Git.Git --silent --accept-source-agreements --accept-package-agreements
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { irm bun.sh/install.ps1 | iex }
if (-not (Get-Command uv  -ErrorAction SilentlyContinue)) { irm https://astral.sh/uv/install.ps1 | iex }
# verify:
bun --version; node --version; uv --version

# Phase 2: install Claude Code + wire RTK hook
npm install -g @anthropic-ai/claude-code
rtk init -g
# verify:
claude --version

# Phase 3: install gbrain
bun install -g gbrain
gbrain init --pglite
# verify:
gbrain doctor --fast

# Phase 4: gbrain MCP wrapper (.cmd for Windows)
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.local\bin" | Out-Null
@'
@echo off
setlocal
set GBRAIN_HOME=%USERPROFILE%\.gbrain
set BUN_SMOL=1
rem Parent-PID watcher in background — closes gbrain if Claude exits
start /B "" cmd /c "((tasklist /FI ""PID eq %~3"" | findstr /R /C:""%~3"" >NUL) || (taskkill /F /PID %1 2>NUL)) & timeout /T 10 /NOBREAK >NUL"
bun --smol "%USERPROFILE%\.bun\install\global\node_modules\gbrain\bin\gbrain" serve 2>"%TEMP%\gbrain-mcp.stderr"
'@ | Out-File -Encoding ASCII "$env:USERPROFILE\.local\bin\gbrain-mcp-wrapper.cmd"
# verify:
Test-Path "$env:USERPROFILE\.local\bin\gbrain-mcp-wrapper.cmd"

# Phase 5: register MCP servers in ~/.claude.json
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.claude" | Out-Null
python -c @"
import json, pathlib, os
p = pathlib.Path(os.path.expanduser('~/.claude.json'))
d = json.loads(p.read_text()) if p.exists() else {}
d.setdefault('mcpServers', {}).update({
    'gbrain': {'command': os.path.expanduser('~') + r'\.local\bin\gbrain-mcp-wrapper.cmd'},
    'excel':  {'command': 'uvx', 'args': ['excel-mcp-server', 'stdio']},
    'word':   {'command': 'uvx', 'args': ['--from', 'office-word-mcp-server', 'word_mcp_server']},
})
p.write_text(json.dumps(d, indent=2))
print('mcpServers registered: gbrain, excel, word')
"@

# Phase 6: add plugin marketplaces (interactive). Run these INSIDE Claude Code:
#   /plugin marketplace add thedotmack
#   /plugin marketplace add cavekit-marketplace
# Then in PowerShell, enable them:
python -c @"
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
"@

# Phase 7: token-effective CLAUDE.md defaults
@'
# Claude Code Local Instructions

Response style: terse, act-first, no preambles, no trailing summaries.

Minimal safe mode:
- Don't start MCP servers, plugins, or hooks unless explicitly asked.
- Prefer direct local work over orchestration.
- Ask before network access, destructive actions, or long-running background commands.

Excel/Word:
- Use mcp__excel__* tools for .xlsx; mcp__word__* for .docx.
- Confirm the file path with the user before overwriting an existing document.
'@ | Out-File -Encoding UTF8 "$env:USERPROFILE\.claude\CLAUDE.md"

# Phase 8: final verification
claude --version
(Get-ChildItem "$env:USERPROFILE\.claude\skills" -ErrorAction SilentlyContinue).Count
Write-Host "Done. Open Claude Code: 'claude' — your MCPs and plugins are wired up."
```

---

## 6. Token-effective conventions

Same as the other OSes — `/caveman`, `/caveman-commit`, let claude-mem capture passively, one Claude Code window at a time.

---

## 7. Optional: claude-mem `--smol` patch

If you run **4+ Claude Code sessions concurrently**, apply this after `/plugin install` fetches the plugin. Plugin cache lives at `%USERPROFILE%\.claude\plugins\cache\thedotmack\claude-mem\`. Edit the same three JS/CJS files described in [setup/macos.md §7](./macos.md). Re-apply after upgrades.

---

## 7.5 Profile hooks — WSL2 only

The hook scripts shipped with cue's bundled profiles (`bash-quality-preflight`,
`secrets-guard`, `session-summary`, `commit-message-guard`) are POSIX shell
scripts that call `python3`. They run when Claude Code spawns them at
PreToolUse/Stop events.

- **Inside WSL2**: they work — every distro has `bash` and `python3`.
- **Native PowerShell**: Claude Code will try to run `bash …/hooks/*.sh`. If
  no `bash` is on PATH the hook silently fails (Claude Code logs the exit
  code but the model isn't notified), so the **safety guards do not protect
  the agent on native PowerShell**.

If you're on native PowerShell and want the guards, either:
1. Run cue inside WSL2 (recommended — single setup for everything), or
2. Install Git for Windows (ships `bash.exe`) and add it to PATH so the hook
   shebang resolves, plus install Python 3 from the Microsoft Store.

A future cue release may ship `.ps1` equivalents; for now, WSL2 is the
sanctioned path.

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `uvx: command not found` | `uv` install didn't persist PATH | Open a fresh PowerShell; or `$env:Path += ";$env:USERPROFILE\.local\bin"` |
| Excel MCP returns no tools | First run is downloading the package | Wait 30 s — uvx caches after that |
| gbrain MCP doesn't appear | Path in `~/.claude.json` wrong | Verify `$env:USERPROFILE\.local\bin\gbrain-mcp-wrapper.cmd` exists |
| `bun: command not found` for the wrapper | Bun not on PATH for Claude's env | Use absolute path `$env:USERPROFILE\.bun\bin\bun.exe` in the wrapper |
| Plugin not showing skills after enabling | Need to restart Claude Code | Close all Claude Code windows, open new one |
| `Set-ExecutionPolicy` errors | Running PowerShell as restricted | `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` |
| Antivirus quarantines RTK | False positive on Rust binary | Add `$env:USERPROFILE\.local\bin\rtk.exe` to AV exceptions |

---

## 9. Ask before running

Read the above, then ask:

1. Native PowerShell or WSL2? If WSL2, switch to `setup/linux.md` inside the WSL distro instead.
2. Do you want both **claude-mem** *and* **gbrain**, or just one? Both recommended.
3. RTK telemetry — leave disabled (default) or opt in for usage stats?

Then run Phase 1, verify, proceed to Phase 2, and so on. Don't run the whole script as one blob — confirm each phase.
