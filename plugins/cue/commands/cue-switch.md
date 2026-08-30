---
description: Switch the cwd to a specific cue profile (no picker)
arguments:
  - name: profile
    description: Profile name (or list number from /cue current)
---

Validate that `{{profile}}` matches a name returned by `cue list --json`. If valid, write it to `./.cue.profile`. If not, surface the error and suggest `/cue` to pick from a list.

Before running any `cue` command, check `command -v cue`. If it exits non-zero,
stop and tell the user: "cue isn't installed yet — run `/cue-setup` first." Do
not surface a raw `command not found`.
