# Installation Guide

## Claude Code (CLI)

```bash
cp -r skills/setup-experiment ~/.claude/skills/
```

Claude Code picks up skills from `~/.claude/skills/` automatically. The skill activates when you use a trigger phrase (see `SKILL.md` for the full list).

### Recommended companion skill

This skill delegates signal config generation to the **signal-config** skill. Install it alongside:

```bash
cp -r skills/signal-config ~/.claude/skills/
```

## claude.ai (Project Knowledge)

1. Open your Project in claude.ai
2. Go to **Project Knowledge > Add content**
3. Paste the contents of `SKILL.md`
4. Also paste `workflows/setup-experiment.md` for the full step-by-step procedure

## Uninstalling

```bash
rm -rf ~/.claude/skills/setup-experiment
```
