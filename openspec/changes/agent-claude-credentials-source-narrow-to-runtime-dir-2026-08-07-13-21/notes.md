# agent-claude-credentials-source-narrow-to-runtime-dir-2026-08-07-13-21 (minimal / T1)

Branch: `agent/claude/credentials-source-narrow-to-runtime-dir-2026-08-07-13-21`

Follow-up to #137, addressing both of its review findings.

## The regression #137 introduced (MEDIUM)

#137 refused *any* `CLAUDE_CONFIG_DIR` under cue's runtime tree. That is wider
than the bug it fixed. The corruption needs `source === the dir being rebuilt`;
under an authmux account the two differ:

- outer session: `CLAUDE_CONFIG_DIR=~/.claude-accounts/account2` → `accountTag=account2`
  → child execs with `CLAUDE_CONFIG_DIR=<runtime>/<profile>@account2/claude`
- nested launch: `authmuxAccountTag()` returns undefined for a runtime path, so
  `runtimeKey` is the bare profile and the target is `<runtime>/<profile>/claude`

Source ≠ target, so that overlay was never the self-overlay case — and it is the
only thing carrying account2's credentials into the child. #137's broad guard
rejected it and fell back to `~/.claude`, silently running the nested agent as
account1. Reproduced against `main`: `B authmux run (main) -> /home/deadpool/.claude`.

## Change

Narrow the guard to the dir this launch will actually write, per the reviewer's
option (a):

- `isSelfOverlaySource(dir, runtimeDir)` replaces `isCueRuntimeDir` — an exact
  resolved-path comparison, not a subtree test.
- `pickClaudeCredentialsSource({ runtimeDir })` / `resolveClaudeCredentialsSource({ runtimeDir })`
  take the target dir; callers that are not rebuilding a runtime omit it and
  keep the plain `CLAUDE_CONFIG_DIR` answer.
- `launch.ts` resolves `accountTag` / `runtimeKey` **before** the credentials
  source (a pure reorder — `authmuxAccountTag(ccd, homedir())` never depended on
  it) and passes `runtimeDirFor(runtimeKey, "claude-code")`.

## The untested-wiring finding (LOW)

#137's tests all targeted the pure predicate, so deleting the guard kept them
green. Added a `pickClaudeCredentialsSource` describe block that manipulates
`CLAUDE_CONFIG_DIR` and asserts the four real outcomes. Mutation-checked:
replacing the guarded return with `if (envConfigDir) return envConfigDir;` fails
`refuses CLAUDE_CONFIG_DIR when it is the dir being rebuilt` (22 pass / 1 fail),
and restoring it goes back to 23/0.

## Verification

- `bun run typecheck` — clean.
- `bun run lint` — 6 warnings, all pre-existing; zero in the touched files.
- `bun test src/lib/runtime-install.test.ts` — 23 pass / 0 fail.
- `bun test` (full), branch vs base in the same worktree and shell: 33 fail on
  both, failing sets **byte-identical** (`comm` both directions empty).
- Behavioural probe against the real resolver, `XDG_CONFIG_HOME=/tmp/probe-cfg`:

  | scenario | `CLAUDE_CONFIG_DIR` | result |
  | --- | --- | --- |
  | A self-overlay | `<root>/core/claude` (== target) | `~/.claude` — the #137 fix, preserved |
  | B authmux nested | `<root>/core@account2/claude` | `<root>/core@account2/claude` — regression undone (`~/.claude` on main) |
  | C authmux dir | `~/.claude-account2` | `~/.claude-account2` — unchanged |

## Notes

Cleared an abandoned lane to take the `src/commands/launch.ts` lock: worktree
`cue__claude__launch-nested-nontty-profile-2026-08-07-11-58` had no process, no
unpushed commits, its content already squash-merged as #132, and only the
deliberately-unstaged `resources/skills` gitlink dirty. `gx locks reap` does not
clear it (168h TTL), so the worktree + branch were pruned — the cleanup its own
notes.md prescribed and never ran.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/claude/credentials-source-narrow-to-runtime-dir-2026-08-07-13-21 --base main --via-pr --gate-review --review-provider claude --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
