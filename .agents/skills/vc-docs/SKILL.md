---
name: vc:docs
description: "Use when you need to analyze a codebase and initialize, update, or summarize project documentation."
argument-hint: "init|update|summarize"
metadata:
  author: claudekit
  version: "1.0.0"
---

# Documentation Management

Analyze codebase and manage project documentation through scouting, analysis, and structured doc generation.

## Default (No Arguments)

If invoked without arguments, use `AskUserQuestion` to present available documentation operations:

| Operation | Description |
|-----------|-------------|
| `init` | Analyze codebase & create initial docs |
| `update` | Analyze changes & update docs |
| `summarize` | Quick codebase summary |

Present as options via `AskUserQuestion` with header "Documentation Operation", question "What would you like to do?".

## Subcommands

| Subcommand | Reference | Purpose |
|------------|-----------|---------|
| `/vc:docs init` | `references/init-workflow.md` | Analyze codebase and create initial documentation |
| `/vc:docs update` | `references/update-workflow.md` | Analyze codebase and update existing documentation |
| `/vc:docs summarize` | `references/summarize-workflow.md` | Quick analysis and update of codebase summary |

## Routing

Parse `$ARGUMENTS` first word:
- `init` → Load `references/init-workflow.md`
- `update` → Load `references/update-workflow.md`
- `summarize` → Load `references/summarize-workflow.md`
- empty/unclear → AskUserQuestion (do not auto-run `init`)

## Shared Context

For this repo, durable agent-facing documentation lives in `process/context/`, not `./docs`.
Read `process/context/all-context.md` first to choose the relevant root file or context group.
Use `audit-context` after adding, moving, splitting, or grouping context files.

**IMPORTANT**: **Do not** start implementing code.
