---
name: vc:update
description: Pull latest agent harness improvements from the remote kit repository. Shows a dry-run diff summary, waits for confirmation, then applies updates.
metadata:
  author: vibecode
  version: "2.0.0"
---

# vc-update

Pull the latest agent harness improvements from the remote vibecode-pro-max-kit repository into the current project.

## When to Use

- After being told a new harness version is available
- Periodically to check for updates
- After bootstrapping a project with `vc-setup` and wanting the latest improvements

## Workflow

Follow these steps exactly. Do NOT skip the dry-run or confirmation step.

### Step 1: Check Worktree Status

Run `git status --porcelain` in the project root.

- If output is non-empty: **warn** the user that they have uncommitted changes and suggest `git stash` or committing first. **Do not block** -- continue after warning.
- If output is empty: proceed silently.

### Step 2: Read Current Version

Read the file `.vc-version` in the project root.

- If it exists: store its contents as `currentVersion` (a semver string like `2.0.4`).
- If it does not exist: set `currentVersion` to `"0.0.0"` (treat as first update).

### Step 3: Clone Remote Repository

```bash
TMPDIR="/tmp/vc-update-$(date +%s)"
git clone --depth 1 https://github.com/withkynam/vibecode-pro-max-kit.git "$TMPDIR"
```

If the clone fails (network error, auth error, repo not found):
- Print the error message.
- Clean up the temp directory if it was partially created.
- **Stop.** Do not proceed.

### Step 4: Resolve Remote Manifest

Run the resolver script from the cloned repo:

```bash
node "$TMPDIR/resolve-manifest.mjs" --root "$TMPDIR" --json
```

Parse the JSON output to extract:
- `files` (string[]) -- resolved managed file paths
- `merge` (string[]) -- files where user customizations are preserved (not overwritten)
- `copyIfMissing` (string[]) -- files only installed if they don't already exist locally
- `strip` (string[]) -- files needing content stripping (informational)
- `symlinks` (object) -- symlink path -> target mappings

Extract the remote version from the manifest:
```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('$TMPDIR/vc-manifest.json','utf8')).version)"
```

**Legacy fallback:** If `resolve-manifest.mjs` does not exist in the remote (very old kit version), fall back to reading `vc-manifest.json` directly and using the old `managed`/`managedDirs`/`seedsDir` fields for file resolution.

### Step 5: Compare Versions

Compare the remote manifest `version` against `currentVersion`.

- If they are equal: report **"Already up to date (vX.Y.Z)"** and clean up `$TMPDIR`. **Stop.**
- If remote is newer (or currentVersion is `0.0.0`): continue to diff.

### Step 6: Read Local Snapshot and Compute Diff

**Read `.vc-installed-files`** from the project root (if it exists). This file contains one file path per line -- the list of files installed by the last update.

**If `.vc-installed-files` does NOT exist** (first update with new system):
1. Build a synthetic snapshot by scanning the user project for files that exist AND match the remote `files` list.
2. Also check for legacy `deletions` from the v2.0.4 era -- the resolver embeds these as `legacyDeletions` in legacy mode. For any path in the legacy deletions list that still exists locally, mark it for deletion.
3. Write this synthetic snapshot to `.vc-installed-files` for future updates.

**Compute the diff** using three lists: remote `files`, local snapshot, and local filesystem:

- **Additions:** Files in remote `files` but NOT in local snapshot (new files to install).
- **Removals:** Files in local snapshot but NOT in remote `files` (files removed from kit -- should be deleted locally).
- **Modifications:** Files in both lists -- compare content via `diff` between `$TMPDIR/{path}` and `{projectRoot}/{path}`.
  - If identical: **unchanged**.
  - If different: **modified** (note line count changes).
- **Merge files:** Files in the `merge` list that have local changes. Show the diff but note they will NOT be overwritten. The user must manually reconcile.
- **Copy-if-missing files:** Files in the `copyIfMissing` list that already exist locally. Show the diff but note they will NOT be overwritten.

### Step 7: Check Symlinks

