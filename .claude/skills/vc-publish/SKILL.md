---
name: vc:publish
description: Push agent harness improvements from the current development repo to the remote kit repository. Use when you want to publish local harness changes back to the shared kit. Diffs managed files, shows what changed, bumps version, and pushes.
metadata:
  author: vibecode
  version: "2.0.0"
---

# vc-publish

Push harness improvements from the current development repo to the remote kit repository (`vibecode-pro-max-kit`). This is the **maintainer** counterpart to `vc-update`.

- `vc-update` = **user** pulls latest harness INTO their project FROM the remote
- `vc-publish` = **maintainer** pushes improvements FROM the development repo TO the remote kit repo

## Prerequisites

- Local checkout of the kit repo (`git clone git@github.com:withkynam/vibecode-pro-max-kit.git`)
- `.vc-publish-config` file in the current repo root (see Configuration below)
- Git push access to the remote kit repo

## Configuration

Create `.vc-publish-config` in the repo root:

```json
{"kitRepoPath": "/path/to/vibecode-pro-max-kit"}
```

If this file is missing, ask the user for the kit repo checkout path and offer to create it.

## Workflow

### Step 1: Load Configuration

1. Read `.vc-publish-config` from the current repo root.
2. If missing, ask the user for the kit repo local checkout path.
3. Verify the path exists and contains `vc-manifest.json`.
4. Verify the kit repo worktree is clean (`git -C <kitRepoPath> status --porcelain`). If dirty, warn and ask whether to proceed or abort.

### Step 2: Read Manifest

5. Read `vc-manifest.json` from the kit repo checkout.
6. Extract the current `version`.

### Step 3: Resolve Both File Sets

7. Run the resolver against the **kit repo** to get the kit file list:
   ```bash
   node <kitRepoPath>/resolve-manifest.mjs --root <kitRepoPath> --json
   ```
   Extract `files` (kit managed files) and `kitOnly` (kit-exclusive files).

8. Run the resolver against the **dev repo** to get the dev file list:
   ```bash
   node <kitRepoPath>/resolve-manifest.mjs --root <devRepoRoot> --json
   ```
   Extract `files` (dev managed files).

   **Note:** The resolver uses the manifest from the `--root` directory. Since the dev repo has a copy of `vc-manifest.json`, the resolver works against it. If the dev repo doesn't have the resolver script, copy it from the kit repo first or use the kit repo's copy with `--root` pointing to the dev repo.

### Step 4: Compute Diff

9. Compare the two resolved file sets:
   - Files in dev `files` but NOT in kit `files`: **new** (will be added to kit).
   - Files in kit `files` but NOT in dev `files`: **removed** (will be removed from kit).
   - Files in both: compare content via `diff`. Classify as **modified** or **unchanged**.
   - `strip` files (CLAUDE.md, AGENTS.md): always flag for content review regardless of diff status.

### Step 5: Print Diff Summary

10. Print a summary table:

```
vc-publish diff: current repo -> kit repo (v2.1.0)
================================================

FILES:
  [modified]  .claude/agents/vc-execute-agent.md  (+8 -3)
  [modified]  .claude/hooks/lib/scout-checker.cjs  (+2 -1)
  [new]       .claude/skills/vc-new-skill/SKILL.md
  [strip]     CLAUDE.md (needs content review)
  [strip]     AGENTS.md (needs content review)
  [unchanged] .claude/settings.json
  ... (350 more unchanged)

Total changes: 4 files modified, 1 new, 0 removed
```

### Step 6: STOP -- Confirm Publish

11. **STOP** and ask the user:
    - Confirm they want to publish these changes.
    - Specify version bump type: **patch**, **minor**, or **major**.
    - Or abort.

Version bump semantics:
- **Patch** (2.1.0 -> 2.1.1): hook fixes, skill doc updates, minor agent prompt tweaks
- **Minor** (2.1.0 -> 2.2.0): new skills, new agents, new development protocols
- **Major** (2.1.0 -> 3.0.0): CLAUDE.md structure changes, manifest schema changes, breaking workflow changes

