# vc-update Reference

Detailed reference for the vc-update skill.

## vc-manifest.json Schema Reference (v2.1.0)

The manifest uses glob-based patterns resolved by `resolve-manifest.mjs`.

```json
{
  "version": "2.1.0",
  "include": [
    ".claude/agents/**",
    ".claude/skills/**",
    ".claude/skills/**/.??*",
    ".claude/hooks/**",
    ".claude/settings.json",
    ".codex/**",
    "CLAUDE.md",
    "AGENTS.md",
    "process/development-protocols/**",
    "process/context/planning/example-*.md",
    "process/_seeds/**",
    "process/_seeds/**/.gitkeep",
    "process/_seeds/**/.gitignore",
    "process/_seeds/**/.env.example"
  ],
  "exclude": [
    "process/context/all-context.md",
    "process/features/**",
    "process/general-plans/**",
    "**/.git/**",
    "**/.logs/**",
    ".codex/statusline.cjs",
    ".claude/skills/vc-chrome-devtools/scripts/node_modules/**"
  ],
  "strip": ["CLAUDE.md", "AGENTS.md"],
  "merge": [".claude/settings.json"],
  "copyIfMissing": ["process/context/planning/example-*.md"],
  "symlinks": { ".agents/skills": "../.claude/skills" },
  "kitOnly": [
    "README.md", "README-preview*.html", "CONTRIBUTING.md", "SECURITY.md",
    "TRADEMARK.md", "LICENSE", "docs/**", "assets/**", ".github/**",
    "resolve-manifest.mjs", "install.sh"
  ]
}
```

### Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `version` | string | Semver version of this release. >= 2.1.0 means glob format. |
| `include` | string[] | Glob patterns for files managed by the kit. Resolved against the kit repo root. |
| `exclude` | string[] | Glob patterns to exclude from include matches. Post-filtered by the resolver. |
| `strip` | string[] | Files needing project-specific content stripped at publish time. Informational for vc-update. |
| `merge` | string[] | Files where user customizations are preserved (not overwritten on update). |
| `copyIfMissing` | string[] | Glob patterns for files only installed if they don't already exist locally. |
| `symlinks` | object | Symlink path -> target mappings to create/verify. |
| `kitOnly` | string[] | Glob patterns for files in the kit repo but NOT installed into user projects. |

### Legacy Schema (v2.0.x)

Old manifests use explicit file lists instead of glob patterns:

| Field | Type | Description |
|-------|------|-------------|
| `version` | string | Semver version (< 2.1.0) |
| `managed` | string[] | Individual files overwritten on update |
| `managedDirs` | string[] | Directories synced entirely (rsync-style replace) |
| `seedsDir` | string | Path to seeds directory (always `process/_seeds/`) |
| `symlinks` | object | Symlink path -> target mappings |
| `deletions` | string[] | Paths to delete (accumulated across versions) |

The resolver handles both formats transparently. If version >= 2.1.0, it uses glob resolution. Otherwise, it falls back to explicit list resolution.

## resolve-manifest.mjs

The resolver script lives at the kit repo root (NOT installed into user projects). It is called from the cloned temp directory during updates.

```bash
# Default: newline-separated file list
node "$TMPDIR/resolve-manifest.mjs" --root "$TMPDIR"

# Full JSON output with metadata
node "$TMPDIR/resolve-manifest.mjs" --root "$TMPDIR" --json

# Only kit-exclusive files (for publish exclusion)
node "$TMPDIR/resolve-manifest.mjs" --root "$TMPDIR" --kit-only
```

### --json Output Shape

```json
{
  "files": ["...sorted managed file paths..."],
  "kitOnly": ["...sorted kit-exclusive file paths..."],
  "merge": [".claude/settings.json"],
  "copyIfMissing": ["process/context/planning/example-simple-prd.md", "process/context/planning/example-complex-prd.md"],
  "strip": ["CLAUDE.md", "AGENTS.md"],
  "symlinks": { ".agents/skills": "../.claude/skills" }
}
```

## .vc-installed-files

A snapshot file written to the user project root after each install/update. Contains one relative file path per line, sorted alphabetically.

**Purpose:** Enables automatic deletion detection. When vc-update runs, it compares the new resolved file list against this snapshot to find files that should be deleted (present in snapshot but absent from new resolution).

**Example:**
```
.claude/agents/vc-code-reviewer.md
.claude/agents/vc-debugger.md
.claude/hooks/descriptive-name.cjs
.claude/settings.json
...
```

**Gitignore:** This file is local state and should be added to `.gitignore`.

## Error Handling Matrix

