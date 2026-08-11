# agent-claude-credentials-source-not-cue-runtime-2026-08-07-13-00 (minimal / T1)

Branch: `agent/claude/credentials-source-not-cue-runtime-2026-08-07-13-00`

A nested `cue launch` of the profile already running destroyed its own runtime
dir: 69 self-referential symlinks (`sessions/`, `projects/`, `history.jsonl`,
`keybindings.json`, `.session-stats.json`, …), every one pointing at its own
path, and a runtime that reported `Not logged in · Please run /login` until the
next launch rewrote `.credentials.json`.

## Cause

`pickClaudeCredentialsSource()` returned `process.env.CLAUDE_CONFIG_DIR`
unconditionally. cue points that variable at `<configDir>/runtime/<profile>/claude`
when it launches an agent, so every process spawned inside a cue session
inherits it — and a nested launch therefore ran with
`credentialsSource === runtimeDir`.

`materializeRuntime()` step 5 (`overlaySourceState`) symlinks every entry cue
does not manage from `credentialsSource` into `tmpDir`. With source == the dir
being rebuilt, each link was written as `<runtimeDir>/<name>`. Step 6 then
renames `tmpDir` onto `runtimeDir` — and every link now points at its own new
path. `.credentials.json` survived only because step 6 explicitly moves it from
the old runtime.

## Change

One guard, as an exported pure helper matching the file's existing style
(`isRuntimeAgent`, `runtimeAgentSubdir`, `runtimeDirFor`):

- `isCueRuntimeDir(dir, runtimeRoot?)` — resolves both sides and tests for the
  root itself or a `root + sep` prefix, so a sibling like `runtime-backup/`
  stays usable.
- `pickClaudeCredentialsSource()` — an explicit `CLAUDE_CONFIG_DIR` still wins
  (that is how authmux hands cue a per-account config), but not when it is
  cue's own runtime dir. Falling through reaches the existing `~/.claude` /
  authmux ladder, i.e. a source outside the dir being rebuilt.

## Verification

- `bun run typecheck` — clean.
- `bun run lint` — 6 warnings, all pre-existing (`ai.ts`, `evolve.ts`,
  `shell.test.ts`, `runtime-materializer.ts`); zero in the touched files.
- `bun test src/lib/runtime-install.test.ts` — 21 pass / 0 fail (8 new).
- `bun test` (full), branch vs base in the same worktree and same shell:
  - branch: 3033 pass / 33 fail / 3112 run
  - base:   3024 pass / 34 fail / 3104 run
  - Failing-set diff: **zero new failures**. The one name that differs
    (`cue score > --all shows all profiles ranked`) passes 2/2 in isolation on
    BOTH branch and base — full-suite flake, not something this change fixed.
    Not claiming it as a fix.
- Behavioural before/after on the real resolver, driven with the exact env a
  nested launch inherits (`XDG_CONFIG_HOME=/tmp/probe-cfg`,
  `CLAUDE_CONFIG_DIR=$XDG_CONFIG_HOME/cue/runtime/some+profile/claude`):
  - before: `nested -> /tmp/probe-cfg/cue/runtime/some+profile/claude` (the
    self-overlay that caused the 69 loops)
  - after:  `nested -> /home/deadpool/.claude`
  - both:   `authmux -> /home/deadpool/.claude-account2` (per-account dir still
    wins, unchanged)

## Notes

Real-world trigger: cue #132 let nested non-TTY launches proceed past the
picker instead of erroring out. That unmasked this — before #132 the nested
launch died before it ever materialized.

The damage on the live profile was repaired out-of-band by re-pointing all 69
loops at their `~/.claude` counterparts; no data was lost, since the loops were
symlinks and every target existed at the source.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/claude/credentials-source-not-cue-runtime-2026-08-07-13-00 --base main --via-pr --gate-review --review-provider claude --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
