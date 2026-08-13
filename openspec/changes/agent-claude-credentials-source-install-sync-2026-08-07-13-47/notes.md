# agent-claude-credentials-source-install-sync-2026-08-07-13-47 (minimal / T1)

Branch: `agent/claude/credentials-source-install-sync-2026-08-07-13-47`

Completes #139, whose review raised a HIGH that its own merge did not carry.

## The HIGH

#139 made the self-overlay guard opt-in via `options.runtimeDir`. `launch.ts`
passes it; `cue install` and `cue sync` do not — and both rebuild runtimes
through `prepareRuntime()`. So either command run from inside a cue session
still took `CLAUDE_CONFIG_DIR` — its own runtime dir — as the overlay source and
reproduced #137's self-referential symlinks. The guard was off exactly where the
materialization happens.

Both callers now pass the dir they are about to write:

- `install.ts` — `runtimeDirFor(profile.name, agent)`, matching
  `prepareRuntime`'s own `runtimeKey ?? profile.name` default.
- `sync.ts` — `runtimeDirFor(key, agent)`; `key` is already the `runtimeKey`
  passed to `prepareRuntime` two lines below.

## Why it is a separate PR

The fix was committed on #139's branch as `91c6601d` but never reached the
remote before the PR merged — main got only the narrowing commit. Verified after
the fact on `origin/main`: `isSelfOverlaySource` present (3 hits), `runtimeDir:`
in install.ts / sync.ts absent (0). Cherry-picked here onto the post-#139 main.

## Also carried

The comment on #139's LOW finding, explaining why the wiring test asserts
`not.toBe(target)` rather than a concrete fall-through path: `os.homedir()`
reads the passwd entry, not `$HOME`, so a temp-HOME fixture does not pin the
branch (measured — it still resolved the real `~/.claude`). No fall-through
branch can return the target, so the assertion holds on any machine and stays
mutation-proof.

## Verification

- `bun run typecheck` — clean.
- `bun run lint` — warnings pre-existing; zero in the touched files.
- `bun test src/lib/runtime-install.test.ts` — 23 pass / 0 fail.
- `bun test` (full), branch vs base in the same worktree and shell — failing set
  compared both directions.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/claude/credentials-source-install-sync-2026-08-07-13-47 --base main --via-pr --gate-review --review-provider claude --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
