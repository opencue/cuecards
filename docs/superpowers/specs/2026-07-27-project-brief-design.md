# Project brief — verified repo facts for the agent

Status: approved 2026-07-27.

## Problem

A cue profile tells the agent what Medusa/Rust/Next.js *are*. It says nothing
about the directory the session actually runs in: which package manager, what
the test command is, where the entry points live. The agent guesses `npm test`
in a `bun` repo and burns turns finding out.

Measured on the existing catalogue (85 profiles): persona 71, playbooks 16,
rules 6, qualityGates 1, persona_routing 0. The mechanisms are there; what is
missing is per-repo truth, which no profile can carry.

## Constraint that shapes the design

The runtime is keyed by profile selector — `~/.config/cue/runtime/<selector>/`
— and the materialization hash covers the resolved profile and agent, not the
cwd. Repo-specific text written into that shared `CLAUDE.md` would leak into
every other directory using the same profile, and parallel sessions (the fleet)
would overwrite each other. **The brief must therefore be delivered per
process, never through the shared runtime file.**

## Design

### 1. Scanner — `src/lib/project-brief.ts`

`scanBrief(cwd, probe?) → ProjectBrief | null`, pure apart from an injectable
filesystem probe. Verified facts only:

| Field | Source |
|---|---|
| package manager | lockfile (`bun.lock`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `Cargo.lock`, `uv.lock`, `poetry.lock`) |
| test / build / lint / typecheck / dev | `package.json` scripts, `Makefile` targets, `justfile` recipes, Cargo, `pyproject.toml` |
| entry points | `bin`/`main`, `src/index.*`, `src/main.rs`, `main.go`, `cmd/*/main.go`, `manage.py` |
| layout | top-level directories, noise filtered, capped |
| workspaces | `workspaces`, `pnpm-workspace.yaml`, `turbo.json`, Cargo `[workspace]` |
| data layer | Prisma, Drizzle, Alembic, Medusa, Supabase config files |
| what CI runs | `run:` lines in `.github/workflows/*.yml`, filtered to test/build/lint verbs |
| default branch | `.git/refs/remotes/origin/HEAD` |
| env | whether `.env.example` exists — **values are never read** |

Returns `null` when the directory has neither a manifest nor a `.git` — no
brief is better than a brief about nothing.

`renderBrief(brief, {maxChars})` produces the markdown block, capped at ~1.5 KB
with explicit truncation.

### 2. Delivery

- **claude-code**: `--append-system-prompt "<brief>"` prepended to the
  passthrough args. Per process, race-free, guaranteed in context.
- **codex**: no equivalent flag. The brief is written to
  `<configDir>/briefs/<cwd-hash>.md`, exported as `CUE_PROJECT_BRIEF`, and the
  materialized `AGENTS.md` carries one **static** line pointing at it. Static
  text keeps the shared file identical across directories, so nothing leaks and
  the materialization hash is unaffected.

### 3. `.cue/project.md` — opt-in

Never written automatically. `cue brief --write` creates it:

```
<!-- cue:generated — do not edit below -->
…machine block…
<!-- /cue:generated -->

## Notes
- anything the scanner cannot infer
```

Re-running rewrites only the generated block; the notes survive. When the file
exists, its notes are appended to the injected brief.

### 4. Command

`cue brief` prints what the agent would receive. `--write` persists the file,
`--json` emits the structured scan. `CUE_BRIEF=0` disables injection entirely.

### 5. Failure and size

Every scan step is individually `try/catch`-ed; any failure drops that field,
and a total failure drops the brief — the launch never blocks on it. The block
is capped so it cannot meaningfully move the memory-file budget.

### 6. Testing

`project-brief.test.ts` drives the scanner through a stub probe: bun / pnpm /
cargo / python / monorepo fixtures, command extraction from all four manifest
kinds, layout noise filtering, caps and truncation, `null` without a manifest,
and an assertion that `.env` is never read. Separate tests cover the brief-file
merge (notes preserved, idempotent rewrite, missing markers) and the launch
arg/env wiring per agent.

Out of scope: inferred conventions, LLM-written summaries, writing into the
repo's own CLAUDE.md/AGENTS.md, and compacting the 44 KB persona pile.
