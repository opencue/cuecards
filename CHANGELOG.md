# Changelog

All notable changes to cue (`cue-ai`) are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/), and the project
adheres to [Semantic Versioning](https://semver.org/).

## [0.10.0] — 2026-07-26

### Changed

- **Agent shims moved to `~/.config/cue/shims/`** (breaking for existing installs —
  see Migration). `cue shell install` used to write `~/.local/bin/claude`, a path the
  native Claude Code installer owns: on a native install it is a symlink to
  `~/.local/share/claude/versions/<v>` and frequently the only `claude` on PATH.
  Installing therefore overwrote the real binary with no backup, leaving cue nothing
  to exec, and every Claude auto-update silently removed the shim again. cue now owns
  a directory nothing else writes to, and puts it at the front of PATH instead.
  - `cue shell install` refuses, and writes nothing, when no real `claude`/`codex`
    is on PATH — a shim with no binary behind it is worse than no shim.
  - It never touches a `~/.local/bin/<agent>` it did not write. A **legacy cue shim**
    there is removed, because it would shadow the binary the new shim must exec.
  - PATH setup is handled: fish gets a new `conf.d/cue-shims.fish` drop-in;
    bash/zsh are asked before an rc is appended (`--yes` skips, `--no-rc` prints only).
  - `cue shell uninstall` now exists. It was documented and tested but never wired
    into the command router, so it only ever printed a usage error.
  - `cue doctor` D9 gained an "installed but the shim dir is not on PATH" check.
  - Docs: [`docs/shell-install.md`](./docs/shell-install.md).

### Added

- **`CUE_ALWAYS_PICK=1`** — a bare `claude` offers the profile picker instead of
  silently launching whatever `.cue.profile` resolves to. The resolved profile still
  sorts to the top, so Enter reproduces the old behavior. An explicit `--cue-profile`
  opts out, and it applies only on a TTY so scripted `claude -p "…"` launches keep
  resolving their pin.
- **Multi-client Google Ads + Meta Ads layer** — two MCPs plus CLI access, switched
  per client through `cue workspace <client>` (#101, #102, #103).
- **`cue ruler`** — distributes a profile's `rules[]` into every agent's native rule
  file (CLAUDE.md, AGENTS.md, .cursorrules, …). `CUE_RULER_AUTO=1` syncs on launch.
- **Lazy MCP loading with opt-in prune**, per-profile (`mcpPrune`) and global (#90, #91, #93).
- **`cue cost`** — honest MCP token accounting with a `--budget` CI gate (#88).
- One-line startup banner on `cue launch`.

### Fixed

- `findRealAgentBin()` mistook a shim written in the quoted-absolute-path form
  (`exec "/…/bin/cue" launch claude "$@"`) for the real binary — the inline
  `/cue\s+launch/i` never matched, because the quote between `cue` and `launch` is
  not whitespace. Source-clone installs could recurse into themselves.
- `install.sh` treated any symlink at the shim path as "already routes through cue"
  and silently no-opped; `get.sh` overwrote the native symlink unconditionally on the
  `curl | sh` path. Both now use the shim dir.
- Classifier credential copy-back is atomic (#100).

### Migration

Existing users must re-run the installer once:

```bash
cue shell install     # writes the new shims, removes the legacy one, sets PATH
```

Then open a new terminal. Verify with `which claude` — it should print
`~/.config/cue/shims/claude`. `cue doctor` reports it if the dir is missing from PATH.

## [0.9.2] — 2026-06-05

### Added

- **Live code-review visibility.** Watch an independent review move file-by-file in
  real time instead of staring at an opaque "Precipitating…" spinner.
  - `bin/cue-review-watch` — live renderer; run it in a second pane to follow the
    latest review (`--id <id>` for a specific one, `--once` for a snapshot).
  - `bin/cue-review-progress` — append-only progress events to
    `~/.config/cue/review-progress/<id>.jsonl` (the shared schema every reviewer writes).
  - `/code-review` now emits per-file / per-dimension / per-finding progress events.
  - The `auto-review` Stop-hook gate records its review to the same log, so the
    independent merge-gate review is watchable too (verdict parsed with the progress
    side-channel filtered out; invariants unchanged: recursion guard, fail-open,
    binary verdict).
  - Docs: [`docs/review-visibility.md`](./docs/review-visibility.md).
- **Self-learner (experimental · opt-in · default-OFF).** Profiles capture where their
  skills fell short during a task and feed gated improvements back over time.
  - `resources/hooks/profile-self-improve.sh` — friction-signal capture plus an optional
    live critic agent. Recursion-guarded, never blocks Stop, runs the critic at most once
    per session, fully fail-open.
  - New `skill_gap` analytics event (`src/lib/analytics.ts`), inert to existing readers.
  - Piloted on the `skill-writer` profile. Enable with
    `touch ~/.config/cue/.auto-improve-enabled`. Docs: [`docs/self-learner.md`](./docs/self-learner.md).

### Documentation

- **README — "what you'll see during a run — the reviewer".** Explains the independent
  review gate that runs during a Claude Code session: why a red "Stop hook error" means
  the gate is working (not a failure), how to suppress or disable it, and how to watch a
  review live with `cue-review-watch`. Includes a real catch (a `weight` kg/g unit
  ambiguity that would have rendered per-kg prices as `€0.00`).

[0.9.2]: https://github.com/opencue/cuecards/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/opencue/cuecards/releases/tag/v0.9.1
