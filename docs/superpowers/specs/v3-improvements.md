# cue v3 — Intelligence & Workflow Improvements (#9–#22)

> Design doc for 14 improvements: analytics, scoring, templates, auto-detect,
> versioning, diff, preview, snapshot, why, conflicts, locking, lazy MCPs,
> skill packs, and init wizard.
>
> Status: **implementing**
> Depends on: v2-improvements.md (features #1–#8)

---

## 9. Profile Analytics / Usage Dashboard

**Goal:** Track profile usage patterns to inform pruning and optimization.

### Data Model

```typescript
// ~/.config/cue/analytics.jsonl — append-only log
interface SessionEvent {
  ts: string;           // ISO timestamp
  event: "start" | "end";
  profile: string;
  agent: "claude-code" | "codex";
  cwd: string;
  duration_s?: number;  // only on "end" events
}
```

### Commands

```
cue stats                    → summary: sessions/profile, avg duration, last used
cue stats --profile backend  → detailed stats for one profile
cue stats --since 7d         → last 7 days only
cue stats --json             → machine-readable
```

### Implementation

- `src/lib/analytics.ts` — append/query the JSONL log
- `src/commands/stats.ts` — CLI command
- Hook into `launch.ts`: write "start" event before exec, register a cleanup handler for "end"
- The "end" event uses `process.on("exit")` in the shim or a `.cue-session` lockfile with mtime

---

## 10. Skill Effectiveness Scoring

**Goal:** Identify dead skills that never get triggered.

### Mechanism

Claude Code writes session transcripts to `~/.claude/projects/*/sessions/`. After a session ends, scan the transcript for skill references (skill names, slash commands, or tool calls that map to skills).

### Commands

```
cue skills audit                    → report unused skills per profile
cue skills audit --profile backend  → one profile
cue skills audit --threshold 5      → "unused" = <5 references in last 20 sessions
```

### Output

```
Profile "backend" — skill usage (last 20 sessions):
  ✅ review/code-review         — 14 references
  ✅ github/gh-fix-ci           — 8 references
  ⚠️  stripe/stripe-webhooks    — 1 reference
  ❌ deployment/supabase        — 0 references (candidate for removal)
```

### Implementation

- `src/lib/skill-scorer.ts` — scan session transcripts for skill mentions
- `src/commands/skills.ts` — add `audit` subcommand
- Heuristic: match skill slug, SKILL.md description keywords, and slash-command names

---

## 11. Profile Templates / Team Import

**Goal:** Share profile configurations across teams via URL or git repo.

### Commands

```
cue import https://github.com/acme/cue-profiles/backend.yaml
cue import ./shared/team-profile.yaml
cue import acme/cue-profiles          → shorthand for GitHub repo
cue export backend --output ./share/  → export a profile as portable YAML
```

### Import Resolution

1. Fetch the YAML (URL, local path, or `org/repo` → GitHub raw)
2. Validate against profile schema
3. Resolve skill references: if skills reference a remote repo, add as `skills.npx`
4. Write to `profiles/<name>/profile.yaml`
5. Prompt: "Pin to current directory?"

### Portable Format

Exported profiles include a `_portable` section:

```yaml
name: acme-backend
description: ACME backend team standard loadout
_portable:
  skills_source: "https://github.com/acme/skills"
  pin: "tag@v2.0.0"
skills:
  npx:
    - repo: acme/skills
      pin: tag@v2.0.0
      skills: [api-standards, db-migrations, ci-pipeline]
mcps: []
```

### Implementation

- `src/commands/import-profile.ts`
- `src/commands/export-profile.ts`

---

## 12. Context-Aware Auto-Profile (Smart Resolve)

**Goal:** Automatically suggest/select profiles based on project structure.

### Detection Rules

| Signal | Profile suggestion |
|---|---|
| `package.json` + `next.config.*` or `vite.config.*` | frontend |
| `docker-compose.yml` + `migrations/` or `prisma/` | backend |
| `content/` + `astro.config.*` or `docusaurus.config.*` | docs-writer |
| `medusa-config.*` or `packages/medusa/` | medusa-dev |
| `.colony/` or `.omx/` | fleet-control |
| `Dockerfile` + `k8s/` or `helm/` | backend (devops variant) |
| `figma.config.*` or `design-tokens/` | creative-media |

### Commands

```
cue auto-detect              → print what would be picked and why
cue auto-detect --apply      → write .cue.profile with the detected profile
cue config set auto-detect true  → enable as fallback in resolve chain
```

### Resolve Chain (updated)

1. `--cue-profile` flag (explicit override)
2. `.cue.profile` file (walk up to $HOME)
3. **Auto-detect** (if enabled) — scan cwd for signals
4. Global default (`~/.config/cue/default-profile`)
5. TUI picker

### Implementation

- `src/lib/auto-detect.ts` — rule engine with weighted scoring
- Integrate into `cwd-resolver.ts` as a fallback step
- `src/commands/auto-detect.ts` — standalone command

---

## 13. Skill Versioning & Changelog

**Goal:** Track skill evolution and warn on breaking changes.

### SKILL.md Frontmatter Extension

```yaml
---
description: "Structured code review with checklist"
version: 2.1.0
changelog:
  - "2.1.0: Added streaming output support"
  - "2.0.0: Breaking — new structured output format"
  - "1.0.0: Initial release"
---
```

### Behavior

- `cue skills changelog <id>` — print the changelog
- On materialize: if a skill's version changed since last build, print a one-line notice:
  ```
  ℹ️  review/code-review updated: 2.0.0 → 2.1.0 (Added streaming output support)
  ```
- Version stored in `.cue-hash` metadata so we can detect bumps

### Implementation

- Extend `parseSkillMeta()` in `skills.ts` to read `version` and `changelog`
- `src/lib/skill-version-tracker.ts` — stores last-seen versions in `~/.config/cue/skill-versions.json`
- Hook into materializer to compare and warn

---

## 14. Profile Diff / Compare

**Goal:** Show exactly what differs between two profiles.

### Command

```
cue diff backend frontend
cue diff backend frontend --json
```

### Output

```
Comparing: backend ↔ frontend

Skills:
  + design/ui-ux-pro-max        (only in frontend)
  + design/responsive-layout    (only in frontend)
  - review/security-review      (only in backend)
  - stripe/stripe-webhooks      (only in backend)
  = review/code-review          (in both)

MCPs:
  + playwright                  (only in frontend)
  - coolify                     (only in backend)

Plugins:
  (identical)

Env:
  - MEDUSA_DEV=1                (only in backend)
```

### Implementation

- `src/commands/diff.ts` — load both profiles, set-diff each section

---

## 15. Dry-Run Preview for Profile Changes

**Goal:** Show impact before committing skill/MCP changes.

### Commands

```
cue skills add-to-profile design/ui-ux --preview
cue mcps add playwright --preview
```

### Output

```
Preview: adding "design/ui-ux-pro-max" to profile "backend"

Changes:
  + 1 skill (design/ui-ux-pro-max)
  + 0 MCPs (no requires_mcps)
  ~ CLAUDE.md: +0 bytes (no profile-specific claude-md layer)
  ~ Estimated token impact: +~150 tokens in system prompt

Apply? [y/N]
```

### Implementation

- Add `--preview` flag to `skills add-to-profile` and `mcps add`
- Compute diff without writing, show summary, prompt for confirmation

---

## 16. Session Snapshot / Handoff

**Goal:** Export the current effective state as a portable artifact.

### Commands

```
cue snapshot                         → print to stdout
cue snapshot --output ./handoff.yaml → write to file
cue restore ./handoff.yaml           → recreate the exact profile state
```

### Snapshot Format

```yaml
_snapshot:
  created: "2026-05-23T14:00:00Z"
  profile: backend
  agent: claude-code
  cwd: /home/user/project
  cue_version: "0.2.0"
  hash: "abc123..."
profile:
  name: backend
  description: "APIs, webhooks, security..."
  skills:
    local: [review/code-review, review/security-review, ...]
  mcps: [coolify, codegraph]
  plugins: [claude-mem]
  env: { MEDUSA_DEV: "1" }
effective_claude_md: |
  <!-- cue: profile=backend icon=🐻 -->
  # Active Profile: 🐻 backend
  ...
```

### Implementation

- `src/commands/snapshot.ts` — serialize resolved profile + effective CLAUDE.md
- `src/commands/restore.ts` — deserialize and write profile.yaml + pin

---

## 17. `cue why` — Trace Resource Origin

**Goal:** Explain why a specific skill/MCP/plugin is loaded.

### Command

```
cue why colony
cue why review/code-review
cue why claude-mem
```

### Output

```
MCP "colony" is loaded because:
  Profile: fleet-control
  Declared in: profiles/fleet-control/profile.yaml (line 12)
  Inheritance: core → fleet-control
  Source config: resources/mcps/configs/claude_runtime.sanitized.json

Skill "review/code-review" is loaded because:
  Profile: backend
  Declared in: profiles/backend/profile.yaml (line 8)
  Inherited from: (direct, not inherited)
  Disk path: resources/skills/skills/review/code-review/
```

### Implementation

- `src/commands/why.ts` — load active profile, walk inheritance chain, find where the resource was introduced

---

## 18. Skill Conflict Detection

**Goal:** Warn when two skills give contradictory guidance.

### Mechanism

Parse each skill's `description` and body for directive keywords. Flag pairs where:
- Both target the same domain (CSS, testing, architecture)
- They give opposing directives ("always use X" vs "never use X")

### Heuristic Rules

1. Extract directive phrases: "always", "never", "prefer", "avoid", "use X over Y"
2. Cluster skills by domain (from tags + category)
3. Within a cluster, flag opposing directives

### Command

```
cue skills conflicts
cue skills conflicts --profile backend
```

### Output

```
⚠️  Potential conflicts in profile "frontend":

  design/tailwind-first vs design/semantic-css
    "Always use Tailwind utility classes" conflicts with
    "Prefer semantic class names over utility classes"
    Resolution: remove one, or scope with agents: field
```

### Implementation

- `src/lib/conflict-detector.ts` — NLP-lite directive extraction + opposition check
- Integrated into `cue validate` as warning W7

---

## 19. Profile Locking

**Goal:** Prevent accidental modification of production/shared profiles.

### Schema Extension

```yaml
name: production
locked: true
locked_by: "team-lead"
locked_reason: "Approved loadout — changes require PR review"
```

### Behavior

- `cue skills add-to-profile X` → error: "Profile 'production' is locked by team-lead"
- `cue mcps add X` → same error
- `cue unlock production` → removes the lock (requires confirmation)
- `cue lock production --by "your-name" --reason "..."` → sets the lock

### Implementation

- Check `locked` field in `skills.ts` and `mcps.ts` before writes
- `src/commands/lock.ts` — lock/unlock commands
- `cue validate` reports locked profiles as info (not error)

---

## 20. MCP Lazy-Start Flag

**Goal:** Reduce cold-start RAM by deferring expensive MCPs.

### Schema Extension

```yaml
mcps:
  - id: colony
    lazy: true
  - id: codegraph
    # lazy defaults to false — started immediately
```

### Behavior

- At materialize time: MCPs with `lazy: true` are written to `settings.json` with a wrapper command that starts the real MCP only on first tool call
- The wrapper is a tiny script: `~/.config/cue/lazy-mcp-wrapper.sh <real-command> <args...>`
- On first invocation, it starts the real process and proxies stdio
- Subsequent calls reuse the running process

### Implementation

- `src/lib/lazy-mcp-wrapper.sh` — the wrapper script (generated at materialize time)
- Modify `runtime-materializer.ts` to emit wrapped commands for lazy MCPs
- Extend `ResolvedMCP` type with `lazy?: boolean`

---

## 21. Skill Packs (Grouped Skill Bundles)

**Goal:** Name a group of related skills for easy reuse across profiles.

### Pack Definition

```yaml
# resources/skill-packs/security-review.yaml
name: security-review
description: "Full security review suite"
skills:
  - review/security-review
  - review/security-best-practices
  - review/code-review
requires_mcps: []
tags: [security, review]
```

### Profile Usage

```yaml
# profiles/backend/profile.yaml
name: backend
packs:
  - security-review
  - deployment-suite
skills:
  local:
    - stripe/stripe-webhooks  # additional individual skills
```

### Resolution

Packs are expanded at profile-load time (before inheritance merge):
- `packs: [security-review]` → appends all pack skills to `skills.local`
- Pack `requires_mcps` are merged into profile `mcps`
- Duplicate skills are deduped

### Commands

```
cue packs list                → list available packs
cue packs show security-review → show pack contents
cue packs create <name>       → interactive pack creation
```

### Implementation

- `resources/skill-packs/` directory with YAML files
- `src/lib/pack-resolver.ts` — load and expand packs
- Hook into `profile-loader.ts` to expand packs before inheritance
- `src/commands/packs.ts` — CLI commands

---

## 22. `cue init` — Project Scanner + Profile Wizard

**Goal:** One command to set up cue in any project directory.

### Command

```bash
cd ~/new-project && cue init
```

### Flow

1. **Scan** — detect project signals (package.json, Dockerfile, etc.)
2. **Score** — rank existing profiles by match percentage
3. **Present** — show top 3 matches with confidence:
   ```
   Detected: TypeScript, Next.js, Prisma, Tailwind

   Suggested profiles:
     1. frontend  (92% match) — UI implementation, redesign
     2. backend   (68% match) — APIs, webhooks, security
     3. full      (50% match) — diagnostic, everything

   Pick [1-3], or 'n' for new profile, or 'skip':
   ```
4. **Pin** — write `.cue.profile` with the chosen profile
5. **Optional** — offer to create a new profile if no good match

### Detection Signals (weighted)

| Signal | Weight | Suggests |
|---|---|---|
| `next.config.*` | 5 | frontend |
| `vite.config.*` | 4 | frontend |
| `tailwind.config.*` | 3 | frontend |
| `prisma/schema.prisma` | 4 | backend |
| `docker-compose.yml` | 3 | backend |
| `medusa-config.*` | 5 | medusa-dev |
| `content/` + static site config | 4 | docs-writer |
| `.colony/` | 5 | fleet-control |
| `package.json` scripts.test | 2 | (any dev profile) |

### Implementation

- `src/lib/project-scanner.ts` — file detection + scoring
- `src/commands/init.ts` — wizard flow using @clack/prompts
- Reuses `auto-detect.ts` rules from #12

---

## File Changes Summary

| New | Path |
|---|---|
| New | `docs/superpowers/specs/v3-improvements.md` (this doc) |
| New | `src/lib/analytics.ts` |
| New | `src/lib/skill-scorer.ts` |
| New | `src/lib/auto-detect.ts` |
| New | `src/lib/skill-version-tracker.ts` |
| New | `src/lib/conflict-detector.ts` |
| New | `src/lib/pack-resolver.ts` |
| New | `src/lib/project-scanner.ts` |
| New | `src/lib/lazy-mcp-wrapper.sh` |
| New | `src/commands/stats.ts` |
| New | `src/commands/import-profile.ts` |
| New | `src/commands/export-profile.ts` |
| New | `src/commands/auto-detect.ts` |
| New | `src/commands/diff.ts` |
| New | `src/commands/snapshot.ts` |
| New | `src/commands/restore.ts` |
| New | `src/commands/why.ts` |
| New | `src/commands/lock.ts` |
| New | `src/commands/packs.ts` |
| New | `src/commands/init.ts` |
| New | `resources/skill-packs/` directory |
| Modified | `src/commands/skills.ts` (audit subcommand, --preview, conflicts) |
| Modified | `src/commands/mcps.ts` (--preview) |
| Modified | `src/commands/launch.ts` (analytics hook, lazy MCP, auto-detect) |
| Modified | `src/commands/_index.ts` (register all new commands) |
| Modified | `src/lib/profile-loader.ts` (pack expansion, locked field) |
| Modified | `src/lib/runtime-materializer.ts` (version tracking, lazy wrapper) |
| Modified | `src/lib/cwd-resolver.ts` (auto-detect fallback) |
| Modified | `profiles/_types.ts` (locked, packs, lazy fields) |
| Modified | `profiles/schema.json` (new fields) |