### Step 7: Apply Changes

12. On confirm:
    - Copy all **modified** and **new** managed files from current repo to kit repo checkout.
    - For each **removed** file: delete it from the kit repo checkout.
    - **CLAUDE.md and AGENTS.md stripping**: Do NOT copy the current repo's project-specific versions directly. Instead:
      1. Read the current repo's CLAUDE.md/AGENTS.md.
      2. Read the kit repo's existing harness-only version as base.
      3. Apply only methodology/structural changes from the dev repo to the kit's harness-only version.
      4. Strip all project-specific content:
         - Technology stack details (frameworks, databases, versions)
         - Feature list / "Current features" entries
         - Project-specific context groups
         - Hardcoded package manager (replace with generic)
         - MCP server instructions (project-specific config)
         - Project-specific routing rules
         - Absolute paths (`/Users/...`)
         - Product name references ("Flowser", "flowser-turborepo")
      5. Verify the result is harness-only methodology with no project leaks.
    - Update `vc-manifest.json`: bump `version` field per the chosen bump type. **No other manifest changes needed** -- glob patterns are stable, new files are automatically included.
    - Create symlinks if missing (`.agents/skills -> ../.claude/skills`).

### Step 8: Leak Detection

13. Verify no project-specific content leaked into the kit repo:

```bash
# Must return empty -- any matches indicate leaked content
grep -ri "flowser\|tRPC\|Prisma\|Supabase\|CloakBrowser\|OpenClaw" CLAUDE.md AGENTS.md

# Must return empty -- no absolute paths
grep -r "/Users/" .
```

14. If leak detection fails:
    - Print the offending lines.
    - Revert the changes in the kit repo (`git -C <kitRepoPath> checkout .`).
    - STOP and report the leak. Do NOT commit or push.

### Step 9: Commit and Tag

15. In the kit repo:

```bash
cd <kitRepoPath>
git add -A
git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
```

### Step 10: Push

16. Push to remote:

```bash
git push origin main && git push --tags
```

17. If push fails (e.g., rejected, auth error), report the error. The commit and tag are preserved locally for retry.

### Step 11: Print Summary

18. Print publish summary:

```
vc-publish complete
===================
Version:       v2.2.0 (was v2.1.0)
Files changed: 4
Remote:        git@github.com:withkynam/vibecode-pro-max-kit.git
Tag:           v2.2.0
```

## Key Changes from v1.0

- **No manifest array maintenance.** The glob patterns in `include`/`exclude`/`kitOnly` are stable. Adding a new skill or agent requires zero manifest edits. The only manifest change at publish time is the version bump.
- **Resolver-driven diffing.** Both repos are resolved through the same `resolve-manifest.mjs` script, ensuring consistent file sets.
- **No `managed`/`managedDirs` arrays to update.** The old workflow of adding new files to these arrays is eliminated.

## Rules

- **ALWAYS** run the full resolver diff (Steps 3-4) even when changes already exist in the kit repo. Direct kit edits (README, translations, community files) do not replace the dev→kit diff. Both change sources must be captured in the same publish.
- **NEVER** copy project-specific files: `process/context/all-context.md` (with real content), `process/features/*`, `process/general-plans/*` (with real plans)
- **ALWAYS** verify no project-specific content leaked before committing (Step 8)
- **ALWAYS** show the diff summary before publishing (Step 5-6)
- CLAUDE.md and AGENTS.md require special handling -- never copy the development repo's project-specific versions directly
- Kit repo checkout path is stored in `.vc-publish-config` (add to `.gitignore`)
- The only manifest edit at publish time is the version bump -- glob patterns are stable

## Reference

See `references/vc-publish.md` for the detailed algorithm, CLAUDE.md/AGENTS.md stripping rules, error handling, and example outputs.
