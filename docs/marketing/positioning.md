# Positioning — the two canonical strings

cue is positioned as a **scoper**: it loads less. Discovery (`cue discover`) is a
real feature and the SEO engine, but it is never the headline. Neither string
below contains the word "discover".

These two strings do different jobs. Do not merge them, do not paraphrase them,
and do not let a surface invent its own variant. `src/commands/positioning.test.ts`
enforces the machine-readable surfaces; the prose surfaces are on you.

## The repeatable claim

For the README H1, Show HN title, social posts, and the OG card. Optimized for a
human repeating it to another human.

> Your agent reads every skill you own, on every message. cue loads only the ones that project needs.

## The searchable descriptor

For npm, awesome-list entries, the GitHub About field, and `/plugin search`.
Optimized for keyword match, not for wit.

> Per-project profile manager for Claude Code, Codex, and 8 other AI coding agents — scopes which skills and MCP servers load, per directory.

## Surfaces

| Surface | String |
|---|---|
| `package.json` `description` | descriptor |
| `plugins/cue/.claude-plugin/plugin.json` `description` | descriptor |
| `.claude-plugin/marketplace.json` `metadata.description` | descriptor |
| `README.md` H1 subtitle | claim |
| `docs/index.md` front matter + H1 | claim |
| `llms.txt`, `docs/llms.txt` | both |
| `docs/marketing/awesome-lists.md` canonical entry | descriptor |
| GitHub About + topics | descriptor |
| `docs/assets/og-card.png` | claim |
