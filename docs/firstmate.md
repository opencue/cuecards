# Firstmate coordinator

Firstmate is an orchestration workspace, not a model or a Cue skill-only
profile. Cue launches the selected primary harness from the complete
[NagyVikt/firstmate](https://github.com/NagyVikt/firstmate) checkout so its
instructions, skills and project hooks stay together.

```sh
cue firstmate --setup          # explicitly download source; no package installs
cue firstmate                  # choose the primary coordinator interactively
cue firstmate --agent codex
cue firstmate --agent claude -- --model sonnet
```

The picker also offers Grok, Pi, pi-signed, Oh My Pi, OpenCode and Cursor Agent
CLI. Missing CLIs are labelled and never installed automatically. Without a
terminal, pass `--agent` explicitly. `--setup` only prepares source and exits;
it never starts a paid agent session.

The default checkout is `$XDG_CONFIG_HOME/cue/firstmate` (normally
`~/.config/cue/firstmate`). Override it with `CUE_FIRSTMATE_REPO` or `--repo`:

```sh
cue firstmate --repo ~/Documents/firstmate --agent codex
```

Setup never pulls, resets or overwrites an existing checkout. Use Firstmate's
own update workflow for upgrades. Source inspection for this integration used
`opensrc path NagyVikt/firstmate`, with upstream HEAD
`b182d0f908b78d08c7ccb8dce3775bdca8c5d657`; setup downloads the fork's current
default branch, not a frozen copy. The opensrc inspection cache is not a
runtime installation: it lacks Git metadata required by Firstmate.

## Boundaries

- Launch starts in the Firstmate checkout, **not the project you want worked
  on**. Tell the coordinator which project/task to manage. Its upstream
  workflow owns crew dispatch, worktrees, supervision and completion.
- `FM_HOME` is explicitly the selected checkout. Inherited root/state/data/
  config/projects overrides are removed to avoid steering another instance.
- Cue profile materialization and the `CUE_REAL_CODEX` OMX wrapper are bypassed
  for this launch. Existing profiles/defaults and account settings are not
  rewritten. Canonical account directories are reused, not copied.
- This does not remove user-installed global agent instructions/plugins. If
  those mandate a competing orchestrator, reconcile them before dispatch;
  Cue does not silently disable them.
- Git, authenticated `gh`, and the upstream backend/tool dependencies must be
  available. Firstmate's startup diagnostics own that check. Unix/macOS/WSL
  only; no Windows shell emulation is attempted.
- No automatic trust flags, permission bypass flags or global installs are
  added. Review upstream hooks before trusting the checkout. **Upstream crew
  permission defaults may be permissive**; review its `config/claude-permission-mode`
  and selected harness settings before dispatching workers.
- Preserve the checkout working directory (no forwarded `--cd`/`-C`). Run the
  primary interactively for its supervision hooks; arbitrary headless flags
  are forwarded but are not a verified supervision mode.

The integration tests use stub harnesses and do not prove live model-driven
coordination. Verify an actual primary startup and a small crew task separately
after installing and approving the required tools.
