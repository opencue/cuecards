# Update Workflow

## Phase 1: Parallel Codebase Scouting

1. Scan the codebase and calculate the number of files with LOC in each directory (skip `.claude`, `.opencode`, `.git`, `tests`, `node_modules`, `__pycache__`, `secrets`, etc.)
2. Target directories **that actually exist** - adapt to project structure
3. Activate `vc:scout` skill to explore the code base and return detailed summary reports
4. Merge scout reports into context summary

## Phase 1.5: Context Documentation Reading

**You (main agent) must spawn readers** - subagents cannot spawn subagents.

1. Read `process/context/all-context.md` first.
2. Count docs: `find process/context -name '*.md' | sort | wc -l`
3. Get LOC: `find process/context -name '*.md' -print0 | xargs -0 wc -l | sort -rn`
4. Strategy:
   - 1-3 files: Skip parallel reading, current agent reads directly
   - 4-6 files: Spawn 2-3 `Explore` agents
   - 7+ files: Spawn 4-5 `Explore` agents (max 5)
5. Distribute files by LOC (larger files get dedicated agent)
6. Each agent prompt: "Read these docs, extract: purpose, key sections, areas needing update. Files: {list}"
7. Merge results into context for `update-process-agent` or the current docs-only update pass

## Phase 2: Documentation Update

Prefer `update-process-agent` when available. Otherwise perform a docs-only update in the
current agent, without changing implementation code.

Pass the gathered context to update the relevant documentation:
- `README.md`: Update README (keep it under 300 lines)
- `process/context/all-context.md`: Update routing, indexes, group lifecycle, read-when rules, and broad repo context when architecture or conventions changed.
- `process/context/tests/all-tests.md`: Update the testing contract and links to `process/context/tests/`.
- Existing `process/context/*/all-*.md` files: Update group indexes, quick procedures, and ownership rules when grouped docs change.
- Topic-specific root or grouped context docs under `process/context/`: Update only when selected by the router.

## Additional requests
<additional_requests>
  $ARGUMENTS
</additional_requests>

## Phase 3: Size Check (Post-Update)

After documentation updates complete:
1. Run `find process/context -name '*.md' -print0 | xargs -0 wc -l | sort -rn` to check LOC
2. Use `docs.maxLoc` from session context (default: 800)
3. For files exceeding limit: report and ask user

## Phase 4: Documentation Validation (Post-Update)

Run validation to detect potential hallucinations:
1. Run: `node .claude/skills/vc-audit-context/scripts/validate-context-discovery.mjs`
2. Display validation report (warnings only, non-blocking)
3. Checks: code references, internal links, config keys

## Important
- Use `process/context/all-context.md` as the source of truth for documentation discovery.
- Run `audit-context` after adding, moving, splitting, or grouping context files.
- **Do not** start implementing.
