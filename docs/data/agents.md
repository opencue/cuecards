# Agents cue supports — adapter matrix

Mirror of the table in the README's "Agents cue supports" section. The same `profile.yaml` materializes into each agent's native config format.

| Agent | `cue materialize` command | Output paths |
|---|---|---|
| Claude Code | (default — uses shim) | `~/.config/cue/runtime/<profile>/claude/` |
| OpenAI Codex | (default — uses shim) | `~/.config/cue/runtime/<profile>/codex/` |
| Cursor | `cue materialize cursor` | `.cursorrules` · `.cursor/mcp.json` |
| Cline | `cue materialize cline` | `.clinerules` · `cline_mcp_settings.json` |
| Google Gemini CLI | `cue materialize gemini` | `~/.gemini/skills/*.md` |
| Antigravity CLI | `cue materialize antigravity` | `~/.gemini/antigravity-cli/skills/<name>/SKILL.md` · `~/.gemini/config/mcp_config.json` (or project `.agents/`) |
| GitHub Copilot | `cue materialize copilot` | `.github/copilot-instructions.md` |
| Windsurf | `cue materialize windsurf` | `.windsurfrules` · `.windsurf/mcp.json` |
| Roo Code | `cue materialize roo` | `.roo/rules/*.md` · `.roo/mcp.json` |
| Sourcegraph Amp | `cue materialize amp` | `AGENTS.md` · `.amp/mcp.json` |
| Aider | `cue materialize aider` | `.aider.conventions.md` |

Common flags: `--all` (every agent in this profile), `--profile <name>`, `--dir <path>`, `--dry-run`.

Source: [`src/commands/materialize.ts`](../../src/commands/materialize.ts).
