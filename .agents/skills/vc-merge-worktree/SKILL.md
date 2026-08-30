---
name: vc:merge-worktree
description: Merge a git worktree branch back into the main Flowser checkout and clean up the worktree. Use when the user asks to merge, archive, or clean up a completed worktree.
argument-hint: "[worktree path or branch]"
metadata:
  author: flowser
  version: "1.0.0"
---

# Merge Worktree

Use this skill for safe worktree merge and cleanup. Skip RIPER-5 mode routing for this operational task.

## Workflow

1. Confirm the current path is a worktree, not the main checkout.
2. Run `git status --short` and stop if there are uncommitted changes.
3. Capture the current branch and worktree path.
4. Locate the main checkout with `git worktree list`.
5. Switch to the main checkout and update `main` if the user wants latest remote changes included.
6. Merge the worktree branch into `main`.
7. If merge succeeds, remove the worktree with `git worktree remove <path>`.
8. Delete the local branch with `git branch -d <branch>`.
9. Run `git worktree prune`.
10. Report the merge result and whether a push is still needed.

## Safety

- Never run from `main` or `master`.
- Never delete a branch before a successful merge.
- Stop on conflicts and explain the exact recovery state.
