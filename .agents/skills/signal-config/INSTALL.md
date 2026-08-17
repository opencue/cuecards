# Installation Guide

## Claude Code (CLI)

```bash
cp -r skills/signal-config ~/.claude/skills/
```

Claude Code picks up skills from `~/.claude/skills/` automatically. The skill activates when you use a trigger phrase (see `SKILL.md` for the full list).

## claude.ai (Project Knowledge)

1. Open your Project in claude.ai
2. Go to **Project Knowledge > Add content**
3. Paste the contents of `SKILL.md`
4. Also paste `workflows/generate-config.md` for the full schema reference and examples

## Uninstalling

```bash
rm -rf ~/.claude/skills/signal-config
```
