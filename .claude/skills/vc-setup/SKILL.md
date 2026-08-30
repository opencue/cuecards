---
name: vc:setup
description: Interactive agent harness setup for any project. Detects your stack, asks about your project, scaffolds process directories, deep-scans the codebase, and populates context with real content. Works on fresh projects and existing projects with pre-existing configs — always asks before reorganizing.
metadata:
  author: vibecode
  version: "3.2.0"
---

# VibeCo Agent Harness Setup

Interactive setup for the agent development harness. Works on fresh projects and existing projects with pre-existing `.claude/` or `process/` configs.

The skill adapts its flow based on what it finds:
- **New projects** (no existing process/ or context): detect, ask the user about their project, scaffold, study, validate.
- **Existing projects** (has process/, context files, or CLAUDE.md): detect, study what exists first, present findings and ask what to keep vs change, scaffold with approval, re-study to fill gaps, validate.

In both cases, the skill asks questions and waits for approval at every major step. It never silently reorganizes files or overwrites good content.

CLAUDE.md and AGENTS.md are managed protocol files (orchestrator, RIPER-5 methodology, routing). They contain zero project-specific content and should NOT be adapted. Project-specific information lives in `process/context/all-context.md`, which is populated during the STUDY phase.

## Prerequisites

- The target repo should have a `package.json` (or equivalent project manifest).
- That's it. The skill handles the rest.

## Workflow

Read `references/vc-setup.md` for detailed phase instructions, detection heuristics, interactive question templates, parallel subagent delegation strategy, and validation checks.

### Phase 0: BOOTSTRAP (handled by install.sh)

The `install.sh` script handles fetching and installing harness files before vc-setup runs. For existing projects, it backs up old `.claude/`, `.codex/`, `.agents/` to `.vibecode-backup/`, then does a clean install of all kit files. User's `.claude/settings.json` is restored after install. The `process/` directory is never touched by install.sh -- layout migration happens in vc-setup's SCAFFOLD phase.

**If harness files are already present** (`.claude/agents/` and `.claude/skills/` exist with 12+ agents and 20+ skills), skip Phase 0 and proceed directly to Phase 1 DETECT.

**If harness files are NOT present**, tell the user to run the installer first:
```
curl -fsSL https://raw.githubusercontent.com/withkynam/vibecode-pro-max-kit/main/install.sh | bash
```

Then re-run vc-setup.

### Phase 1: DETECT

Gather information about the target project before making any changes.

1. Read `package.json` to detect the package manager (`packageManager` field, lockfile presence), framework (dependencies), and test commands (scripts).
2. Detect monorepo structure: `workspaces` in `package.json`, `pnpm-workspace.yaml`, `apps/`, `packages/` directories.
3. Scan for existing `process/`, `docs/`, `.github/` directories and any context files.
4. **Classify the project** as one of:
   - **New**: no existing `process/` directory, no `all-context.md`, no meaningful prior setup.
   - **Existing**: has `process/`, `all-context.md`, CLAUDE.md with project content, or other prior context.
5. Present a detection summary to the user and wait for confirmation before proceeding.

**After detection, the workflow branches based on project type.** See the two flows below.

---

### Flow A: New Project (no existing process/ or context)

For projects where the harness is being set up for the first time.

**Step 1: ASK** -- Before scaffolding or scanning anything, have a real conversation with the user about their project. Do not guess when you can ask. Do not ask a fixed list of questions and move on — this is an open-ended discovery conversation that continues until you have a thorough understanding.

Start with the basics, then follow up based on their answers:

**Round 1 — Project identity:**
- "What is this project? Give me a brief description in your own words."
- "Who uses it? Who is the target audience?"

**Round 2 — Architecture and scope** (adapt based on Round 1 answers):
- "What are the main product areas or features?"
- "How is the codebase organized? Any key services, packages, or modules I should know about?"
- "What are the most important or complex parts of the codebase?"

