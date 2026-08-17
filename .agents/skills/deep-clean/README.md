# deep-clean

Full-spectrum consolidation for AI coding agent configuration files.

Most dream/consolidation skills only touch memory files. **deep-clean** audits and optimizes everything:

- **Context files** (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `.cursorrules` / `.windsurfrules`) — dead file paths, stale structure docs, outdated endpoint lists
- **Rules** (`.claude/rules/`, `.cursor/rules/`, `.gemini/rules/`, `.agents/rules/`) — stack mismatches, duplications, vague directives
- **Skills** (`.claude/skills/`, `.agents/skills/`, etc.) — unused skills, stack-irrelevant skills, oversized reference files
- **Memory** — standard dream consolidation (duplicates, contradictions, stale entries, relative dates)

Works with: **Claude Code, Cursor, Codex, Gemini CLI, GitHub Copilot, Windsurf**, and any agent supporting the SKILL.md standard.

## Install

```bash
# Via skills CLI (Vercel)
skills add JulienMicrofacto/deep-clean-skill -g

# Or manually
git clone https://github.com/JulienMicrofacto/deep-clean-skill.git ~/.claude/skills/deep-clean
```

## Usage

In any Claude Code session:

```
/deep-clean
```

Or just say: "run deep clean"

First run is always a **dry run** (audit report only). Review the report, then say "apply changes" to proceed.

## What It Detects

| Issue | Example |
|-------|---------|
| Dead file paths | Context file says `app/foo/bar.py` but it was deleted 2 weeks ago |
| Stack mismatches | `svelte.md` rule in a Python/FastAPI project |
| Duplicated rules | Same git convention in context file AND `rules/conventions.md` |
| Vague directives | "Write clean code" — no measurable threshold |
| Stale memory | Memory entry references a function that was renamed |
| Bloated index | MEMORY.md over 200 lines |
| Contradictions | Rule A says "use tabs", Rule B says "use spaces" |
| Unused skills | Skill installed but never triggered in recent sessions |

## Auto-trigger (optional)

Deep clean can run automatically every 7 days via a Stop hook:

```bash
# Make scripts executable
chmod +x ~/.claude/skills/deep-clean/should-clean.sh
chmod +x ~/.claude/skills/deep-clean/clean-hook.sh
```

Then add to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [{
      "type": "command",
      "command": "bash $HOME/.claude/skills/deep-clean/clean-hook.sh"
    }]
  }
}
```

And add to your `~/.claude/CLAUDE.md`:

```markdown
## Auto Deep Clean
If `~/.claude/.deep-clean-pending` exists at session start, run `/deep-clean` as a background subagent, then delete the flag file.
```

## 7 Phases

0. **DETECT** — Identify which agent is running, resolve all paths automatically
1. **AUDIT** — Scan everything, produce a report of all issues found
2. **CONTEXT** — Fix dead paths, update structure, remove duplications, strengthen directives
3. **RULES** — Archive irrelevant rules, deduplicate, add measurable thresholds
4. **SKILLS** — Flag unused/irrelevant skills for removal (never auto-removes)
5. **MEMORY** — Standard dream: dedupe, resolve contradictions, convert relative dates, prune index
6. **VERIFY** — Validate all changes, print before/after summary

## Safety

- First run = dry run (report only, no changes)
- Backs up files before modifying
- Never deletes architectural decisions
- Never auto-removes skills (recommends only)
- All changes are Edit-based, reviewable via `git diff`

## Works With

Any project, any stack. Automatically detects:
- Python (pyproject.toml, requirements.txt)
- Node/TypeScript (package.json)
- Rust (Cargo.toml)
- Go (go.mod)
- Ruby (Gemfile)
- Monorepos (multiple stacks)

## License

MIT
