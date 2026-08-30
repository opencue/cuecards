---
name: vc:watzup
description: "Use when you need a read-only handoff summary of current branch state, local/remote refs, worktrees, active Flowser plans, selected-plan hints, and suggested next checks."
license: MIT
argument-hint: "[--json] [--fetch] [--selected-plan <path>] [--cwd <path>]"
metadata:
  author: flowser
  version: "1.0.0"
---

# Watzup

Summarize the current Flowser repo state for handoff and resume work.

This is a helper skill only.

- Do use it for read-only branch, worktree, and active-plan summaries.
- Do use it to surface likely selected-plan context when it can be proven or safely hinted.
- Do not use it to choose a plan authoritatively.
- Do not use it to approve execution, resume execution, or mutate repo/process state.

## Core Contract

`watzup` is advisory.

- Evidence comes from git, worktree metadata, and `process/*` plan inventory.
- Selected-plan awareness is a hint, not a command.
- Next-step recommendations are suggestions, not workflow gates.

If a user needs execution, the repo still requires explicit plan selection and `ENTER EXECUTE MODE`.

## Invocation

Run the local scanner:

```bash
node .claude/skills/watzup/scripts/watzup-scan.cjs --json
```

Useful flags:

```bash
node .claude/skills/watzup/scripts/watzup-scan.cjs
node .claude/skills/watzup/scripts/watzup-scan.cjs --json --max-branches 8 --plan-limit 6
node .claude/skills/watzup/scripts/watzup-scan.cjs --selected-plan process/general-plans/active/example_PLAN_27-05-26.md
node .claude/skills/watzup/scripts/watzup-scan.cjs --since "14 days ago"
node .claude/skills/watzup/scripts/watzup-scan.cjs --fetch
```

## Input Sources

The scanner reads from:

- `git status --short --branch`
- `git worktree list --porcelain`
- local and remote branch refs plus sampled recent commits
- `process/general-plans/active/`
- `process/features/*/active/`
- optional session-state hints if a local session id is present

It does not scan upstream `plans/**`, and it never treats a selected-plan hint as execute authority.

## Output Shape

The default output is a human-readable report with these sections:

- Current State
- Recent Work
- In-Flight Plans
- Next Steps
- Warnings

`--json` returns the same information as structured data.

If the scanner fails, say that explicitly and fall back to the minimal read-only commands:

```bash
git status --short --branch
git worktree list --porcelain
git for-each-ref --format='%(refname:short) %(committerdate:iso8601) %(objectname:short) %(subject)' refs/heads refs/remotes
find process/general-plans/active process/features -path '*/active/*' -type f | sort
```

## Safety Rules

1. Read-only only. No branch switching, plan edits, or fetch unless `--fetch` is explicit.
2. Treat selected-plan inference as tentative unless it came from an explicit `--selected-plan` argument.
3. Remote branch data is stale-by-default unless `--fetch` is explicit.
4. Use this for session handoff and quick repo orientation, not for workflow control.
5. If the scan cannot prove something, emit a warning instead of guessing.

Good trigger phrases:

- `what's in flight`
- `give me a handoff summary`
- `what active plans do we have`
- `show branch and worktree status`
- `what should I look at next`

Load `references/watzup-workflow.md` when you need the Flowser-specific decision tree or hint-priority rules.
