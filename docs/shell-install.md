# cue shell install

`cue shell install` drops a shim script into cue's own shim directory for every
agent it can find a real binary for:

```
~/.config/cue/shims/claude   →   exec cue launch claude "$@"
~/.config/cue/shims/codex    →   exec cue launch codex  "$@"
```

and puts that directory at the **front** of your PATH. From then on every
`claude` and `codex` invocation goes through cue's resolve → materialize → exec
flow.

The directory is cue's alone. Nothing else writes to it, which is the point:
`~/.local/bin` — where these shims used to live — is owned by the native Claude
Code installer, so the two kept overwriting each other.

## PATH

The shims are inert until `~/.config/cue/shims` is on PATH ahead of the real
binaries. `cue shell install` handles that for you:

| Shell | What it does |
|---|---|
| fish | Creates `~/.config/fish/conf.d/cue-shims.fish`. A new file, so no prompt — delete it to undo. |
| bash / zsh | Asks before appending the `export PATH=…` line to your `.bashrc` / `.zshrc`. |

Flags:

| Flag | Effect |
|---|---|
| `--yes` / `-y` | Skip the bash/zsh confirmation |
| `--no-rc` | Print the PATH line, change no config files |

Open a new terminal afterwards, or re-source your config.

## Verify

```bash
which claude   # should print ~/.config/cue/shims/claude
which codex    # should print ~/.config/cue/shims/codex
cue doctor     # D9 covers shim presence, PATH order, and the real binary
```

Run `cue launch claude --dry-run` in any directory that has a `.cue.profile` to
confirm the full resolve → materialize path works without launching an actual
Claude session.

## What it will not do

`cue shell install` refuses, and writes nothing, when it can't find a real
`claude` or `codex` on PATH. A shim with no binary behind it is worse than no
shim: `claude` stops working entirely.

It also never touches a `~/.local/bin/<agent>` it didn't write — on a native
Claude install that path is a symlink to the real binary. The one exception is
a **legacy cue shim** left there by an older `cue shell install`, which is
removed because it would shadow the very binary the new shim needs to exec.

## Uninstall

```bash
cue shell uninstall
```

Removes the shims and the fish drop-in. bash/zsh users should delete the PATH
line from their rc by hand. After that, `claude` and `codex` resolve to the real
binaries again.

## Bypass paths

You can bypass the shims without uninstalling:

| Method | How |
|---|---|
| Skip cue entirely | `CUE_BYPASS=1 claude <args>` |
| Force a specific profile | `claude --cue-profile <name> <args>` |
| Always open the picker | `claude --cue-pick <args>` |
| Bypass via absolute path | `~/.local/bin/claude <args>` (or wherever the real binary lives) |

`CUE_BYPASS=1` makes cue exec the real binary directly without touching the
profile, materializer, or config dir. Use it when you need a raw claude session
for debugging.

A bare interactive `claude` or `codex` invocation opens the profile picker by
default. Invocations with arguments resolve the pinned/default profile without a
prompt; use `--cue-pick` when you want the picker in that case.
