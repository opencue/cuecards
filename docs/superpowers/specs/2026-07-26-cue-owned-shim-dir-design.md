# cue-owned shim directory: make a bare `claude` route through cue

**Date:** 2026-07-26
**Status:** Approved (design), pending implementation
**Owner:** cue repo

## Goal

Typing a bare `claude` (or `codex`) in any terminal should go through cue's
resolve → materialize → exec flow, and keep doing so after the native Claude
installer auto-updates.

The mechanism already exists — `cue shell install` writes a shim that calls
`cue launch claude "$@"`. What does not work is *where* it writes that shim.

## The bug this fixes

`cue shell install` writes the shim to `~/.local/bin/claude`. That is the exact
path the native Claude Code installer owns; on a native-install machine it is a
symlink into `~/.local/share/claude/versions/<version>`, and it is frequently
the **only** `claude` on PATH.

Two consequences, both live in the current code:

1. **Install destroys the real binary.** `run(["install"])`
   (`src/commands/shell.ts:182`) overwrites the symlink with no backup and no
   check. Afterwards `findRealClaudeBin()` (`src/lib/claude-binary.ts:26`)
   walks PATH, correctly identifies the only candidate as a cue shim (under
   500 bytes, matches `/cue\s+launch/i`), skips it, and returns `null` — cue
   has nothing left to exec. `cue shell uninstall` cannot recover it, because
   `runUninstall` just `unlink`s the path.

2. **The PATH-order guard is wrong.** `runInstall` defaults `realClaude` to the
   hardcoded `/usr/bin/claude` and compares PATH indices against its parent
   dir. On a native install nothing lives in `/usr/bin`, so the guard passes
   vacuously and the destructive write proceeds.

Two adjacent defects surface from the same area:

3. **`cue shell uninstall` does not exist.** It is documented in
   `docs/shell-install.md`, and `runUninstall` is exported and covered by
   `shell.test.ts`, but it is never wired into `run()`
   (`src/commands/shell.ts:209`) — the subcommand falls through to the usage
   error and returns 1.

4. **The shim does not survive a Claude update.** Even with a backup-and-restore
   scheme, the native installer rewrites `~/.local/bin/claude` on every version
   bump, silently removing the shim and reverting the user to un-cued sessions
   with no signal.

## Approach

Stop contending for `~/.local/bin/<agent>`. Give cue its own shim directory,
`~/.config/cue/shims/`, placed at the front of PATH.

Nothing else writes there, so install is non-destructive, uninstall is a plain
delete with nothing to restore, and the native installer keeps managing
`~/.local/bin/claude` — which is precisely what `findRealClaudeBin()` then
finds behind the shim. A Claude auto-update rewrites only the real binary; the
shim is untouched and the next launch picks up the new version for free.

The cost is one line of shell config, which is what `~/.local/bin` was
implicitly buying by being on PATH already.

### Rejected alternatives

- **Keep `~/.local/bin`, back up the real binary to `claude-real` and record it
  in the shim as `CUE_REAL_CLAUDE`.** Needs no PATH change and works
  immediately, but still loses to the auto-updater on every version bump, so it
  requires an additional self-healing check on top. More moving parts for a
  strictly weaker guarantee.
- **A fish function wrapper (`~/.config/fish/functions/claude.fish`).** Zero
  risk and five minutes of work, but only affects interactive fish — scripts,
  other shells, and subprocesses bypass it entirely. Not a product-level
  answer.

## Architecture

### `src/lib/shim-dir.ts` (new)

Single source of truth for the shim layout. Pure functions; the only I/O is
reading PATH-like inputs the caller passes in.

| Export | Returns |
|---|---|
| `shimDir(homeDir?)` | `~/.config/cue/shims` |
| `shimContent(cueInvoke, agent)` | the bash one-liner for that agent |
| `rcSnippet(shell, dir)` | the PATH line for `fish` \| `bash` \| `zsh` |
| `shimDirPosition(pathDirs, realBin, dir)` | `"before"` \| `"after"` \| `"absent"` |

