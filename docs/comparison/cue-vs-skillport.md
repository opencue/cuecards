# cue vs skillport — Claude Code skill manager comparison

_Last updated: 2026-05-24_

**Short answer:** [skillport](https://github.com/search?q=skillport) is a skill installer — it pulls SKILL.md files from a registry into your `~/.claude/skills/` directory. [cue](https://github.com/opencue/cuecards) is an agent profile manager — it scopes skills + MCPs + plugins + persona + playbooks + quality gates per-directory, with inheritance, materialized isolation, and a failure-feedback loop.

Pick **skillport** if you want a Homebrew-for-Claude-Code skill index. Pick **cue** if you want per-project agent loadouts that compose into expert agents.

---

## Feature comparison

| Capability | cue | skillport |
|---|---|---|
| **Skills install** | ✅ | ✅ |
| **MCP server management** | ✅ | — |
| **Claude Code plugin management** | ✅ | — |
| **Per-directory profile pinning** (`.cue.profile`) | ✅ | — |
| **Profile inheritance** (`core → backend → medusa-dev`) | ✅ | — |
| **Materialized config isolation** (per-profile `CLAUDE_CONFIG_DIR`) | ✅ | — (writes globally to `~/.claude/`) |
| **Persona** (defines who the agent IS) | ✅ | — |
| **Playbooks** (proven step-by-step protocols) | ✅ | — |
| **Quality gates** (Stop-hook validators) | ✅ | — |
| **Structural evals** (`cue eval-behavior`) | ✅ | — |
| **Failure-feedback loop** (`cue failures --propose`) | ✅ | — |
| **SKILL.md spec linter** (R001-R008) | ✅ | — |
| **CLI dependency installer** (apt/brew/snap/pipx) | ✅ | — |
| **GitHub Code Search–powered discovery** | ✅ | ❓ |
| **Outbound PR flow** (with throttle + opt-out) | ✅ | — |
| **Multi-agent** (Cursor, Cline, Copilot, Gemini, etc.) | ✅ (10 agents) | Claude Code only |
| **Token cost reduction** | up to ~16× via isolation (`cue cost --compare`) | None (skills loaded globally) |

---

## When to pick each

### Pick skillport if

- You want a single global skill library and don't care about per-project isolation
- You're a solo developer with one project type
- You don't need MCP server, plugin, or hook management

### Pick cue if

- You work on multiple projects with different domains (backend repo + frontend repo + marketing site)
- You want different agent loadouts per directory (cybersecurity here, marketing there)
- You care about per-message token cost — every skill loaded globally adds ~$0.10–$0.30/session
- You use multiple coding agents (Cursor at work, Claude Code at home, Codex in CI)
- You want your agents to follow protocols + meet quality bars, not just have tools

---

## Migrating from skillport to cue

If you already use skillport, your existing `~/.claude/skills/` directory survives — cue's resolver looks there too. To bring those skills under cue's profile system:

```bash
# 1. Install cue
npm install -g cue-ai

# 2. Scaffold a profile from what's already installed
cue init   # scans ~/.claude/skills/ + your repo, suggests a profile

# 3. Pin the profile to your project
cd ~/projects/my-repo
echo my-profile > .cue.profile

# 4. Test
claude   # boots with just my-profile's skills, instead of all of them
```

You don't lose access to the global skills — they're still there. cue just scopes which ones are loaded per directory.

---

## See also

- [cue vs claude-code-switcher](./cue-vs-claude-code-switcher.md) — MCP-only switcher comparison
- [cue vs Kiro Powers](./cue-vs-kiro-powers.md) — IDE-locked alternative
- [Full feature matrix](../../README.md#how-cue-compares) — cue vs 7 alternatives at once
- [How cue works](../launch.md) — resolve → materialize → exec flow
