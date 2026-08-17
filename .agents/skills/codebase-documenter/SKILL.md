---
name: codebase-documenter
description: >
  Use this skill when the user wants to understand, document, or explain a codebase — even if
  they don't say "document" explicitly. Trigger on: "explain this codebase", "how does this
  project work", "create onboarding docs", "document the architecture", "I'm new to this repo",
  "generate a codebase overview", or any request to understand unfamiliar code. Produces a single
  docs/CODEBASE.md with architecture, components, data flow, setup instructions, and a
  recommended reading path for new developers. Supports quick/standard/deep depth levels
  and incremental updates.
license: MIT
compatibility: Requires git and bash
allowed-tools: Read Write Bash(bash */codebase-documenter/scripts/*.sh) Bash(find:*) Bash(grep:*) Bash(wc:*) Bash(git log *) Bash(git ls-files *) Bash(ls:*) Bash(mkdir:*)
---

# Codebase Documenter

Generate developer-facing documentation that helps new team members become productive quickly.
Produces a single `docs/CODEBASE.md` with architecture diagrams, component descriptions,
data flow, setup instructions, and an onboarding reading path.

## The Inclusion Test

Before writing any line, ask: **"Would a new developer need to know this to become productive?"**

- If yes → include it
- If no → cut it

Dense, specific content beats comprehensive coverage. Every section should earn its place.

## Source of Truth: Code First

The codebase is the primary source of truth — not the README, not the wiki, not
inline comments. Repository documentation (README.md, ARCHITECTURE.md, CONTRIBUTING.md)
is frequently outdated: it describes what the project *was*, not what it *is*.

**When exploring, always prioritize reading actual code over reading documentation:**
- Derive architecture from imports, entry points, and module structure — not from
  what the README claims the architecture is
- Extract commands from Makefile, package.json scripts, CI config — not from README
  setup instructions that may be stale
- Identify patterns from how the code actually works — not from design docs that
  may describe aspirational patterns never implemented
- Get version numbers from dependency files — not from docs that forget to update them

**When documentation and code disagree, trust the code.** Note the discrepancy if
relevant ("README says X, but the code actually does Y") but document reality.

Documentation is still useful for context that code can't express: the *why* behind
decisions, domain terminology, and business rules. Read it — but verify against code
before including any claim in the output.

## Constraints

- Only describe what can be inferred from actual code, config, and git history
- Never invent undocumented behavior or hypothetical scenarios
- All file paths must point to files that exist
- All version numbers must come from dependency files, not from memory
- All commands must be real — extracted from Makefile, package.json, CI config — verified
  to actually exist, not copied from README without checking
- Complement existing docs (README.md, AGENTS.md), don't duplicate them

---

## Workflow

```
Step 1: Detect Mode & Depth
Step 2: Execute Workflow (Generate or Update)
Step 3: Validate Before Finishing
```

### Step 1: Detect Mode & Depth

**Mode detection:**
- `docs/CODEBASE.md` exists with substantive content → **Update mode**
- `docs/CODEBASE.md` doesn't exist or is empty/placeholder → **Generate mode**
- User says "regenerate" or "start fresh" → **Generate mode** (confirm if user-edited
  content below `<!-- USER NOTES -->` would be lost)

**Depth detection** (auto-detected, user can override with "quick", "standard", or "deep"):

| Level | Auto-trigger | Behavior | Target size |
|-------|-------------|----------|-------------|
| Quick | <15 source files | Entry points + deps + 1 architecture diagram. Skip git history, skip execution tracing. | 100–200 lines |
| Standard | 15–100 source files | Full exploration. 2–3 Mermaid diagrams. Code examples for non-obvious patterns. | 200–400 lines |
| Deep | >100 source files | Exhaustive. Trace execution paths. Read tests for behavior docs. 4–6 diagrams. Detailed code examples. | 400–700 lines |

User override examples: "document this codebase (quick)", "deep documentation please".

---

## Generate Mode

### Phase 1: Fast Facts

Run the extraction script to get a project snapshot in one call:

```bash
bash scripts/extract_project_facts.sh [project-root]
```

This outputs: root files, language detection, source file count (for depth auto-detection),
dependency file contents, directory structure (top 3 levels), entry point candidates,
test framework and test count, build/task runner commands, README excerpt (first 20 lines),
git stats (repo age, contributors, recent commits, most-changed files), and CI/CD config.

Use this output to:
1. Confirm or adjust the auto-detected depth level
2. Identify which files to read in Phase 2
3. Understand the project's age, size, and activity level

### Phase 2: Deep Exploration

Read files in priority order. Adapt depth based on the depth level.

**Priority 1 — Entry Points & Architecture (what does this thing do?):**
- Entry points: main files, CLI definitions, app factories, index files, route definitions
- When multiple entry points exist, read each one to determine whether they are
  independent tools or connected (e.g., a wrapper that exec's another). Don't assume
  relationships — verify from actual code (imports, exec, subprocess calls).
- Configuration system: how config works, environment management
- Follow imports from entry points to map the dependency graph between modules
- Derive the project's purpose from what the code actually does, not from the README

**Priority 2 — Core Business Logic (how does it work?):**
- The files other files depend on (identified by import frequency or git most-changed)
- Service/domain layer: the code that implements actual business rules
- Key abstractions: base classes, interfaces, shared utilities that define patterns
- State management: how state flows through the system

**Priority 3 — Data Models & Schemas:**
- Database models, ORM definitions, migration patterns
- API request/response schemas
- Internal data structures and type definitions
- Validation rules

**Priority 4 — External Integrations:**
- API clients, database connections, message queue producers/consumers
- Authentication/authorization implementation
- Caching layers
- File storage, email services, third-party SDKs

**Priority 5 — Development Workflow (Quick depth: skip):**
- Build system, task runners, Makefile targets
- Test framework, test organization, coverage requirements
- CI/CD pipeline configuration
- Linting, formatting, type checking setup
- Pre-commit hooks

**Priority 6 — Git History (Quick depth: skip):**
- Last 30–50 commit messages for patterns and design decisions
- Reverts, regression fixes → feed into "Critical Paths & Gotchas" section
- Large refactors → feed into "Architecture" decisions
- Conventional commit patterns

**Priority 7 — Existing Documentation (read last, verify against code):**
- README.md, ARCHITECTURE.md, CONTRIBUTING.md, AGENTS.md
- Inline comments in critical files
- Test descriptions (Deep depth only — tests document behavior)
- Documentation is frequently outdated — cross-check every factual claim
  (setup steps, architecture descriptions, version numbers) against the code
  before including it. When docs and code disagree, document what the code does.
- Complement existing docs, don't duplicate

**Depth-level behavior:**
- **Quick**: Priorities 1–2 only. Skim 3–4. Skip 5–7.
- **Standard**: All priorities. Read key files fully.
- **Deep**: All priorities. Trace execution paths end to end. Read test files for
  behavior documentation. Read all significant modules.

### Phase 3: Clarifying Questions (optional)

After exploration, you may ask **up to 2** high-leverage questions — things that would
significantly improve the output and can't be inferred from code.

**Good questions** (specific, grounded in findings):
- "I see both REST endpoints and GraphQL resolvers. Is one the primary API or are both active?"
- "The `legacy/` directory has recent commits. Is it actively maintained or being phased out?"
- "There are two auth mechanisms (JWT + session). Which is preferred for new code?"

**Bad questions** (don't ask):
- "What does this project do?" — inferrable from code and README
- "What language is this?" — obvious
- Generic questions requiring long answers

User can skip all questions. Output must be useful with zero user input.

### Phase 4: Write Documentation

1. Read `references/output-format.md` for section templates and quality criteria
2. Read `references/example-output.md` to calibrate quality and conciseness
3. Create `docs/` directory if it doesn't exist
4. Write `docs/CODEBASE.md` following the output format

**Output sections:**
1. **Project Overview** (5–10 lines) — purpose, type, language, frameworks, status
2. **Table of Contents** (8–12 lines, Standard/Deep only) — flat list of section anchor links for navigation
3. **Architecture Overview** (15–80 lines) — description, Mermaid diagram, design patterns, key decisions
4. **Project Structure** (10–30 lines) — annotated directory tree
5. **Key Components** (20–120 lines) — major modules with file and function/class references, interaction diagrams; reference test files and examples where they exist
6. **Data Flow** (0–50 lines) — how data moves, Mermaid flowchart/sequence, transformations
7. **External Integrations** (10–30 lines) — services table, configuration
8. **Development Guide** (15–50 lines) — prerequisites, setup, commands, testing, config; reference AGENTS.md/README/CONTRIBUTING.md for complementary context
9. **Critical Paths & Gotchas** (10–30 lines) — sensitive areas, common mistakes, "Where to Start" reading path
10. **User Notes** (preserved marker) — `<!-- USER NOTES -->` separator for user-editable content

Section behavior by depth:
- Quick: skip ToC, skip Data Flow (fold into Architecture), merge Integrations into
  Architecture, reduce Development Guide to setup + commands only, Gotchas shows only
  "Where to Start"
- Standard: all sections including ToC
- Deep: all sections expanded, additional diagrams, code examples

### Phase 5: Validate

Run the automated validation script:

```bash
bash scripts/validate_output.sh [project-root] [docs-file-path]
```

This checks: file path references exist, Mermaid diagrams have valid structure,
document size fits the depth-level target, all required sections are present, USER
NOTES marker exists, and commands in the Key Commands table exist in the build system.

Fix any errors reported by the script, then re-run until it passes. Warnings should
be reviewed but may be acceptable (e.g., size slightly outside target range).

After the script passes, manually verify these checks that can't be automated:

1. Every line passes the inclusion test ("would a new dev need this?")
2. All version numbers sourced from dependency files, not from memory
3. Mermaid diagram relationships reflect actual code connections — verify that every
   arrow corresponds to a real import, function call, or exec in the source code
4. No duplication with existing README content
5. No invented behavior — only describe what's in the code

---

## Update Mode

### Phase 1: Assess Staleness

Run the staleness detection script:

```bash
bash scripts/detect_staleness.sh [project-root] [docs-file-path]
```

This reports: changed dependency files, referenced files that no longer exist, new
directories and modules not mentioned in docs, entry point changes, git commits since
last update, and a staleness summary identifying which sections likely need updating.

### Phase 2: Determine Update Scope

**If the user gave a specific request** ("update the architecture section", "add the
new payment module"):
Just do it. No questions needed.

**If general refresh** (no specific request):
Report what looks stale and suggest updates. Don't silently overwrite content.

### Phase 3: Apply Updates

**Section-level update** (user targets a specific area):
1. Read the existing section
2. Read the current state of relevant source files
3. Rewrite only the affected section(s), preserving everything else

**Full refresh** (user requests complete regeneration):
1. Warn that user-edited sections below `<!-- USER NOTES -->` will be preserved
2. Re-explore the project (same as generate mode phases)
3. Regenerate all auto-generated sections
4. Preserve everything below the `<!-- USER NOTES -->` marker

### Preservation Rules

- **Never** overwrite content below `<!-- USER NOTES - content below this line is preserved on updates -->` without explicit permission
- Updates should add or improve — never remove user-added content above the marker without explanation
- Report staleness in sections not automatically updated

---

## Edge Cases

- **Small projects (<5 files)**: Force Quick depth. Skip directory tree section. Focus
  on what the code does and how to run it.
- **Monorepos**: Focus on the package/service the user is working in. Ask if ambiguous.
  Note cross-package dependencies.
- **No git repository**: Skip git history analysis. Note that architectural decisions
  couldn't be inferred from history.
- **Existing docs/CODEBASE.md**: Enter update mode automatically.
- **README.md is comprehensive**: Complement, don't duplicate. Reference it:
  "See README.md for detailed setup instructions."
- **No tests**: Note this in the Development Guide section. Don't invent test instructions.
- **Non-code projects (IaC, config repos)**: Adapt section names — "Components" becomes
  "Resources", "Data Flow" becomes "Provisioning Flow", "Entry Points" becomes "Root Modules".

---

## Available Scripts

- **`scripts/extract_project_facts.sh`** — Fast project snapshot in one shell call.
  Run with `bash scripts/extract_project_facts.sh [project-root]`. Use `--help` for usage.
- **`scripts/detect_staleness.sh`** — Compares existing docs against current project state.
  Run with `bash scripts/detect_staleness.sh [project-root] [docs-file-path]`. Use `--help` for usage.
- **`scripts/validate_output.sh`** — Validates generated documentation against the project.
  Checks file paths, Mermaid syntax, size targets, required sections, and commands.
  Run with `bash scripts/validate_output.sh [project-root] [docs-file-path]`. Use `--help` for usage.

## Resource Reference

| Resource | When to Load | Purpose |
|----------|-------------|---------|
| `scripts/extract_project_facts.sh` | Generate mode, Phase 1 — always run first | Languages, deps, structure, git stats, entry points |
| `scripts/detect_staleness.sh` | Update mode, Phase 1 — before making any changes | Which sections are stale and why |
| `scripts/validate_output.sh` | Phase 5 — after writing output | Automated validation of paths, sections, commands |
| `references/output-format.md` | Generate mode, Phase 4 — right before writing output | Section templates, good/bad examples, size targets |
| `references/example-output.md` | Generate mode, Phase 4 — on first generation only | Calibrate quality and conciseness against a real example |
