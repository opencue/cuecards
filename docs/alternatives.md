# Cue and related tools

Cue answers **what should this coding agent start with in this directory?** It
resolves a profile at launch and runs the existing Claude Code or Codex binary
against that profile's runtime. See [the launch flow](launch.md).

These tools solve adjacent problems. Pick by the job you want done, not by the
number of boxes ticked in a feature matrix.

## Find or share skills

| Project | Reach for it when you want to… |
| --- | --- |
| [Vercel Skills](https://github.com/vercel-labs/skills) | Search the skills.sh catalog and install skills from a repository. |
| [Agentic Awesome Skills](https://github.com/sickn33/agentic-awesome-skills) | Browse a large catalog of ready-made skills. |
| [Skillshare](https://github.com/runkids/skillshare) | Keep a shared skill library in sync across several agent clients. |
| [skills-sync](https://github.com/ryanreh99/skills-sync) | Import and manage shared skills and MCP configuration for development setups. |
| [Skills Manager](https://github.com/xingkongliang/skills-manager) | Manage and update local skills from a desktop UI. |

## Distribute project configuration

| Project | Reach for it when you want to… |
| --- | --- |
| [HarnessKit](https://github.com/RealZST/HarnessKit#-kits) | Install or distribute a portable kit of project assets such as skills, rules, and MCP configuration. |
| [Rulesync](https://github.com/dyoshikawa/rulesync) | Generate several agents' native configuration files from one project source and check for drift. |
| [Ruler](https://github.com/intellectronica/ruler) | Publish one set of repository instructions to several coding agents. |
| [Agent Layer](https://github.com/conn-castle/agent-layer) | Maintain shared, project-local agent configuration with tracked generated files. |
| [Caliber](https://github.com/caliber-ai-org/ai-setup) | Keep rules, skills, and MCP config synchronized between agent clients. |

## Switch providers or existing profiles

| Project | Reach for it when you want to… |
| --- | --- |
| [CC Switch](https://github.com/farion1231/cc-switch) | Switch providers and manage client settings from a desktop app. |
| [claude-profiles](https://github.com/julianleopold/claude-profiles) | Switch between saved Claude Code configurations. |
| [claude-code-profiles](https://github.com/quinnjr/claude-code-profiles) | Use separate Claude Code configurations, including directory-based selection. |

## Use them together

- **Skills:** [search skills.sh from Cue](skill-and-rule-integrations.md#find-a-skill-on-skillssh),
  review the source, then decide whether the skill belongs in a Cue profile.
- **Rules:** [preview or check Rulesync from Cue](skill-and-rule-integrations.md#preview-or-check-a-rulesync-project).
  Let only one tool own each generated file.
- **Kits:** installing a kit and choosing a launch-time profile are different
  steps. Cue does not import HarnessKit kits.
