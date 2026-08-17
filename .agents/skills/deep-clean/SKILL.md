---
name: deep-clean
description: "Full-spectrum consolidation of AI agent configuration files. Goes beyond memory-only dream skills: audits and optimizes context files (AGENTS.md/AGENTS.md/GEMINI.md/.cursorrules), rules, skills, and memory. Detects stale references, dead file paths, duplicated rules, stack mismatches, contradictions, vague directives, and bloated indexes. Works on any repo, any stack, any agent."
tags: [memory, maintenance, consolidation, audit, rules, skills, optimization, universal]
---

# Deep Clean — Full Configuration Consolidation for AI Coding Agents

> Dream cleans your memory. Deep Clean cleans **everything**.

Most dream/consolidation skills only touch memory files. Your context files, rules, and skills rot just as fast — stale file paths, rules for a stack you don't use, duplicated directives, vague instructions no agent can follow. Deep Clean fixes all of it.

Works with: Codex, Cursor, Codex, Gemini CLI, GitHub Copilot, Windsurf, and any agent supporting the SKILL.md standard.

---

## What It Does

```
Phase 0: DETECT      → Identify which agent is running, resolve paths
Phase 1: AUDIT       → Scan everything, report problems
Phase 2: CONTEXT     → Consolidate the main context file
Phase 3: RULES       → Clean up rules directory
Phase 4: SKILLS      → Audit installed skills
Phase 5: MEMORY      → Standard dream consolidation
Phase 6: VERIFY      → Validate all changes
```

---

## How to Run

Run `/deep-clean` manually, or say "run deep clean" in any session. First run always does a **dry run** (report only, no changes) unless you explicitly say "run deep clean and apply changes".

---

## Phase 0: DETECT AGENT

**Goal:** Identify which agent is running and set paths for the rest of the process.

### Agent detection

Check which directories exist to determine the active agent:

```bash
# Detect agent by directory presence
ls .Codex/ 2>/dev/null && echo "AGENT: Codex"
ls .cursor/ 2>/dev/null && echo "AGENT: cursor"
ls .gemini/ 2>/dev/null && echo "AGENT: gemini-cli"
ls .agents/ 2>/dev/null && echo "AGENT: codex/universal"
ls .windsurf/ 2>/dev/null && echo "AGENT: windsurf"
ls .github/copilot/ 2>/dev/null && echo "AGENT: copilot"
```

### Set variables for all subsequent phases

Based on the detected agent, use these paths throughout:

| Variable | Codex | Cursor | Gemini CLI | Codex | Windsurf |
|----------|------------|--------|------------|-------|----------|
| `CONTEXT_FILE` | `AGENTS.md` | `.cursorrules` | `GEMINI.md` | `AGENTS.md` | `.windsurfrules` |
| `RULES_DIR` | `.Codex/rules/` | `.cursor/rules/` | `.gemini/rules/` | `.agents/rules/` | `.windsurf/rules/` |
| `SKILLS_DIR` | `.Codex/skills/` | `.cursor/skills/` | `.gemini/skills/` | `.agents/skills/` | `.windsurf/skills/` |
| `MEMORY_DIR` | `~/.Codex/projects/*/memory/` | `~/.cursor/projects/*/memory/` | `~/.gemini/memory/` | `~/.agents/memory/` | — |
| `ARCHIVE_DIR` | `{RULES_DIR}/_archive/` | `{RULES_DIR}/_archive/` | `{RULES_DIR}/_archive/` | `{RULES_DIR}/_archive/` | `{RULES_DIR}/_archive/` |

**Also check for the universal `.agents/` directory** — many agents support it as a fallback:
```bash
ls .agents/skills/ 2>/dev/null && echo "UNIVERSAL: .agents/ directory found"
```

If multiple agents are detected, process all of them. Skills in `.agents/skills/` are shared across agents.

For the rest of this document, `CONTEXT_FILE`, `RULES_DIR`, `SKILLS_DIR`, and `MEMORY_DIR` refer to the resolved paths from this phase.

---

## Phase 1: AUDIT

**Goal:** Build a complete picture of the current configuration state before touching anything.

### Step 1: Inventory all configuration files

```bash
# Context files (check all known names)
for f in AGENTS.md AGENTS.md GEMINI.md .cursorrules .windsurfrules; do
  [ -f "$f" ] && echo "CONTEXT: $f ($(wc -l < "$f") lines)"
done

# Rules
ls ${RULES_DIR}/*.md 2>/dev/null

# Skills (SKILL.md files)
find ${SKILLS_DIR} -name "SKILL.md" 2>/dev/null

# Memory
ls ${MEMORY_DIR}/*.md 2>/dev/null
```

### Step 2: Detect project stack

Determine the actual tech stack by checking for marker files. Do NOT rely on what the context file says — check reality:

```bash
# Python
ls pyproject.toml setup.py requirements.txt Pipfile 2>/dev/null && echo "STACK: python"

# Node/JS/TS
ls package.json 2>/dev/null && echo "STACK: node"

# Rust
ls Cargo.toml 2>/dev/null && echo "STACK: rust"

# Go
ls go.mod 2>/dev/null && echo "STACK: go"

# Ruby
ls Gemfile 2>/dev/null && echo "STACK: ruby"
```

