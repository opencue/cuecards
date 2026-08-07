# agent-claude-launch-nested-nontty-profile-2026-08-07-11-58 (minimal / T1)

Branch: `agent/claude/launch-nested-nontty-profile-2026-08-07-11-58`

A nested non-interactive `claude -p …` spawned from inside a cue session died
with `cue launch: no profile resolved and stdin is not a TTY`.

Cause: cue relocates `CLAUDE_CONFIG_DIR` to the per-profile runtime dir when it
launches an agent (`~/.config/cue/runtime/<profile>/claude`). `launch.ts`
treated any non-`~/.claude` config dir as an *account alias* and forced the
picker — with no TTY guard, unlike the neighbouring `CUE_ALWAYS_PICK` branch.
So every child of a cue session force-picked, found no TTY, and exited 1.

This is the same class of bug `launchDepth` already fixed for `CUE_LAUNCHING`
— its doc comment names "an AI code review" as the motivating nested launch —
and it had the same symptom of callers hand-stripping the env var to work
around it (`failures.ts:349-353`, and the `launch.e2e.test.ts` harness, whose
comment spells out `CLAUDE_CONFIG_DIR=... → triggers isAccountAlias → forces
picker → fails on non-TTY`).

Two changes, both as exported pure helpers so they are testable (matching
`isAlwaysPickEnabled` / `launchDepth` / `authmuxAccountTag`):

- `shouldForcePicker(...)` — `--cue-pick` still always wins; every other
  trigger (`CUE_ALWAYS_PICK`, account alias) now requires a TTY. Also collapses
  the duplicated `!override && isTTY` conditions into one place.
- `shouldInheritSessionProfile(...)` — off a TTY with nothing resolved, fall
  back to the running session's profile via the existing
  `detectActiveProfile()` (`CUE_PROFILE`, else the runtime path inside
  `CLAUDE_CONFIG_DIR`) instead of exiting 1. A cwd pin / repo-default /
  global-default still wins; `--cue-pick` deliberately opts out, since a picker
  that cannot open is a real error.

Real-world trigger: gitguardex's `gx branch finish --gate-review
--review-provider claude` could not run its AI review from inside a cue
session, which blocks the repo's fail-closed merge gate.

## Verification

- `bun run typecheck` — clean.
- `bun run lint` — 7 warnings, all pre-existing; none in the touched files.
- `bun test src/commands/launch.parse.test.ts` — 23 pass / 0 fail (9 new
  assertions covering both helpers, including the `--cue-pick` carve-out).
- `bun test` (full) — 3088 pass / 9 fail. The same 9 fail with the two touched
  files reverted to base, i.e. the failing set is byte-identical to baseline
  (all `addMcpToProfile` / `loadMcpCatalog` / `quickDiagnose` — MCP catalog,
  unrelated). Zero new failures.
- End-to-end reproduction of the original bug, non-TTY inside a cue session:
  - before: `echo "" | claude -p "…"` → `cue launch: no profile resolved and
    stdin is not a TTY`
  - after: `echo "" | <worktree>/bin/cue launch claude -p "Reply with exactly:
    OK"` → resolves `hostinger+medusa-vite+gstack+core+coolify+commerce` and
    prints `OK`.

## Handoff

- Handoff: change=`agent-claude-launch-nested-nontty-profile-2026-08-07-11-58`; branch=`agent/claude/launch-nested-nontty-profile-2026-08-07-11-58`; scope=`src/commands/launch.ts, src/commands/launch.parse.test.ts`; action=`continue this sandbox or finish cleanup after a usage-limit/manual takeover`.
- Copy prompt: Continue `agent-claude-launch-nested-nontty-profile-2026-08-07-11-58` on branch `agent/claude/launch-nested-nontty-profile-2026-08-07-11-58`. Work inside the existing sandbox, review `openspec/changes/agent-claude-launch-nested-nontty-profile-2026-08-07-11-58/notes.md`, continue from the current state instead of creating a new sandbox.
- Note: `resources/skills` shows dirty in this worktree — the submodule's own
  `agent-primary-branch-guard` hook checks it out to its `main` (a2bfa15) on
  every `git submodule update`, ahead of the recorded gitlink (752aef4). It is
  deliberately NOT staged; do not commit that pointer bump here.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/claude/launch-nested-nontty-profile-2026-08-07-11-58 --base main --via-pr --gate-review --review-provider claude --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
