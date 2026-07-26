---
description: Show the active cue profile and its resolved capability list
---

Run `cue current` and present the output verbatim, formatted as:

- Profile: <name>
- Skills: <count>
- MCPs: <count>
- Plugins: <count>
- Runtime dir: <path>

Before running any `cue` command, check `command -v cue`. If it exits non-zero,
stop and tell the user: "cue isn't installed yet — run `/cue-setup` first." Do
not surface a raw `command not found`.