Also detect frameworks:

```bash
# Python frameworks
grep -l "fastapi\|flask\|django\|starlette" pyproject.toml setup.py requirements.txt 2>/dev/null
# JS frameworks
grep -l "react\|vue\|svelte\|next\|nuxt\|angular" package.json 2>/dev/null
```

### Step 3: Measure sizes

For each file, note line count. Flag anything over these thresholds:

| File | Warning | Critical |
|------|---------|----------|
| Context file | > 500 lines | > 1000 lines |
| Any single rule | > 100 lines | > 200 lines |
| MEMORY.md (index) | > 100 lines | > 200 lines |
| Any memory topic file | > 50 lines | > 100 lines |

### Step 4: Cross-reference file paths

Read the context file and extract every file path mentioned (anything that looks like `path/to/file` or `app/module/`). Then verify each one exists:

```bash
# For each path found in context file, check if it exists
# Example: if it mentions "app/auth/router.py"
ls app/auth/router.py 2>/dev/null || echo "DEAD PATH: app/auth/router.py"
```

This is the most valuable check. Context file descriptions of project structure drift constantly as code evolves.

### Step 5: Detect duplications

Search for the same concept appearing in multiple places:

1. Read the context file — note every rule/convention/pattern described
2. Read each rule file in `RULES_DIR` — note overlaps with the context file
3. Check if the context file repeats things that are in rules files

Common duplications:
- Git conventions in both context file and a `conventions.md` rule
- Testing instructions in both context file and a `testing.md` rule
- API conventions in both context file and rules

### Step 6: Detect stack mismatches

Compare detected stack (Step 2) against rule files:

- A Python/FastAPI project with `svelte.md`, `typescript.md`, `testing.md` (Vitest/Playwright) rules = **mismatch**
- A Node project with `python-testing-patterns` skill = **mismatch**
- Frontend-only rules in a backend-only project = **mismatch**

### Output: Audit Report

Produce a structured report:

```markdown
## Deep Clean Audit Report

### Agent Detected
- Agent: [name]
- Context file: [CONTEXT_FILE] (X lines)

### Configuration Files
- Context file: X lines (WARNING/OK)
- Rules: N files, X total lines
- Skills: N skills installed
- Memory: N topic files

### Stack Detection
- Detected: [python, fastapi] from pyproject.toml
- Monorepo: no

### Issues Found

#### Dead File Paths (X found)
- [CONTEXT_FILE] line Y: `path/to/deleted/file.py` — does not exist

#### Stack Mismatches (X found)
- Rule `svelte.md` — Svelte 5 rules in a Python/FastAPI project

#### Duplications (X found)
- Git conventions: [CONTEXT_FILE] §Conventions AND rules/conventions.md §Git

#### Vague Directives (X found)
- [CONTEXT_FILE]: "Write clean code" — no measurable threshold

#### Size Warnings
- [CONTEXT_FILE]: 1124 lines (CRITICAL, threshold: 1000)

#### Stale Memory Entries (X found)
- memory/project_foo.md: references file that no longer exists
```

**STOP HERE on first run.** Present the report and ask: "Should I proceed with consolidation, or do you want to review the issues first?"

---

## Phase 2: CONTEXT FILE CONSOLIDATION

**Goal:** Make the context file (AGENTS.md / AGENTS.md / GEMINI.md / .cursorrules) accurate, lean, and current.

### Rules

1. **Verify before deleting.** For every file path, table, or endpoint listed, verify it still exists before removing it. If a file was renamed or moved, update the path. If it was deleted, remove the entry.

2. **Structure check.** Run `ls` / `find` on the actual project structure and compare against what the context file describes. Add missing files/modules. Remove deleted ones.

3. **Endpoint check.** If the context file lists API endpoints, verify each one exists in the router files. Remove endpoints that were deleted. Add new ones that aren't listed.

4. **Table check.** If the context file lists database tables/models, verify each one exists in the model files. Update accordingly.

5. **Remove duplications with rules.** If something is thoroughly covered in a rules file, the context file should reference the rule, not duplicate the content. Exception: critical project-specific info that must be seen first.

