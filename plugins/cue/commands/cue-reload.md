---
description: Rematerialize the active cue profile and restart claude with updated config
---

Steps:
1. Run `cue launch --rematerialize` via Bash. This force-rebuilds the runtime directory for the current profile (ignoring the hash cache), picking up any skill/MCP/CLAUDE.md changes.
2. Report what the command outputs (it prints what changed: skills added/removed, MCPs changed, etc.).
3. Then run `exec ~/.config/cue/shims/claude` via Bash to restart with the fresh config.

If `~/.config/cue/shims/claude` does not exist, print: "shim not installed — run `/cue-setup` first."

Note: MCP server connection changes require the full restart. Skill and CLAUDE.md changes take effect immediately after rematerialization without restart, but restarting ensures a clean state.

Before running any `cue` command, check `command -v cue`. If it exits non-zero,
stop and tell the user: "cue isn't installed yet — run `/cue-setup` first." Do
not surface a raw `command not found`.
