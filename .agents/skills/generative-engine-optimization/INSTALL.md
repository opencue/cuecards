# Installation Guide

## Claude Code (CLI)

```bash
cp -r skills/generative-engine-optimization ~/.claude/skills/
```

Claude Code picks up skills from `~/.claude/skills/` automatically. The skill activates when you use a trigger phrase (see `SKILL.md` for the full list).

The GEO simulation prompts workflow needs web search for Phase 1 research. It will use whatever search tool is available in your environment. If none is configured, the skill will prompt you to install one or provide source URLs manually.

## claude.ai (Project Knowledge)

1. Open your Project in claude.ai
2. Go to **Project Knowledge → Add content**
3. Paste the contents of `SKILL.md`
4. (Optional) Also paste `workflows/geo-simulation-prompts.md` for the full GEO workflow detail

Ensure **Web search** is enabled in your Project settings for the GEO research phase.

## MCP Server (self-hosted or remote)

```bash
claude mcp add geo-skills \
  --command npx \
  --args "mcp-server-markdown-skills --skills-dir /path/to/agent-skills/skills"
```

Or via a remote URL:

```bash
claude mcp add geo-skills --url https://your-mcp-server.example.com/mcp
```

## Uninstalling

```bash
rm -rf ~/.claude/skills/generative-engine-optimization
```