**Round 3 — Workflow and conventions** (adapt based on what you've learned):
- "Do you work solo or with a team?"
- "Any coding conventions, naming patterns, or architectural decisions that are important?"
- "How do you handle testing? CI/CD? Deployments?"
- "Any external services, APIs, or integrations that are central to the project?"

**Round 4 — Follow-ups** (ask as many as needed until everything is clear):
- Follow up on anything vague or interesting from previous answers.
- "You mentioned [X] — can you tell me more about how that works?"
- "Are there any pain points, tech debt, or things you want agents to be careful about?"
- "Anything else that is important context for working on this codebase?"

**Keep asking follow-ups until you genuinely understand the project.** If the user gives a short answer, probe deeper. If they mention something complex, ask for details. The goal is that after this conversation, you could explain the project to another developer — what it does, how it's built, what matters, and what to watch out for. Only move on when both you and the user are satisfied.

**Step 2: SCAFFOLD** -- Create the `process/` directory structure from seed templates. (See Phase 2 details below.)

**Step 3: STUDY** -- Deep-scan the codebase and populate context files with real content, enriched by the user's answers from Step 1. (See Phase 3 details below.)

**Step 4: VALIDATE** -- Verify everything is wired correctly. (See Phase 4 details below.)

---

### Flow B: Existing Project (has process/, context files, or prior setup)

For projects that already have some form of process/ directory, context files, or CLAUDE.md content.

**Step 1: STUDY EXISTING** -- Before proposing any changes, read and understand what is already there:

- Read all files under `process/context/` (especially `all-context.md`).
- Read all files under `process/general-plans/` and `process/features/`.
- Read the existing CLAUDE.md if it contains project-specific content (beyond the managed protocol).
- Read any existing `all-tests.md`, feature `_GUIDE.md` files, context group entrypoints.
- Build a complete picture of what the user already has.

**Step 2: PRESENT and ASK** -- Show the user what you found and propose changes. Format:

```
Here is what I found in your existing setup:

LOOKS GOOD (I recommend keeping these as-is):
- [list files/sections that have good content]

COULD BE IMPROVED (I can update these):
- [list files/sections that are stale, placeholder, or incomplete, with brief reason]

MISSING (I recommend adding these):
- [list files/directories that the harness expects but do not exist yet]

LAYOUT CHANGES (reorganization I would suggest):
- [list any directory moves or renames, if applicable]
- [if none needed, say "Your layout looks standard, no reorganization needed."]
```

Wait for the user to approve each category. The user may say "keep everything" or "go ahead with improvements" or selectively approve. Respect their choices.

**Then have the same discovery conversation as Flow A**, regardless of how much existing context you found. Existing context files may be stale, incomplete, or written by someone else. The user's own words are always more valuable than old docs:

- Start with: "I've read your existing context. Let me verify my understanding and fill in the gaps."
- Summarize what you learned from existing files, then ask: "Is this still accurate? What's changed?"
- Ask about anything the existing context doesn't cover (see Flow A Round 1-4 for question areas).
- Follow up on anything unclear. Keep asking until you thoroughly understand the project as it is today.

The combination of existing context + fresh user input produces the best results.

**Step 3: SCAFFOLD** -- Apply only the changes the user approved. Migrate old layouts if needed (using the migration table). Never touch files the user said to keep. (See Phase 2 details below.)

**Step 4: STUDY** -- Deep-scan and update/create context with real content. For existing files, merge intelligently -- fill gaps and update stale sections without replacing good user-written content. (See Phase 3 details below.)

**Step 5: VALIDATE** -- Verify everything is wired correctly. (See Phase 4 details below.)

---

### Phase 2: SCAFFOLD (details)

Create the `process/` directory with seed files and instructional content.

1. Determine the scaffold mode:
   - **Fresh**: no existing `process/` directory -- create everything from `process/_seeds/`.
   - **Merge**: existing `process/` with a different layout -- preserve content, migrate old layout, add missing directories, seed empty folders.
   - **Refresh**: existing harness `process/` -- update protocol docs, seed missing files, preserve user-created content.

**For Merge and Refresh modes, show the user what you plan to change before doing it.** List every file you will create, move, or overwrite. Wait for approval.

**Merge mode includes automatic layout migration.** Before creating new directories, detect and migrate old layouts:

| Old Layout | Migration Action |
|------------|-----------------|
| `process/plans/` exists, `process/general-plans/` does not | Move `process/plans/*` to `process/general-plans/active/`, then remove empty `process/plans/` |
| `process/reports/` exists at top level | Move `process/reports/*` to `process/general-plans/reports/`, then remove empty `process/reports/` |
| `process/skills/` exists at top level | Move `process/skills/*` to `process/general-plans/references/`, then remove empty `process/skills/` |
| `process/context/example-*.md` (PRDs outside planning/) | Move to `process/context/planning/` |
| process/context/backlog.md at top of context/ | Move to `process/general-plans/backlog/backlog.md` |

**Migration rules:**
- Never overwrite existing files at the destination. If a file with the same name exists, keep both (rename the migrated copy with a `-migrated` suffix).
- Print every move action to the user so they can verify.
- After all moves, remove empty source directories.
- If `process/plans/` contains files matching date-based patterns (e.g., `2026-05-22-*.md`, `*_PLAN_*.md`), classify completed plans (look for "COMPLETE" or "DONE" in the file) and move them to `completed/` instead of `active/`.

Seed and template handling:
1. Seeds live in `process/_seeds/` (read-only during setup -- never modified by the scaffold process):
   - Files with `.seed` extension: copy with `.seed` removed, replace `{{project_name}}` with the detected project name.
   - Files without `.seed` extension: copy verbatim.
   - Context group seed folders use `-seed` suffix (e.g., `tests-seed/`, `planning-seed/`). When copying to real locations, drop the `-seed` suffix.
2. Copy development protocol docs from `process/development-protocols/` (these are managed system files, not seeds -- they live in the real directory, not `_seeds/`).
3. Place `_GUIDE.md` files in empty process folders to explain what goes there.
4. Retain `.seed` originals alongside populated files: after copying and filling seed files, also copy the original `.seed` files to the target `process/` directory as structural reference companions. These `.seed` files serve as reference for what sections are expected, and future `vc-update` can diff against them to detect structural drift.
5. Use `_all-group-template.md.seed` as the base when creating new context group entrypoints during the STUDY phase.
6. Use `_feature-template/_GUIDE.md.seed` as the base when creating new feature folder guides during the STUDY phase. The `_feature-template/` now includes all 5 subdirectories (`active/`, `completed/`, `backlog/`, `reports/`, `references/`) with their own `_GUIDE.md` files.
7. See `references/vc-setup.md` for the full target directory tree and placeholder list.

**After scaffolding, show a summary of what was created/changed.** Example: "Created 12 directories, 8 seed files, 6 protocol docs. No existing files were modified."

### Phase 3: STUDY

Perform deep codebase analysis and populate context files with real, researched content.

This is the core value -- instead of leaving placeholder text, the STUDY phase actively reads the codebase and writes ready-to-use context.

1. **Architecture and stack analysis**: Scan source directories, detect frameworks with versions, map import aliases, catalog environment variables, identify key patterns and conventions.
2. **Test setup analysis**: Identify test runners, config files, test directories, and test commands per package/workspace.
3. **Context group detection**: Scan for project signals (database, auth, CI/CD, containers, UI systems, workflows) and create context groups where the project has substantial content.
4. **Feature area detection**: Identify major product areas from route groups, packages, and existing docs. Create feature folders for areas meeting the threshold (3+ source files, distinct product area).
5. **Populate all-context.md**: Write real repository structure, technology stack details, key patterns, environment configuration, and routing tables -- not placeholders. Incorporate what the user told you in the ASK step.
6. **Populate all-tests.md**: Write actual test runner names, real test commands, and per-package breakdowns.
7. **Migration intelligence** (when existing process/ content is found): Read existing content, identify gaps vs fresh scan, fill only gaps while preserving user-written content.

**For existing projects (Flow B):** Before writing, compare your scan results against existing content. If the existing content is more detailed than what you scanned, keep it. Only replace placeholder or stale sections. Add missing sections with scanned data. Never silently overwrite good content.

**After the STUDY phase, show a summary of what was populated.** Example: "Populated all-context.md (8 sections with real content), all-tests.md (3 test runners, 12 commands), created 2 context groups (database/, container/), created 3 feature folders."

See `references/vc-setup.md` for the full STUDY phase checklist, parallel subagent delegation strategy, context group detection table, and feature detection heuristics.

### Phase 4: VALIDATE

Verify the setup is complete, correct, and populated with real content.

1. Check all expected directories exist under `process/`.
2. Verify agent parity: agent names in `.claude/agents/` should match `.codex/agents/`.
3. Check that `.agents/skills` symlink exists and resolves.
4. Verify STUDY phase output quality:
   - `all-context.md` has no remaining `{{placeholder}}` text (except `{{project_name}}` if seed was just created)
   - `all-context.md` has a populated Repository Structure section with real directory tree
   - `all-context.md` has a populated Technology Stack section with specific versions
   - `all-tests.md` has actual test commands (not placeholder text)
   - Context groups created have corresponding entries in the routing tables
   - Feature folders created have `_GUIDE.md` files with real scope descriptions
5. Report any issues found.
6. Suggest running validation scripts if they exist in the target repo:
   - `node .claude/skills/vc-generate-context/scripts/validate-all-context.mjs`
   - `node .claude/skills/vc-audit-context/scripts/validate-context-discovery.mjs`

**Present the final summary** to the user: what was set up, what is ready to use, and recommended next steps (review context, start using the harness).

## Interaction Principles

These principles apply throughout the entire setup flow:

- **Never reorganize without asking.** Show what you found, propose changes, wait for approval.
- **Study before scaffold for existing projects.** Understand what is already there before proposing changes.
- **Have a real conversation, not a checklist.** Do not ask a fixed list of questions and move on. Ask, listen, follow up, ask more. If an answer is vague, probe deeper. If the user mentions something interesting, explore it. Continue until you genuinely understand the project — what it does, how it's built, what matters, and what to watch out for.
- **Show summaries at each step.** After DETECT, show findings. After ASK, summarize your understanding and confirm it's correct. After SCAFFOLD, show what was created. After STUDY, show what was populated.
- **Preserve the user's existing good content.** If they have a well-written CLAUDE.md, detailed context files, or a working process/ layout, merge intelligently -- do not replace with generic scans.
- **One step at a time.** Complete each phase, show the result, and get confirmation before moving to the next phase.
- **Verify your understanding before acting.** After the discovery conversation, summarize what you learned back to the user: "Here's what I understand about your project: [summary]. Is this accurate? Anything I'm missing?" Only proceed when they confirm.

## Rules

- CLAUDE.md and AGENTS.md are managed protocol files. Do NOT adapt or modify them.
- Do not modify RIPER-5 methodology sections, phase transition rules, or key principles.
- Do not modify tool restriction lists in agent prompts.
- Do not modify the status reporting format (DONE, DONE_WITH_CONCERNS, BLOCKED, NEEDS_CONTEXT).
- Always wait for user confirmation after the DETECT phase before making changes.
- Always ask the user about their project before populating context files. Do not rely solely on code scans.
- In Merge mode, never overwrite existing user content.
- In Flow B (existing projects), always present what you found and get approval before modifying anything.
- Project-specific information (tech stack, features, conventions) belongs in `process/context/all-context.md`, not in CLAUDE.md.
- In STUDY phase, write real researched content, not placeholder text. Every section should contain actual project-specific information discovered by scanning the codebase AND informed by the user's answers.
- For large repos (monorepos, 5+ source directories), spawn parallel subagents to maximize throughput and avoid context window exhaustion -- see reference doc for delegation strategy.
