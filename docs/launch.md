# cue launch flow

> **cue — Agent Profile Manager for Claude Code & Codex.** This doc explains the
> resolve → materialize → exec hot path that runs every time you type `claude`
> or `codex` in a shell where `cue shell install` has been run.

---


When you type `claude` or `codex` in a shell where `cue shell install` has
been run, the shim at `~/.local/bin/claude` (or `codex`) delegates immediately
to `cue launch <agent> "$@"`. This is the hot path:

```
~/.local/bin/claude
   └─exec──► cue launch claude $@
                  │
                  ▼
            1. resolve(cwd)       ← pick a profile name
                  │
                  ▼
            2. picker (first time) ← TUI opens if no profile resolved
                  │
                  ▼
            3. materialize(profile) ← build ~/.config/cue/runtime/<profile>/claude/
                  │
                  ▼
            4. exec real claude    ← with CLAUDE_CONFIG_DIR set
```

## Resolve precedence

Profile resolution stops at the first match, in this order:

1. `--cue-profile <name>` flag passed to `claude` (or `cue launch`).
2. `.cue.profile` file found by walking up from cwd; walk stops at the git
   repo root or `$HOME`, whichever comes first.
3. `~/.config/cue/repo-defaults.json` — a JSON map of git-repo-root absolute
   paths to profile names, consulted when cwd is inside a git repo.
4. `~/.config/cue/default-profile` — single-line file with a global default.
5. TUI picker — opens when none of the above matched.

## Picker

On every bare interactive `claude` or `codex` launch, the picker opens in the
terminal. Arrow keys navigate; Enter selects. By default the chosen profile is
written to `.cue.profile` in the current directory. Launches with agent arguments
keep resolving that pin automatically so scripts and one-shot commands do not
stop for input. Pass `--cue-profile <name>` to skip the picker for a bare launch,
or `--cue-pick` to force it for a launch that has arguments.

## Materialize

Given a resolved profile, cue builds (or reuses) a fully isolated config tree:

```
~/.config/cue/runtime/<profile>/claude/
├── .cue-hash       sha256(resolved profile JSON, sorted keys)
├── settings.json   enabledPlugins, mcpServers
├── CLAUDE.md       profile stamp + user's ~/.claude/CLAUDE.md appended
└── skills/         symlinks to skill dirs in resources/skills/
```

The hash is checked before any writes. If the profile hasn't changed since the
last run, materialize is a no-op (sub-millisecond). When the profile changes,
cue writes to a sibling `.tmp` directory and atomically swaps it in, so a
concurrent running session never sees a partial state.

For Codex the shape is identical under `runtime/<profile>/codex/` with
`CODEX_HOME` and a `config.toml` instead of `settings.json`.

## Loading another profile from a running agent

`cue summon <profile>` soft-loads the profile persona and readable skill
playbooks into the current Claude or Codex conversation and pins
`.cue.profile`. Add `--with-active` when the requested profile should augment,
rather than replace, the running profile:

```bash
cue summon coolify --with-active
cue summon coolify --with-active --json
```

MCP servers and native commands are fixed when the agent process starts, so
they cannot be injected honestly into that process. The command therefore
returns `reexec_cmd`: Claude uses native continuation under the materialized
profile; Codex starts a newly materialized profile with a prompt pointing to
the current rollout file (`resume_mode: transcript-handoff`). This preserves
the work context without claiming that a new profile's tools appeared inside
the already-running Codex process. Use `--agent claude|codex` only when automatic
detection from `CUE_AGENT` is unavailable.

## Per-profile memory (claude-mem)

cue ships the [claude-mem] plugin in `core`, so most profiles inherit
cross-session memory. By default claude-mem keys its entire store off one env
var (`CLAUDE_MEM_DATA_DIR`, default `~/.claude-mem`) and reaches its background
worker over a single TCP port — so every profile would share one memory pool,
*and* two profiles launched at once would cross-write through whichever worker
claimed the port first.

To keep each role's memory clean, `cue launch` injects a per-profile overlay
into the child environment (right before exec'ing the agent):

```
CLAUDE_MEM_DATA_DIR        ~/.claude-mem/profiles/<profile>
CLAUDE_MEM_CHROMA_ENABLED  false   # SQLite-only — no Chroma daemon, no :8000
CLAUDE_MEM_WORKER_PORT     30000 + 2·slot
CLAUDE_MEM_SERVER_PORT     30000 + 2·slot + 1
```

Ports come from a small cue-owned registry at `~/.claude-mem/cue-ports.json`
that assigns each profile the lowest free slot on first launch, so concurrent
profiles never collide. The logic lives in `src/lib/claude-mem-env.ts`.

**New profiles start with empty memory** by design — that is the isolation. To
carry your existing global history into one profile instead, seed it:

```bash
cue mem seed <profile>          # copy ~/.claude-mem into the profile's store
cue mem status                  # data dir, ports, DB size, worker state
cue mem ports                   # the slot registry (flags any collision)
cue mem path <profile>          # print a profile's CLAUDE_MEM_DATA_DIR
```

Opt out for a shell with `CUE_CLAUDE_MEM_ISOLATE=0` (claude-mem then uses its
own default store). cue also stands down automatically if you set any of
`CLAUDE_MEM_DATA_DIR` / `CLAUDE_MEM_WORKER_PORT` / `CLAUDE_MEM_SERVER_PORT`
yourself, so hand-managed setups win.

[claude-mem]: https://github.com/thedotmack/claude-mem

## Profile icons (emoji + Kitty inline images)

Each profile can declare two icon fields:

- `icon: "🦊"` — a 1-2 char emoji shown in any terminal (the picker label)
- `iconImage: "logo.png"` — a path (relative to the profile dir) to a real
  PNG/JPG logo. Rendered inline via the [Kitty graphics protocol] when the
  picker detects a Kitty terminal; otherwise falls back to the emoji.

[Kitty graphics protocol]: https://sw.kovidgoyal.net/kitty/graphics-protocol/

### Detection

Cue tries, in order:

1. `CUE_KITTY=1` env var — explicit opt-in (recommended for tmux setups)
2. `CUE_DISABLE_KITTY_IMAGES=1` — explicit opt-out
3. `TERM=xterm-kitty` or `KITTY_WINDOW_ID` set — direct Kitty
4. `KITTY_PID`, `TERM_PROGRAM=kitty`, `LC_TERMINAL=kitty`
5. Inside tmux/screen: walk `/proc/<pid>/comm` parent chain looking for a
   `kitty` process (works only when not detached behind a tmux server)

### tmux setup

When inside tmux, two things are required for Kitty images to render:

1. **`set -g allow-passthrough on`** in `~/.tmux.conf` (default in tmux 3.3+).
   This forwards graphics-protocol escapes from cue down to the terminal —
   but **note**: tmux's passthrough is one-way. Terminal responses (used by
   the auto-probe) do *not* reliably travel back, so the probe usually
   times out inside tmux even when Kitty is the actual frontend.
