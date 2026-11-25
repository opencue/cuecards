# Cue and related tools

**Cue picks what Claude Code or Codex starts with in the current directory.**
The tools below can instead find a skill, sync agent files, install a kit, or
switch a provider. Some do more than one.

## Feature comparison

The cells describe how each tool handles an asset. **—** means it is not
covered in the linked workflow, not that the tool cannot handle it. The MCP
column covers finding, configuring, or testing servers, not whether the tool
itself offers an MCP API.

| Project | Skills | MCP servers | Rules / prompts | Profiles / kits | Key difference |
| --- | --- | --- | --- | --- | --- |
| **[Cue](launch.md)** | Find, install, load | Find, load, health check | Distribute | Project launch profiles | Builds the profile runtime, then starts Claude Code or Codex. |
| [HarnessKit](https://github.com/RealZST/HarnessKit#-kits) | Bundle | Bundle | Bundle | Portable kits | Installs a bundle that can include memory files. |
| [Rulesync](https://github.com/dyoshikawa/rulesync) | Generate | Generate | Generate | — | Writes native config from one source and can check for drift. |
| [Ruler](https://github.com/intellectronica/ruler) | Distribute (experimental) | Distribute | Distribute | — | Applies shared repository instructions, including nested rules. |
| [Agent Layer](https://github.com/conn-castle/agent-layer) | Share | Generate | Generate | — | Tracks the project files it generates. |
| [Caliber](https://github.com/caliber-ai-org/ai-setup) | Sync | Sync | Sync | — | Mirrors resources between agent clients. |
| [Vercel Skills](https://github.com/vercel-labs/skills) | Find, install | — | — | — | CLI for the skills.sh catalog and repository installs. |
| [MCP Registry](https://github.com/modelcontextprotocol/registry) | — | Publish, find | — | — | Public directory of server releases, not an installer. |
| [MCP Inspector](https://github.com/modelcontextprotocol/inspector) | — | Test, debug | — | — | Interactively inspects a running server's tools and responses. |
| [Agentic Awesome Skills](https://github.com/sickn33/agentic-awesome-skills) | Browse catalog | — | — | Skill groupings | Curated collection with a searchable local catalog. |
| [Skillshare](https://github.com/runkids/skillshare) | Sync | Sync | Sync as extras | Project libraries | Keeps a shared library in sync across clients. |
| [skills-sync](https://github.com/ryanreh99/skills-sync) | Import, sync | Sync | — | Workspace profiles | Keeps source locks for workspace imports. |
| [Skills Manager](https://github.com/xingkongliang/skills-manager) | Manage, update | — | — | Skill presets | Desktop library with agent and project workspaces. |
| [CC Switch](https://github.com/farion1231/cc-switch) | Find, install, sync | Sync | Prompt presets | Provider presets | Desktop app for switching API providers. |
| [claude-profiles](https://github.com/julianleopold/claude-profiles) | — | Switch settings | — | Claude configs | Swaps saved files in `~/.claude`. |
| [claude-code-profiles](https://github.com/quinnjr/claude-code-profiles) | Share, link | — | — | Directory-based Claude configs | Points Claude Code at a different config directory. |

## Use them together

- **Skills:** [search skills.sh from Cue](skill-and-rule-integrations.md#find-a-skill-on-skillssh),
  review the source, then decide whether the skill belongs in a Cue profile.
- **MCP:** [search the official registry from Cue](skill-and-rule-integrations.md#find-an-mcp-server-in-the-official-registry),
  then review the server before adding it to a profile.
- **Rules:** [preview or check Rulesync from Cue](skill-and-rule-integrations.md#preview-or-check-a-rulesync-project).
  Let only one tool own each generated file.
- **Kits:** installing a kit and choosing a launch-time profile are different
  steps. Cue does not import HarnessKit kits.
