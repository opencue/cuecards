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
2. `.cue-profile` file found by walking up from cwd; walk stops at the git
   repo root or `$HOME`, whichever comes first.
3. `~/.config/cue/repo-defaults.json` — a JSON map of git-repo-root absolute
   paths to profile names, consulted when cwd is inside a git repo.
4. `~/.config/cue/default-profile` — single-line file with a global default.
5. TUI picker — opens when none of the above matched.

## Picker

On first launch in a new directory, the picker opens in the terminal. Arrow keys
navigate; Enter selects. By default the chosen profile is written to
`.cue-profile` in the current directory so the next launch is instant. Pass
`--cue-pick` to force the picker open even when a pin is present.

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

## Bypass paths

- `claude --cue-profile frontend` — skip resolve, use `frontend` directly.
- `claude --cue-pick` — always open the picker (ignore pin files).
- `CUE_BYPASS=1 claude` — exec the real binary directly; no resolve, no
  materialize, no profile.
- Absolute path (`/usr/local/bin/claude`) — bypasses the shim entirely via PATH.

See the full spec at
[docs/superpowers/specs/2026-05-22-cue-agent-profile-manager-design.md](./superpowers/specs/2026-05-22-cue-agent-profile-manager-design.md).