`shimContent` keeps the literal `launch <agent>` substring that `shimInstalled`
and `findRealAgentBin` both match on, in both the bare-`cue` and absolute-path
invocation forms produced by the existing `resolveCueInvocation()`.

### `src/commands/shell.ts` (rework)

- Shims are written to `shimDir()`.
- Real binaries are located with the existing `findRealAgentBin()` rather than
  a hardcoded `/usr/bin/<agent>` default. A shim is written for each agent
  found; agents not found are skipped and reported.
- **Migration.** If `~/.local/bin/<agent>` exists *and* its content identifies
  it as a cue shim, it is removed — leaving it there would shadow the real
  binary from the new shim dir. If it is anything else, it is left strictly
  alone. Ordering matters: resolve the real binaries and pass the
  "refuse if none found" gate **first**, then write the new shims, then remove
  legacy ones. A failed install must not leave the user with fewer working
  entry points than it started with.
- **RC handling.** fish: create `~/.config/fish/conf.d/cue-shims.fish` if
  absent (a new file, reversible by deletion, so no prompt). bash/zsh: prompt
  before appending to the existing rc. `--yes` skips prompts, `--no-rc` prints
  the line and writes nothing.
- `uninstall` is wired into `run()`. It deletes only the contents of
  `shimDir()` and the fish drop-in cue created. It never touches
  `~/.local/bin`.

### `src/lib/claude-binary.ts` (one guard)

Skip any candidate whose directory is `shimDir()`, in addition to the existing
size + content check. Cheap belt-and-braces so an unexpectedly large shim
cannot cause recursion.

### `shimInstalled()` (widen)

Check `shimDir()` first, then fall back to the legacy `~/.local/bin` path, so
`cue init`'s "profile loading not activated yet" hint stays correct for users
mid-migration.

## Data flow

```
$ claude foo
  → ~/.config/cue/shims/claude              PATH[0]
  → exec cue launch claude foo
  → resolve profile from cwd (.cue.profile)
  → materialize ~/.config/cue/runtime/<profile>
  → findRealClaudeBin() walks PATH, skips shimDir
                        → ~/.local/bin/claude
  → exec real binary
```

## Error handling

| Situation | Behavior |
|---|---|
| `shimDir` absent from PATH | write shims, loud warning + the exact rc line, exit 0 (the caller may be adding it in the same run) |
| `shimDir` on PATH but *after* the real binary | warn that it must move earlier; shims are still written |
| Neither a real claude nor a real codex found | refuse, exit 1, write nothing |
| fish drop-in exists with different content | do not overwrite; print what it would have written |

The third row is the core invariant: **never leave a shim with nothing behind
it.** That is the failure the current code produces. Exiting 0 on the first row
is deliberate — the shims themselves are inert until PATH changes, so writing
them early is safe, whereas the current hard-fail on a bogus PATH comparison
blocks a correct install.

## Testing

`src/commands/shell.test.ts` is reworked against the new paths, plus new cases:

- install writes into `shimDir` and does **not** touch a non-cue
  `~/.local/bin/claude` — the regression test for the destructive bug
- install **does** remove a legacy cue shim at `~/.local/bin/claude`
- install refuses, and writes nothing, when no real agent binary is found
- uninstall empties `shimDir` and leaves `~/.local/bin` untouched
- running install twice does not duplicate the rc line
- `findRealAgentBin` skips `shimDir` even when the file there is large

Plus an end-to-end check on the author's machine: `cue launch claude --dry-run`,
then `which claude` in a fresh terminal.

## Docs to update

`docs/shell-install.md` and the `package.json` postinstall message both name
`~/.local/bin` and must be corrected to the shim dir, including the PATH
instructions for fish.

## Non-goals

- No change to `cue shell hook` (profile switching on `cd`). Separate concern,
  works today.
- No change to profile resolution, materialization, or launch behavior. This
  design only moves where the shim lives and how it is installed and removed.