| Error | When | Action |
|-------|------|--------|
| Network failure during clone | Step 3 | Print error, clean up temp dir, stop |
| GitHub auth failure | Step 3 | Print "check SSH keys or HTTPS token", clean up, stop |
| Repo not found (404) | Step 3 | Print "remote repo not found, check URL in SKILL.md", clean up, stop |
| Resolver script missing | Step 4 | Fall back to legacy manifest parsing (managed/managedDirs) |
| Resolver script fails | Step 4 | Print error, suggest checking Node.js version (>= 22), clean up, stop |
| Malformed vc-manifest.json | Step 4 | Print JSON parse error, clean up, stop |
| Missing vc-manifest.json | Step 4 | Print "vc-manifest.json not found in remote", clean up, stop |
| .vc-version missing | Step 2 | Not an error -- treat as `0.0.0` (first update) |
| .vc-installed-files missing | Step 6 | Build synthetic snapshot from current filesystem, proceed |
| Permission denied on copy | Step 10 | Print which file, suggest `chmod`, **continue** with remaining |
| Permission denied on delete | Step 10 | Print which file, suggest `chmod`, **continue** |
| Symlink creation fails | Step 10 | Print error, suggest checking if target exists, **continue** |

## Edge Cases

### User modified a managed file locally

vc-update **overwrites** managed files without checking for local modifications (except `merge` and `copyIfMissing` files). This is by design -- managed files are owned by the harness. The dry-run shows exactly what will change, giving the user a chance to back out.

If the user has intentional local changes to a managed file:
1. Copy their changes to a separate file before running vc-update
2. Re-apply after the update
3. Or better: move customizations to `process/context/` where they belong

### Merge files (.claude/settings.json)

Files in the `merge` list are NEVER overwritten if they exist locally. The dry-run shows the diff so the user can manually reconcile. On fresh install (no existing file), the kit version is installed.

### Copy-if-missing files (example PRDs)

Files in the `copyIfMissing` list are only installed if they don't already exist locally. This prevents overwriting user-customized planning examples while still providing them on fresh install.

### First update with v2.1.0 (no .vc-installed-files)

Users upgrading from v2.0.x have no `.vc-installed-files` snapshot. The algorithm:
1. Builds a synthetic snapshot from the local filesystem (files matching the remote file list that exist locally).
2. Applies legacy deletions from v2.0.4 (embedded in the resolver).
3. Writes the synthetic snapshot.
4. Proceeds with normal diff logic.

### Remote has new files not in local snapshot

Classified as **additions**. Installed without prompting beyond the dry-run summary.

### Remote removed files that are in local snapshot

Classified as **removals**. Deleted locally after confirmation.

### Already up to date

If `.vc-version` matches the remote manifest version, report "Already up to date" and exit. No diff computed.

### Adding a new skill to the kit

With the glob-based manifest, adding a new skill directory to `.claude/skills/` in the kit requires **zero manifest changes**. The `include` pattern `.claude/skills/**` automatically picks it up.

## Dry-Run Output Format

```
vc-update dry run: v2.0.4 -> v2.1.0

FILES:
  [modified]  CLAUDE.md  (+15 -8)
  [modified]  .claude/agents/vc-execute-agent.md  (+3 -1)
  [new]       .claude/hooks/lib/new-util.cjs
  [removed]   .claude/skills/deprecated-skill/SKILL.md
  [unchanged] AGENTS.md
  ... (42 more unchanged)

MERGE (preserved, manual review needed):
  [differs]   .claude/settings.json  (+2 -1)

COPY-IF-MISSING (skipped, already present):
  [skipped]   process/context/planning/example-simple-prd.md
  [skipped]   process/context/planning/example-complex-prd.md

SYMLINKS:
  [ok]  .agents/skills -> ../.claude/skills

Summary: 5 modified, 2 new, 1 removal, 1 merge skipped, 85 unchanged
```

## Applied Changes Output Format

```
vc-update complete: v2.0.4 -> v2.1.0

Applied:
  3 files modified
  1 file added
  1 file removed
  0 symlinks fixed
  1 merge file preserved (review .claude/settings.json manually)

Snapshot written to .vc-installed-files
Version written to .vc-version: 2.1.0
Temp directory cleaned up.
```

## Backward Compatibility

The resolver script handles both manifest formats:

- **v2.1.0+**: Glob patterns in `include`/`exclude`/`kitOnly`. Resolver uses `fs.globSync` with post-filtering.
- **v2.0.x**: Explicit `managed`/`managedDirs`/`seedsDir` arrays. Resolver walks directories recursively.

If the remote kit doesn't have `resolve-manifest.mjs` (very old version), fall back to the legacy algorithm that reads `managed`/`managedDirs` directly from the manifest JSON.
