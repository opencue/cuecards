# cue — Lean install (core + caveman + RTK)

> **For Claude Code (the CLI), not Claude Desktop.** This prompt needs shell access — only Claude Code has that.

The smallest useful cue stack: the **cue CLI**, the **`core` profile** pinned as your default, **caveman** (cavekit plugin for `/caveman` + cue's caveman skills via the `caveman-quick` profile), and **RTK** (Rust Token Killer) for 60–90% shell-output savings. Nothing else — no gbrain, no claude-mem, no Excel/Word MCPs.

Want the full stack (cross-session memory, knowledge brain, Office MCPs)? Use [`linux.md`](./linux.md) / [`macos.md`](./macos.md) / [`windows.md`](./windows.md) instead. This lean path is additive — it doesn't replace them.

---

## What you get

| Layer | What it does | Cost |
|---|---|---|
| **cue CLI** | Resolves which profile applies to your cwd, materializes a per-profile `CLAUDE_CONFIG_DIR`, exec's the real `claude`. | ~0, pure CLI |
| **`core` profile** (default) | Baseline persona + Integrity Protocol every cue profile inherits. | bundled |
| **caveman skills** (via `caveman-quick`) | `caveman-compress`, `caveman-review`, `caveman-help`, `entroly` — low-context speed mode. | bundled |
| **cavekit plugin** | `/caveman` shrinks Claude's replies; `/caveman-commit` writes Conventional Commit messages. | ~5 MB |
| **RTK** (CLI hook) | Filters command outputs before Claude sees them — `ls`/`cat`/`git`/tests get 60–90% smaller. | ~15 MB binary |

After this, `claude` in any directory launches through cue with the `core+caveman-quick` composite and RTK trimming every Bash result.

---

## Prerequisites (all OSes)

- **git** and **bun** (https://bun.sh) — cue is a bun CLI installed from a git clone.
- **Claude Code** itself (https://claude.ai/install.sh, or `npm install -g @anthropic-ai/claude-code`).

Native Windows PowerShell can't run cue's bash installer or shims — on Windows, install cue **inside WSL2** and follow the **Linux** section below. The PowerShell block in §3 only covers RTK, which does run natively.

---

## 1. Linux

```bash
# 1a. Prereqs: git + bun (skip either if already present)
command -v git >/dev/null || { echo "install git first"; exit 1; }
[ -x "$(command -v bun)" ] || curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"

# 1b. Install the cue CLI (clone + symlink claude shim through cue)
curl -fsSL https://raw.githubusercontent.com/opencue/cuecards/main/get.sh | bash -s -- --yes

# 1c. RTK — Rust Token Killer
if ! command -v rtk >/dev/null; then
  curl -fsSL https://github.com/rtk-ai/rtk/releases/latest/download/rtk-x86_64-unknown-linux-gnu.tar.gz \
    | tar xz -C /tmp && sudo install /tmp/rtk /usr/local/bin/rtk
fi
rtk init -g   # writes the Claude Code hook

# verify:
cue --version && rtk --version
```

Then jump to **§4 — pin core + caveman** (shared across OSes).

---

## 2. macOS

```bash
# 2a. Prereqs: git + bun via Homebrew
command -v brew >/dev/null || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install git bun rtk
export PATH="$HOME/.local/bin:$PATH"

# 2b. Install the cue CLI
curl -fsSL https://raw.githubusercontent.com/opencue/cuecards/main/get.sh | bash -s -- --yes

# 2c. RTK hook (binary already installed via brew above)
rtk init -g

# verify:
cue --version && rtk --version
```

Then jump to **§4 — pin core + caveman** (shared across OSes).

---

## 3. Windows

cue's installer and shims are bash; native PowerShell can't run them. **Use WSL2:** open your WSL distro and run the **§1 Linux** block inside it. cue, the shims, and RTK all live in the Linux userland.

RTK *can* run natively if you also want Bash-tool trimming from a non-WSL Claude Code. In PowerShell:

```powershell
$rtkUrl = "https://github.com/rtk-ai/rtk/releases/latest/download/rtk-x86_64-pc-windows-msvc.zip"
Invoke-WebRequest -Uri $rtkUrl -OutFile "$env:TEMP\rtk.zip"
Expand-Archive -Path "$env:TEMP\rtk.zip" -DestinationPath "$env:USERPROFILE\.local\bin" -Force
rtk init -g
rtk --version
```

For cue itself, do everything else in WSL2 via §1.

---

## 4. Pin `core` + caveman (shared — run after your OS section)

cue reads `~/.config/cue/default-profile` (one profile name per line; `core` is always implied). The composite `core+caveman-quick` gives you the core baseline plus caveman's speed-mode skills.

```bash
# 4a. Set the default profile composite
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/cue"
printf 'core\ncaveman-quick\n' > "${XDG_CONFIG_HOME:-$HOME/.config}/cue/default-profile"

# verify the composite resolves:
cue current

# (Per-project override instead of global: drop a .cue.profile file in the repo)
#   echo core > .cue.profile
```

`cue init` is the interactive alternative — it walks you through the same default-profile + analytics choice.

---

## 5. Enable the caveman plugin (inside Claude Code)

The cue skills cover compress/review/help; the **cavekit plugin** adds the `/caveman` and `/caveman-commit` slash commands. Add the marketplace from inside a Claude Code session:

```
/plugin marketplace add cavekit-marketplace
```

Then enable it (restart Claude Code afterward so it registers):

```bash
python3 - <<'PY'
import json, pathlib, os
p = pathlib.Path(os.path.expanduser('~/.claude/settings.json'))
d = json.loads(p.read_text()) if p.exists() else {}
d.setdefault('enabledPlugins', {})['cavekit@cavekit-marketplace'] = True
p.write_text(json.dumps(d, indent=2))
print('cavekit enabled')
PY
```

---

## 6. Verify the whole stack

```bash
cue --version                 # cue CLI on PATH
cue current                   # shows core+caveman-quick (or core in a repo with no .cue.profile)
rtk --version && rtk gain     # RTK installed; gain shows savings once you use it
cat ~/.claude/settings.json   # enabledPlugins has cavekit@cavekit-marketplace: true
```

Open Claude Code in any directory — `claude` routes through cue, loads `core+caveman-quick`, and RTK trims every Bash output. Try `/caveman` to confirm the plugin fired.

---

## 7. Ask before running

Read the above, then ask:

1. **OS / shell?** Linux, macOS, or Windows-via-WSL2 — picks §1 / §2 / §3.
2. **Global or per-project default?** §4 writes a global `default-profile`; if you'd rather pin per-repo, use `.cue.profile` instead and skip 4a.
3. **RTK telemetry** — leave disabled (default) or opt in? Disabled = nothing leaves your machine (`rtk telemetry status` to confirm).

Run one section at a time, verify, then move on — don't paste the whole file as one blob.
