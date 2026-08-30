# awesome-list submissions

Highest ROI of any growth task. Each PR is durable inbound traffic for years.

## Target lists (in priority order)

| Repo | Section to add cue under | Notes |
|---|---|---|
| `hesreallyhim/awesome-claude-code` | Tools / CLI utilities | flagship list for Claude Code community |
| `arashpiya/awesome-mcp-servers` | "Tools / managers" | cue manages MCP servers; fits |
| `punkpeye/awesome-mcp-servers` | "Skills / profile managers" | mirror of arashpiya, different audience |
| `koodemo/awesome-ai-agents` | "Agent frameworks / tooling" | broader audience |
| `agen-tic-ai/awesome-claude` | "Tooling" | smaller list but cleaner SEO |
| `langgptai/awesome-llm-prompt-engineering` | "Tools / utilities" | adjacent audience |
| `kuwl0/awesome-cli-apps` | "Development / package managers" | general dev audience, broader reach |
| `agarrharr/awesome-cli-apps` | "Development / Tools" | classic awesome-cli list |
| `anthropics/cookbook` | (PR a notebook example using cue) | longshot but cited heavily |

## The canonical entry to paste

One variant, everywhere. Three variants is how the pitch split in the first
place. The wording is the searchable descriptor from
[`positioning.md`](./positioning.md) — do not improvise a per-list rewrite.

```markdown
- [cue](https://github.com/opencue/cuecards) — Per-project profile manager for Claude Code, Codex, and 8 other AI coding agents — scopes which skills and MCP servers load, per directory. [![Stars](https://img.shields.io/github/stars/opencue/cuecards?style=social)](https://github.com/opencue/cuecards)
```

If a list caps entry length below what this fits, trim from the right (drop the
badge first, then `— scopes which…`). Never swap in a different pitch.

## Workflow per list

```bash
# 1. Fork the list
gh repo fork hesreallyhim/awesome-claude-code --clone --remote

# 2. Branch + edit
cd awesome-claude-code
git checkout -b add-cue-profile-manager
# (edit README.md — paste the entry under the right section, keep alphabetical order if the list demands it)

# 3. Commit + push
git commit -am "Add cue — profile manager for Claude Code and 10+ AI agents"
git push origin add-cue-profile-manager

# 4. Open PR
gh pr create --fill --title "Add cue — profile manager for Claude Code" --body "$(cat <<'EOF'
**Project**: [cue](https://github.com/opencue/cuecards)
**License**: MIT
**Stars**: see badge
**What it does**: Manages Claude Code / Codex profiles. Each profile bundles skills, MCPs, plugins, rules, and slash commands. cue auto-resolves the right profile per cwd and materializes a per-profile CLAUDE_CONFIG_DIR so the agent only loads what the current task needs.
**Discovery side**: includes `cue discover` which scans GitHub Code Search for high-quality skill repos, scores them, and bundles them per-profile.

Happy to address any feedback. Thanks for maintaining this list.
EOF
)"
```

## Common pitfalls

- **Sort order**: most awesome lists are alphabetical within sections. Insert at the right spot or maintainer will ask you to.
- **Badge spam**: don't add 3 badges. One stars badge max.
- **Quality bar**: lists like `awesome-claude-code` reject low-quality entries. Make sure the repo has: ✅ README screenshot, ✅ working demo, ✅ ≥10 stars, ✅ last commit <30 days. If any is missing, fix first.
- **Don't bulk-submit**: 1 PR per list per session. Reviewers see bulk submissions and reject as spam.

## Tracking

Maintain a list of submitted PRs here, mark merged/closed:

| List | PR | Status | Date |
|---|---|---|---|
| hesreallyhim/awesome-claude-code | — | not submitted | — |
| punkpeye/awesome-mcp-servers | — | not submitted | — |
| (etc.) | | | |
