---
description: Browse, search, add, or remove skills in the active cue profile
---

Subcommands (parse from user input after `/cue-skills`):

- **(no args)** or **list**: Run `cue skills list --json` via Bash. Present the result as a grouped markdown table (category | skill | description).

- **search <query>**: Run `cue skills search "<query>" --json` via Bash. Present matches as a numbered list with id, description, and tags. If the user picks one, offer to add it.

- **available**: Run `cue skills available --json` via Bash. Show skills NOT in the current profile, grouped by category.

- **add <id>**: Run `cue skills add-to-profile "<id>"` via Bash. Report success/failure. If the skill has `requires_mcps`, mention which MCPs were auto-added.

- **remove <id>**: Run `cue skills remove-from-profile "<id>"` via Bash. Report success/failure.

After any add/remove, remind the user: "Run `/cue-reload` to apply changes to this session."

If the user just types `/cue-skills` with no args, default to **list**.

Before running any `cue` command, check `command -v cue`. If it exits non-zero,
stop and tell the user: "cue isn't installed yet — run `/cue-setup` first." Do
not surface a raw `command not found`.
