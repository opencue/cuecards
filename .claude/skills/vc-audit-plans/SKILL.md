---
name: vc:audit-plans
description: Audit active Flowser plan files for staleness, completion, and routing truth. Use when cleaning up plans, reconciling active work, or archiving completed artifacts.
metadata:
  author: flowser
  version: "1.0.0"
---

# Audit Plans

Use this skill to review active plan artifacts and reconcile them with the current codebase.

This is a maintenance and recovery skill, not an automatic post-task hook.

Optional input: a feature, folder, plan filename, or maintenance scope to prioritize.

Prefer it when:

- UPDATE PROCESS was skipped and active-plan cleanup drift accumulated
- the user wants a periodic active-plan cleanup pass
- multiple active plans need reconciliation after a burst of work

## Workflow

1. Read `references/audit-plans.md` for the full audit process.
2. Run the inventory validator:
   ```bash
   node .claude/skills/vc-audit-plans/scripts/validate-plan-inventory.mjs
   ```
3. Inventory plans in `process/general-plans/active/` and `process/features/*/active/`.
3.5. Scan sibling `reports/` and `references/` dirs alongside each `active/` dir for artifacts tied to plans classified as Completed or Obsolete. Match by feature slug, date proximity (7 days), or content reference to the plan filename.
4. Cross-check each plan against the actual codebase with file existence checks and targeted `rg` searches.
5. Classify each plan as `Completed`, `Partially Done`, `Obsolete`, `Stale`, `Active`, or `Reference`.
6. Move only clearly completed or obsolete plans to the appropriate `completed/` folder.
7. Ask before deleting anything.
8. Re-run the inventory validator after moving or editing plan files.

## Output

Return a concise summary table with classification, action taken, and any user decisions needed. Include stale artifact findings (reports/references tied to completed or obsolete plans) with recommended actions.