For each entry in the `symlinks` object (key = symlink path, value = target):

- If the symlink exists and points to the correct target: mark as **ok**.
- If the symlink is missing or points to a different target: mark as **will fix**.
- If a real directory exists at the symlink path (not a symlink): mark as **will replace dir with symlink**.

### Step 8: Print Dry-Run Summary

Print a summary with all collected results. Format:

```
vc-update dry run: v{currentVersion} -> v{remoteVersion}

FILES:
  [modified]  .claude/agents/vc-execute-agent.md  (+12 -3)
  [new]       .claude/hooks/lib/new-util.cjs
  [removed]   .claude/skills/deprecated-skill/SKILL.md
  [unchanged] .claude/agents/vc-debugger.md
  ...

MERGE (preserved, manual review needed):
  [differs]   .claude/settings.json  (+2 -1)

COPY-IF-MISSING (skipped, already present):
  [skipped]   process/context/planning/example-simple-prd.md

SYMLINKS:
  [ok]        .agents/skills -> ../.claude/skills
  [will fix]  .codex/hooks -> ../.claude/hooks

Summary: 5 modified, 2 new, 1 removal, 1 merge skipped, 45 unchanged
```

### Step 9: Wait for Confirmation

**STOP HERE.** Tell the user:

> "This is a dry-run summary. Type **apply** to proceed with the update, or **abort** to cancel. The temp clone will be cleaned up either way."

Do NOT proceed until the user explicitly says "apply" (or a clear affirmative like "yes", "go", "do it").

If the user aborts:
- Remove `$TMPDIR`.
- Print "Update cancelled. No changes made."
- **Stop.**

### Step 10: Apply Changes

On user confirmation, apply in this order:

1. **Additions and modifications**: For each file in the remote `files` list:
   - Skip if file is in `merge` list AND exists locally (preserve user version).
   - Skip if file is in `copyIfMissing` list AND exists locally (preserve user version).
   - Otherwise: `mkdir -p` the parent directory, copy from `$TMPDIR/{path}` to `{projectRoot}/{path}`.

2. **Removals**: For each file in the local snapshot but NOT in the remote `files` list:
   - Delete the local file.
   - If the parent directory is now empty, remove it too.

3. **Symlinks**: For each entry in `symlinks`:
   - If a real directory exists at the path: `rm -rf` it first.
   - If a wrong symlink exists: `rm` it first.
   - Create the symlink: `ln -s {target} {path}`

4. **Write snapshot**: Write the remote `files` list (sorted, one per line) to `.vc-installed-files`.

5. **Write version**: Write the manifest version string to `.vc-version`.

6. **Clean up**: Remove `$TMPDIR`.

If any copy/delete fails with a permission error:
- Print which file failed and the error.
- Suggest running `chmod` on the affected path or checking file ownership.
- Continue with remaining files (do not abort the entire update).

### Step 11: Print Applied Changes Summary

```
vc-update complete: v{currentVersion} -> v{remoteVersion}

Applied:
  5 files modified
  2 files added
  1 file removed
  1 symlink fixed
  1 merge file preserved (review .claude/settings.json manually)

Snapshot written to .vc-installed-files
Version written to .vc-version: {remoteVersion}
```

## Rules

- `process/_seeds/` is managed reference -- overwritten entirely on update (included in the resolved file list).
- Real working files outside `_seeds/` (`process/context/`, `process/features/`, `process/general-plans/`) are **NEVER** touched by vc-update.
- Always show the dry-run diff before applying. Never apply without user confirmation.
- Clean up the temp clone directory even on error or abort.
- If `.vc-version` is missing, treat as version `0.0.0` (first update, apply everything).
- Files in the `merge` list are never overwritten if they exist locally. Show the diff for manual review.
- Files in the `copyIfMissing` list are only installed if they don't already exist locally.
- Removals are detected by comparing the local `.vc-installed-files` snapshot against the new resolved file list.

## Reference

For detailed algorithm, error handling matrix, and edge cases, see `references/vc-update.md`.
