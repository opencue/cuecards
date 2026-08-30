# How cue compares — feature matrix (text mirror of `docs/assets/comparison.svg`)

This is the machine-readable mirror of the comparison diagram in the README. The columns are the seven capabilities cue covers; the rows are tools that touch some subset of the same problem.

Legend: `yes` = supported · `partial` = partial / IDE-locked · `no` = not in scope.

| Tool | skills | MCPs | plugins | profiles | per-directory | isolation | inheritance | one-line summary |
|---|---|---|---|---|---|---|---|---|
| **cue** | yes | yes | yes | yes | yes | yes | yes | The only tool covering all seven dimensions. |
| claude-code-switcher | no | yes | no | partial | no | no | no | MCP config + auth switcher. |
| skillport | yes | no | no | no | no | no | no | Serves skills to any agent via CLI/MCP. |
| agent-skills-cli | yes | no | no | no | no | no | no | Browses 40k+ skills from SkillsMP. |
| agent-skill-manager | yes | no | no | no | no | no | no | PyPI installer for AI agent skills. |
| skillshub | yes | no | no | no | no | no | no | "Homebrew for AI Agent Skills." |
| add-skills | yes | no | no | no | no | no | no | Python CLI to add/remove skills. |
| Kiro Powers | yes | yes | no | no | partial | no | no | Context-aware MCPs inside Kiro IDE only. |

## Where cue is the only one

1. `.cue.profile` per-directory pinning — `cd` into a repo, the right loadout loads automatically.
2. Materialized isolation — builds a real `CLAUDE_CONFIG_DIR` per profile, not just a config swap.
3. Hash-cached rebuilds — content-addressed sha256 check, <5 ms when unchanged.
4. Three dimensions as one unit — skills + MCPs + plugins composed together. Others manage one at a time.
5. Inheritance with merge semantics — `core → backend → medusa-dev` chains; child overrides parent cleanly.
6. Shim-based interception — type `claude` like always. The right environment just shows up.
7. No daemon — pure CLI, no background process, nothing to monitor.
8. `cue optimizer` dashboard — visual audit of every profile's loadout, install status, and per-skill usage scanned from your actual session transcripts.
