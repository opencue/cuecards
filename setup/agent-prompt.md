# The agent-paste install

The install path for people who already have an agent open. Paste the block
below into Claude Code, Codex, Cursor, or any other coding agent and it performs
the install, asking before it touches anything.

This block is inlined verbatim in the README, and
`src/commands/agent-prompt.test.ts` asserts the two copies stay identical. Edit
it here, never there.

```text
Install cue (https://github.com/opencue/cuecards) on this machine and set it up
for this project.

1. Check Node >= 20 with `node --version`. If it's missing or older, stop and tell me.
2. Check whether cue is already installed: `command -v cue`. If it resolves, skip to 4.
3. Ask me before installing anything, then run: `npm install -g cue-ai`
4. Run `cue auto-detect --json`. Show me the profile suggestions it returns and what
   each one is for, and let me pick one — don't choose for me.
5. Run `cue setup --profile <the one I picked> --yes`. That pins the profile and
   installs the shim that makes `claude`/`codex` load it. It will not enable
   telemetry and will not install third-party skills.
6. If it prints PATH guidance, show it verbatim — the shims do nothing until that
   line is added.
7. Report which profile got pinned and whether the shim is active. Mention that
   `install.sh --uninstall` undoes it.

Do not install anything without asking me first.
```

## Why it delegates

Step 4 hands off to `cue setup` rather than listing the steps `cue setup`
performs. The plugin's `/cue-setup` slash command delegates for the same reason:
one description of the install flow, not three that drift apart.

## Per-OS notes

`setup/macos.md`, `setup/linux.md`, and `setup/windows.md` remain for the cases
this block does not cover — Homebrew specifics, WSL2, and PowerShell PATH
handling. The block above is OS-agnostic on purpose and is what the README shows.