2. **Set `CUE_KITTY=1` explicitly** so cue skips the probe and trusts the
   signal:
   ```bash
   # in ~/.bashrc (set unconditionally if you primarily use Kitty)
   export CUE_KITTY=1

   # also tell tmux to expose it to existing panes
   tmux set-environment -g CUE_KITTY 1
   ```
   If you also use non-Kitty terminals occasionally, override per-session
   with `CUE_DISABLE_KITTY_IMAGES=1 claude` to force emoji fallback.

If the wrapped passthrough sequence renders as garbage in your terminal, set
`CUE_DISABLE_KITTY_IMAGES=1` to fall back to emoji icons.

## Multi-account / credentials persistence

When `CLAUDE_CONFIG_DIR` is set in the environment **before** launching cue
(typically via a shell alias like `claude-account2`), cue treats this as
*account-alias mode*:

1. The path in `CLAUDE_CONFIG_DIR` is the **credentials source**.
2. cue copies `.credentials.json` from there into the materialized runtime so
   you don't have to log in again.
3. cue reads the source's `settings.json` and merges the profile's plugins +
   MCPs on top — preserving `permissions`, `trustedDirectories`, and
   `skipAutoPermissionPrompt` from the account.
4. Both files are refreshed on every launch (even on cache hit) so switching
   accounts on the same profile doesn't leak settings between accounts.
5. The picker is **always shown** in account-alias mode, with the previously
   pinned profile on top — so each session can use a different profile
   without losing the auth.

Example alias:

```bash
alias claude-account2="CLAUDE_CONFIG_DIR=$HOME/.claude-accounts/account2 cue launch claude"
```

The detection compares `realpath(CLAUDE_CONFIG_DIR)` against
`realpath($HOME/.claude)` — so trailing slashes and symlinks don't accidentally
trigger account-alias mode.

## Project loadout (skill filtering)

On profiles with ≥ 25 local skills, launch classifies each skill against the
project's signals (nested `package.json` dependencies, framework/tool markers
from `project-scanner`, plus the skill ref's `when:` condition) and
materializes only the matching **full** set. The rest are **deferred**:
excluded from the skills dir — which removes their always-on frontmatter
cost — but listed in one generated `cue-deferred-skills` index skill the agent
can consult to Read any deferred skill's real SKILL.md on demand.

The split persists per project in `~/.config/cue/loadouts.json` and is
recomputed when the profile's skill set or the project's signals change.
Because the MCP step runs after the loadout, skill→MCP `needed` sets — and
the interactive MCP toggle's initial suggestion — become project-aware too.

Controls: `--cue-full` (this launch loads everything), `CUE_LOADOUT=off`
(disable globally), `cue loadout` (show), `cue loadout keep|defer <id…>`,
`cue loadout on|off`, `cue loadout reset`.

## Bypass paths

- `claude --cue-profile frontend` — skip resolve, use `frontend` directly.
- `claude --cue-pick` — always open the picker (ignore pin files).
- `CUE_BYPASS=1 claude` — exec the real binary directly; no resolve, no
  materialize, no profile.
- Absolute path (`/usr/local/bin/claude`) — bypasses the shim entirely via PATH.

### What `CUE_BYPASS=1` does, exactly

`cue launch` short-circuits before anything else: it locates the real binary
(the same PATH walk as a normal launch, skipping cue's shims) and execs it with
the agent's own arguments, returning the child's exit code. Nothing is resolved,
no picker opens, no runtime is materialized, `CLAUDE_CONFIG_DIR` / `CODEX_HOME`
are left alone.

Edges worth knowing:

- **Exactly `1`.** `CUE_BYPASS=true` is not a bypass.
- **cue's own flags are still stripped**, not forwarded — `--cue-profile`,
  `--cue-pick`, `--dry-run` and friends are cue's vocabulary, and the agent
  would choke on them. Under a bypass they simply do nothing.
- **The recursion counter still applies.** `CUE_LAUNCHING` is incremented on the
  child, so a shim that somehow execs back into cue is still bounded by
  `MAX_LAUNCH_DEPTH` instead of forking without end.
- **It is inherited.** Every process under a bypassed session sees the flag, so
  nested `claude` calls bypass too. That is the point when cue's own internals
  spawn a classifier; it is worth remembering when debugging interactively.

See the full spec at
[docs/superpowers/specs/2026-05-22-cue-agent-profile-manager-design.md](./superpowers/specs/2026-05-22-cue-agent-profile-manager-design.md).
