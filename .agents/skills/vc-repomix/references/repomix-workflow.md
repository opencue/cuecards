# Repomix Workflow

Use this helper when you need a bounded repository artifact for research, comparison, or audit support.

## Decision Tree

### Use `repomix` when

- the user wants a packed repository snapshot
- a remote repo needs to be compared without cloning it deeply
- a large local surface needs to be compressed into one artifact for review
- a documentation or security review needs broader context than manual file reads
- a later helper such as `xia` needs source material

### Do not use `repomix` when

- the user needs a plan artifact
- the user is asking for direct implementation
- the task only needs a few files and ordinary `rg` or targeted reads are cheaper
- the output would become so large that it is less useful than a targeted file set

## Flowser Output Rules

- General artifact:
  - `process/general-plans/references/`
- Feature artifact:
  - `process/features/{feature}/references/`

Never write to:

- `process/general-plans/active/`
- `process/features/*/active/`
- `process/context/`

## Suggested Review Checklist

After every pack:

1. Verify the output path stays inside a `references/` folder.
2. Review suspicious-file and security warnings.
3. Note the `--include` and `--ignore` scope used.
4. Check artifact size and token count.
5. Decide whether to keep or delete the artifact after use.

## Default Conventions

- Prefer `markdown` for human review.
- Prefer `xml` when another tool expects structured machine-friendly output.
- Prefer scoped `--include` patterns.
- Keep outputs flat in the destination `references/` folder unless the user asks otherwise.
- Prefer `pnpm dlx repomix` unless an installed `repomix` binary is already approved.

## Escalation Rules

- If security warnings look real, stop and surface them before wider sharing.
- If the artifact is too large, narrow scope before attempting another full pack.
- If the task involves many repos, use `scripts/repomix_batch.py` rather than ad hoc shell loops.
