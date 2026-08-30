# cue vs claude-code-switcher — Claude Code MCP / config switcher comparison

_Last updated: 2026-05-24_

**Short answer:** `claude-code-switcher` swaps between named MCP configurations — useful if you keep separate sets of MCP servers for different projects. [cue](https://github.com/opencue/cuecards) does that **plus** skills, plugins, rules, commands, hooks, persona, playbooks, quality gates, and evals — a full per-directory agent loadout, not just an MCP set.

Pick **claude-code-switcher** if your only need is "different MCPs per project." Pick **cue** if you also want different skills, plugins, persona, and quality gates per project — without manual switching.

---

## Feature comparison

| Capability | cue | claude-code-switcher |
|---|---|---|
| **MCP server management** | ✅ | ✅ |
| **Skills management** | ✅ | — |
| **Claude Code plugins** | ✅ | — |
| **Per-directory automatic switching** (no manual command) | ✅ (via `.cue.profile`) | ❌ (manual `switch <name>`) |
| **Profile inheritance** | ✅ | ❌ |
| **Persona / playbooks / quality gates** | ✅ | — |
| **CLI dependency installer** | ✅ | — |
| **Failure-feedback loop** | ✅ | — |
| **Multi-agent** (Cursor, Cline, Copilot, Gemini) | ✅ | Claude Code only |
| **Materialized config isolation** | ✅ (per-profile dir) | ⚠ (overwrites `~/.claude/`) |
| **No daemon / background process** | ✅ | ✅ |
| **License** | MIT | varies |

---

## When to pick each

### Pick claude-code-switcher if

- You explicitly want to swap MCP sets and *only* MCP sets, manually
- You don't have skills or plugins you want to scope per-project
- You prefer minimal tooling — one tiny script

### Pick cue if

- You want **automatic switching by directory** instead of running `switch` every time you `cd`
- You want to scope **skills + plugins + hooks + persona**, not just MCPs
- You want your agent to **inherit a common baseline** across projects (claude-mem, common rules, safety hooks) and only diverge where needed
- You want **token-cost reduction** — cue's per-profile isolation cuts always-on context by up to ~16× (verify with `cue cost --compare`)

---

## Migrating from claude-code-switcher to cue

Your existing named configs map to cue profiles:

```bash
# 1. Install cue
npm install -g cue-ai

# 2. For each named config you have, create a matching profile
cue new my-backend       # scaffolds profiles/my-backend/profile.yaml
cue new my-frontend
# ...

# 3. Move your MCP server list into each profile.yaml under mcps:
# (cue resolves MCP IDs against resources/mcps/configs/)

# 4. Pin profiles to directories
cd ~/repos/backend  && echo my-backend  > .cue.profile
cd ~/repos/frontend && echo my-frontend > .cue.profile

# Now `claude` in each repo automatically picks the right loadout — no switch command needed
```

---

## See also

- [cue vs skillport](./cue-vs-skillport.md) — skill-installer comparison
- [cue vs Kiro Powers](./cue-vs-kiro-powers.md) — IDE-locked alternative
- [How profile resolution works](../launch.md) — `.cue.profile` walking + precedence rules
