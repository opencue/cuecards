# cue vs Kiro Powers — agent skill system comparison

_Last updated: 2026-05-24_

**Short answer:** [Kiro Powers](https://kiro.dev) is the agent skill system inside Amazon's Kiro IDE — it ships skills and MCP integration as IDE features. [cue](https://github.com/opencue/cuecards) is an IDE-agnostic CLI that brings the same composition model (skills + MCPs + profiles) to Claude Code, Codex, Cursor, Cline, Gemini CLI, GitHub Copilot, and 4 other agents — without locking you to a specific IDE.

Pick **Kiro Powers** if you're already in the Kiro IDE and want the integrated experience. Pick **cue** if you use Claude Code / Codex / Cursor / etc. and want IDE-agnostic profile management.

---

## Feature comparison

| Capability | cue | Kiro Powers |
|---|---|---|
| **Skills** | ✅ | ✅ |
| **MCP servers** | ✅ | ✅ |
| **Claude Code plugins** | ✅ | — |
| **IDE-agnostic** (CLI, works in any terminal) | ✅ | ❌ (Kiro IDE only) |
| **Per-directory automatic profile** | ✅ (`.cue.profile`) | ◐ (workspace-scoped) |
| **Profile inheritance** | ✅ | — |
| **Persona / playbooks / quality gates / evals** | ✅ (5 expert-agent dimensions) | — |
| **Failure-feedback loop** | ✅ (`cue failures --propose`) | — |
| **CLI dependency installer** | ✅ (apt/brew/snap/pipx) | — |
| **SKILL.md linter + GitHub Action** | ✅ | — |
| **Multi-agent across tools** (Cursor, Cline, Copilot, Gemini) | ✅ (10 agents) | Kiro only |
| **Open source, self-hostable** | ✅ (MIT) | ❌ (Kiro-managed) |
| **Daemon required** | ❌ | IDE process |

---

## When to pick each

### Pick Kiro Powers if

- You're already committed to Kiro as your IDE
- You want zero-config integration without learning a CLI
- You don't switch between agents (Claude Code one day, Codex another)
- You don't need to share profiles across team members on different IDEs

### Pick cue if

- You use **Claude Code** or **Codex** or **Cursor** or **Cline** or **Gemini CLI** or **GitHub Copilot** (cue covers all 10 agents)
- Your team uses **different IDEs** but you want the same agent loadout
- You want **per-directory automatic switching** that follows you across IDEs
- You want **persona + playbooks + quality gates** — agent character, not just tools
- You want **open source + MIT-licensed** with no vendor lock-in

---

## Interoperability

cue and Kiro Powers aren't mutually exclusive. cue's `SKILL.md` format follows Anthropic's official spec, which is also what Kiro reads. A skill written for cue works inside Kiro and vice versa. If you use both, cue handles the IDE-agnostic CLI/Claude Code/Codex side, and Kiro handles the IDE-integrated work.

---

## See also

- [cue vs skillport](./cue-vs-skillport.md) — skill-installer comparison
- [cue vs claude-code-switcher](./cue-vs-claude-code-switcher.md) — MCP switcher comparison
- [cue's 10-agent support](../../README.md#agents-cue-supports) — full materialize-to-agent matrix
