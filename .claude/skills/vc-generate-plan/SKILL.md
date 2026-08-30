---
name: vc:generate-plan
description: Create or update Flowser implementation plans in the repo's SIMPLE or COMPLEX format. Use when turning an idea, PRD, or approved direction into a saved plan artifact.
metadata:
  author: flowser
  version: "1.0.0"
---

# Generate Plan

Use this skill to produce the authoritative implementation plan artifact set for Flowser work.

This skill is the canonical planning contract for the repo. Planning discipline previously spread across `vc:plan` now belongs here plus the `plan-agent` prompt.

Normal output is one plan file.

For large multi-phase programs, this skill instead defines how to create an umbrella plan plus
phase-plan set under one feature folder. See `process/development-protocols/phase-programs.md`.

Optional input: a feature idea plus `simple` or `complex` when the user already knows the intended depth.

## Workflow

1. Read `references/generate-plan.md` for the full plan contract.
2. Run `date +%d-%m-%y` before choosing the filename.
3. If complexity is not obvious, ask whether the plan is `SIMPLE` or `COMPLEX`.
4. Save the plan to `process/general-plans/active/` unless the work belongs to an existing `process/features/{feature}/active/` folder.
5. Read `process/context/all-context.md` when present to choose relevant context docs.
6. For complex plans, read `process/context/planning/example-complex-prd.md` before writing.
7. Include automated and manual verification gates from `process/context/tests/all-tests.md`.
8. For new or newly touched direct `*_PLAN_*.md` plans, include explicit sections for `Touchpoints`, `Public Contracts`, `Blast Radius`, `Verification Evidence`, and `Resume and Execution Handoff`.
9. Keep resume/dependency notes Markdown-structured for now; do not invent a second machine-only schema.
10. If the work is a large multi-phase program, create or update a feature folder plan set:
   - one umbrella/orchestration plan
   - one direct plan file per phase
   - one durable report destination per phase
11. Validate the generated artifact:
   ```bash
   node .claude/skills/vc-generate-plan/scripts/validate-plan-artifact.mjs <plan-path>
   ```

## Important Rules

- For standard work, create exactly one plan file.
- For a phase program, create one umbrella plan plus one direct plan file per phase.
- Prefer `process/features/{feature}/active/` when the topic maps to an existing feature folder.
- Keep phase status honest: code-only completion is `CODE DONE`, not `VERIFIED`.
- Make execution trust explicit inside the plan: what code or data can change, what contracts are exposed, what proof is required, and how EXECUTE should resume after compaction.
- End with the next instruction for RIPER-5 or Cursor Plan mode.
- Treat validation failures as blockers before presenting the plan as ready.
- Fold red-team questions, dependency mapping, verification gates, and ambiguity checks into the generated plan itself instead of relying on a parallel plan-owner workflow.
- Do not hide a large program inside one giant plan if execution will actually happen phase by phase.
- Preserve the older complex-plan behavior by keeping pre-phase research and proof gates inside each
  phase plan; the new protocol changes the artifact shape, not the rigor.
