---
description: List, add, remove, or health-check MCP servers in the active cue profile
---

Subcommands (parse from user input after `/cue-mcps`):

- **(no args)** or **list**: Run `cue mcps list --json` via Bash. Present as a table: id | status | description.

- **available**: Run `cue mcps available --json` via Bash. Show MCPs NOT in the current profile.

- **add <id>**: Run `cue mcps add "<id>"` via Bash. Report success. Remind user that MCP changes require a restart: "Run `/cue-reload` to restart with the new MCP."

- **remove <id>**: Run `cue mcps remove "<id>"` via Bash. Report success. Same restart reminder.

- **health**: Run `cue mcps health --json` via Bash. Present as a table: id | status (✅/❌) | latency.

If the user just types `/cue-mcps` with no args, default to **list**.

Before running any `cue` command, check `command -v cue`. If it exits non-zero,
stop and tell the user: "cue isn't installed yet — run `/cue-setup` first." Do
not surface a raw `command not found`.
