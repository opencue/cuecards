---
description: Run cue CLI commands — discover skills, evolve profiles, manage your agent loadout.
argument-hint: <subcommand> [args]
---

# /cue — Agent Profile Manager

Run cue commands directly from Claude Code. This is the in-session interface to the cue CLI.

## Available Subcommands

| Command | What it does |
|---------|-------------|
| `/cue discover` | Search GitHub for hidden gem skills |
| `/cue discover --profile <name>` | Find gems for a specific profile |
| `/cue discover install --min-score 8` | Install top gems into profiles |
| `/cue discover mcps` | Find MCP servers to add |
| `/cue evolve` | Scan sessions, detect gaps, propose skill changes |
| `/cue evolve --apply` | Apply proposed changes |
| `/cue evolve --history` | Show profile evolution log |
| `/cue use <profile>` | Switch to a different profile |
| `/cue list` | Show all available profiles |
| `/cue current` | Show active profile and its skills |
| `/cue optimizer` | Audit skills, MCPs, CLIs per profile |
| `/cue cost` | Token budget for active profile |
| `/cue cli list` | Show CLIs needed by current profile |
| `/cue cli install --all --yes` | Install all missing CLIs |

## How to Execute

Run the cue CLI command in the shell. The binary is at `~/Documents/cue/bin/cue` or available as `cue` if installed globally.

```bash
# Always use this pattern:
bun run ~/Documents/cue/src/index.ts <subcommand> [args]
```

## Examples

### Discover skills for the current profile
```bash
bun run ~/Documents/cue/src/index.ts discover search --profile backend --limit 10
```

### Evolve the current profile
```bash
bun run ~/Documents/cue/src/index.ts evolve
```

### Install a discovered gem
```bash
bun run ~/Documents/cue/src/index.ts discover install --min-score 10 --dry-run
```

### Switch profile
```bash
bun run ~/Documents/cue/src/index.ts use backend
```

### Check what's loaded
```bash
bun run ~/Documents/cue/src/index.ts current
```

## Notes

- Always show the user what you're about to run before executing
- For `discover install`, default to `--dry-run` first and ask before applying
- For `evolve --apply`, show the proposal first and confirm
- The active profile is determined by `.cue.profile` in the current directory
