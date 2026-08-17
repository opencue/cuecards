# Init Workflow

## Phase 1: Parallel Codebase Scouting

1. Scan the codebase and calculate the number of files with LOC in each directory (skip credentials, cache or external modules directories, such as `.claude`, `.opencode`, `.git`, `tests`, `node_modules`, `__pycache__`, `secrets`, etc.)
2. Target directories **that actually exist** - adapt to project structure, don't hardcode paths
3. Activate `vc:scout` skill to explore the code base and return detailed summary reports to the main agent
4. Merge scout reports into context summary

## Phase 2: Documentation Creation

Prefer `generate-context` or `update-process-agent` when available. Otherwise perform a
docs-only initialization in the current agent, without changing implementation code.

Pass the gathered context to create or refresh the relevant documentation:
- `README.md`: Update README with initial documentation (keep it under 300 lines)
- `process/context/all-context.md`: Root context entrypoint, routing table, broad repository context, architecture, conventions, and current state.
- `process/context/tests/all-tests.md`: Testing contract and index to `process/context/tests/`.
- Existing `process/context/*/all-*.md` files: Group-level quick entrypoint for any durable context group that already exists.
- Topic-specific `process/context/*.md`: Durable current-state knowledge selected by the router.

## Phase 3: Size Check (Post-Generation)

After documentation initialization completes:
1. Run `find process/context -name '*.md' -print0 | xargs -0 wc -l | sort -rn` to check LOC
2. Use `docs.maxLoc` from session context (default: 800)
3. For files exceeding limit:
   - Report which files exceed and by how much
   - Prefer promoting the topic to a context group when it meets router criteria
   - If still oversized, ask user: split now or accept as-is?

## Phase 4: Documentation Validation (Post-Generation)

Run `node .claude/skills/vc-audit-context/scripts/validate-context-discovery.mjs` and report
any warnings or failures before finishing.
