# Audit Plans

Periodic maintenance skill — reviews all plans in `process/general-plans/active/` and `process/features/*/active/` for staleness, completion, and obsolescence. Run this when the plans folders feel cluttered, when UPDATE PROCESS was skipped, or after major architectural changes.

---

## Process

### Step 1 — Inventory

List all plans in `process/general-plans/active/` AND `process/features/*/active/`. For each plan, note:

- Filename and date
- Status markers (look for the status strip at the top)
- Feature/system it covers

Start with the deterministic inventory validator:

```bash
node .claude/skills/vc-audit-plans/scripts/validate-plan-inventory.mjs
```

Use default mode for maintenance audits so legacy drift appears as warnings. Use `--strict`
only when intentionally turning every naming, freshness, and structure warning into a blocker.

### Step 1.5 — Stale Artifact Scan

After inventorying plans, also list files in sibling `reports/` and `references/` directories for each location scanned (both `process/general-plans/` and `process/features/*/`).

For each plan classified as **Completed** or **Obsolete** in Step 2:

1. Check if any report or reference artifact matches by:
   - (a) Filename contains the plan's feature slug
   - (b) Artifact date is within 7 days of the plan date
   - (c) Artifact content explicitly references the plan filename
2. For each matched stale artifact, include it in Step 3 actions:
   - Move to the sibling `completed/` directory with `completed_` prefix (same pattern as plan archival)
   - Cross-feature artifacts (referenced by plans in other feature dirs) must be flagged for user decision
3. Include stale artifact counts in the Step 4 summary report table (separate row or column for "Stale artifacts archived" and "Stale artifacts flagged for user decision")

### Step 2 — Cross-Reference Codebase

For each plan, verify against the actual codebase:

1. **Are the files mentioned in the plan present?** — Glob for them.
2. **Are the features implemented?** — Grep for key identifiers (function names, route paths, component names).
3. **Has the architecture changed since the plan was written?** — Check if the approach described still matches current patterns.

Classify each plan:

| Classification | Criteria | Action |
|---|---|---|
| **Completed** | All phases verified in code, feature is live | Move to appropriate `completed/` dir |
| **Partially Done** | Some phases implemented, others pending | Update status markers, keep in `active/` |
| **Obsolete** | Superseded by architectural change or pivot | Move to `completed/` with `[OBSOLETE]` prefix in filename |
| **Stale** | >30 days old, no matching code changes | Flag for user decision (keep/archive/delete) |
| **Active** | Currently being worked on | Keep as-is |
| **Reference** | Not a feature plan — documents patterns/learnings | Keep as-is (these don't get archived) |

### Step 3 — Execute Actions

For each plan:

- **Completed/Obsolete**: Move to the sibling `completed/` directory (e.g., `process/features/{feature}/active/{name}.md` → `process/features/{feature}/completed/{name}.md`, or `process/general-plans/active/{name}.md` → `process/general-plans/completed/{name}.md`)
  - For obsolete plans, rename with prefix: `completed_obsolete_{name}.md`
- **Partially Done**: Update the status strip markers to reflect current state
- **Stale**: Present to user with recommendation (archive vs keep vs delete)

After edits or moves, re-run:

```bash
node .claude/skills/vc-audit-plans/scripts/validate-plan-inventory.mjs
```

### Step 4 — Report

Present a summary table:

```
| Plan | Date | Classification | Action Taken |
|------|------|----------------|--------------|
| ...  | ...  | ...            | ...          |
```

Include:
- Total plans reviewed
- Plans archived (completed + obsolete)
- Plans flagged for user decision
- Any patterns noticed (e.g., "3 plans superseded by the same pivot")

---

## When to Run

- After completing a major feature (clean up related plans)
- After non-trivial EXECUTE work if UPDATE PROCESS was skipped and active-plan drift accumulated
- After an architectural pivot (identify obsoleted plans)
- Monthly maintenance
- When total active plans across `process/general-plans/active/` and `process/features/*/active/` exceeds 10