6. **Convert vague directives to thresholds.** Replace:
   - "Write clean code" → remove (meaningless)
   - "Keep functions short" → "Max 50 lines per function" (or whatever the project's actual convention is — check existing code to determine)
   - "Good test coverage" → "Coverage >= 80% (enforced by CI)" (or check actual CI config)

7. **Never delete architectural decisions.** Decision sections are historical record. Only update if a decision was explicitly reversed.

### How to apply

Use the Edit tool to make targeted changes. Never rewrite the entire file — make surgical edits to specific sections.

---

## Phase 3: RULES CONSOLIDATION

**Goal:** Remove irrelevant rules, deduplicate, strengthen.

### Step 1: Stack relevance check

For each rule file in `RULES_DIR`, determine if it applies to the detected stack:

| Rule file | Relevant if | Action if irrelevant |
|-----------|-------------|---------------------|
| `svelte.md` | package.json has svelte | Archive or delete |
| `typescript.md` | package.json has typescript | Archive or delete |
| `testing.md` | References project's actual test framework | Rewrite for actual framework |
| `accessibility.md` | Project has frontend UI | Archive if backend-only |
| `design-workflow.md` | Project has frontend design system | Archive if backend-only |
| `python-*.md` | pyproject.toml or requirements.txt exists | Archive if not Python |

**Archive = move to `ARCHIVE_DIR` with a note explaining why.**

### Step 2: Deduplication

If a rule file repeats content from the context file, decide which is the authority:
- Project-specific details → keep in context file
- General conventions → keep in rules file, remove from context file

### Step 3: Strengthen vague rules

Apply numeric thresholds where possible. Check the project's actual linter config, CI config, and existing code to determine realistic thresholds:

```bash
# Check existing linter config for thresholds
cat pyproject.toml | grep -A20 "\[tool.ruff" 2>/dev/null
cat .eslintrc* eslint.config.* 2>/dev/null
cat pytest.ini pyproject.toml | grep -A10 "\[tool.pytest" 2>/dev/null
```

---

## Phase 4: SKILLS AUDIT

**Goal:** Identify unused, redundant, or oversized skills.

### Step 1: List all installed skills

```bash
# Check both agent-specific and universal skill directories
find ${SKILLS_DIR} -name "SKILL.md" -exec bash -c 'echo "$(wc -l < "$1") $1"' _ {} \;
find .agents/skills -name "SKILL.md" -exec bash -c 'echo "$(wc -l < "$1") $1"' _ {} \; 2>/dev/null
```

### Step 2: Relevance check

For each skill, check:
1. Does the skill's domain match the project stack?
2. Is the skill duplicating another skill's functionality?
3. Is the skill relevant to this type of project (backend/frontend/fullstack)?

### Step 3: Size check

Skills with large `references/` directories consume context when triggered. Flag skills where total reference content exceeds 5000 lines.

### Actions

- **Irrelevant skills**: Recommend removal
- **Redundant skills**: Recommend keeping the better one
- **Oversized skills**: Recommend trimming references

**Do not auto-remove skills.** Always recommend and let the user decide.

---

## Phase 5: MEMORY CONSOLIDATION

**Goal:** Standard dream — clean, dedupe, and index memory files.

### Step 1: Read all memory files

```bash
ls ${MEMORY_DIR}/*.md 2>/dev/null
```

Read MEMORY.md (index) and each topic file. If no memory directory is found, skip this phase.

### Step 2: Check for issues

- **Stale entries**: Memory references files/functions that no longer exist
- **Relative dates**: "yesterday", "last week" without an anchor date
- **Duplicates**: Same fact in multiple files
- **Contradictions**: File A says X, File B says not-X
- **Orphaned files**: Topic files not referenced in MEMORY.md
- **Dead index entries**: MEMORY.md references files that don't exist

### Step 3: Fix issues

1. Convert relative dates to absolute: check file modification time for context
2. Merge duplicate entries — keep the most recent, note the merge
3. Resolve contradictions — keep the most recent, remove the old
4. Remove orphaned files or add them to MEMORY.md
5. Remove dead index entries

### Step 4: Enforce limits

- MEMORY.md index: max 200 lines
- Each topic file: keep focused, one topic per file
- Each index entry: one line, under 150 characters

---

## Phase 6: VERIFY

**Goal:** Confirm all changes are valid.

### Checks

1. **No broken references**: Every file path in the context file still exists
2. **MEMORY.md under 200 lines**: `wc -l` on MEMORY.md
3. **No duplicate rules**: Grep for identical sentences across context file and rules
4. **Rules match stack**: No frontend rules in backend projects (or vice versa)
5. **No relative dates in memory**: `grep -rn "yesterday\|last week\|last month\|tomorrow" ${MEMORY_DIR} 2>/dev/null`

### Summary

Print a consolidation summary:

```markdown
## Deep Clean Summary

### Changes Applied
- [CONTEXT_FILE]: X dead paths removed, Y entries updated, Z lines reduced
- Rules: N files archived (stack mismatch), M directives strengthened
- Skills: N flagged for removal (user decision pending)
- Memory: X duplicates merged, Y contradictions resolved, Z stale entries removed

### Before/After
| File | Before | After | Delta |
|------|--------|-------|-------|
| [CONTEXT_FILE] | X lines | Y lines | -Z |
| rules/ total | X lines | Y lines | -Z |
| memory/ total | X lines | Y lines | -Z |

### Remaining Issues (manual review needed)
- Skill `frontend-design`: recommend removal (Y/N?)
- ...
```

---

## Safety

- **First run is always dry run** unless user explicitly requests changes
- **Back up before modifying**: Copy context file and rules before first edit
- **Never delete architectural decisions** from context files
- **Never auto-remove skills** — only recommend
- **Preserve memory entries** — move to archive rather than delete
- **Git-friendly**: All changes are made via Edit tool, reviewable in `git diff`

---

## Auto-trigger (optional, Codex only)

To run automatically every 7 days, add a Stop hook. See `clean-hook.sh` and `should-clean.sh` in this skill's directory for details.
