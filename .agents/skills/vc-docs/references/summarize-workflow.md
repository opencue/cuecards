# Summarize Workflow

Activate `vc:scout` skill to analyze the codebase, read `process/context/all-context.md`,
update the relevant `process/context/` summary document, and respond with a concise
summary report.

## Arguments
$1: Focused topics (default: all)
$2: Should scan codebase (`Boolean`, default: `false`)

## Focused Topics
<focused_topics>$1</focused_topics>

## Should Scan Codebase
<should_scan_codebase>$2</should_scan_codebase>

## Important
- Use `process/context/all-context.md` as the source of truth for documentation discovery.
- Update `process/context/all-context.md` only for broad repository context.
- Update grouped or topic-specific `process/context/` files only when the router points to them.
- Run `audit-context` after adding, moving, splitting, or grouping context files.
- Do not scan the entire codebase unless the user explicitly requests it.
- **Do not** start implementing.
