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

## Promote a running agent, without restarting it

Separate launch remains the default: `cue firstmate` offers the coordinator
picker, including Codex and Claude. To promote an **already running** agent,
ask that agent in its existing tmux pane:

> Run `cue firstmate promote`, read and carry out its adoption handoff, and
> become my Firstmate coordinator without restarting this session.

`promote` prints a handoff, **not a success claim**. It does not launch a
replacement, send keystrokes, run bootstrap or set a badge. The existing agent
reads the Firstmate contract and relevant skills, retains the current task's
context, and runs upstream session-start from the explicit Firstmate home.
Bootstrap can reconcile existing crew: its normal approvals still apply.
After reading the complete digest and resolving blockers, that same agent runs:

```sh
cue firstmate promote --accept
# With a non-default checkout, use the same --repo on both calls:
cue firstmate promote --accept --repo ~/Documents/firstmate
```

Acceptance delegates ownership verification to upstream's
`fm_session_lock_owned_by_self`, requires a matching startup-completion PID,
and verifies that the owner belongs to the current tmux pane's process tree.
A shell, foreign owner, missing completion or different pane cannot acquire a
badge merely by supplying a session ID. Acceptance never steals another
coordinator's lock or executes bootstrap on the agent's behalf.
Upstream ancestry detection may also refuse Node helper paths containing a
harness name (for example a `codex`-named source worktree). That refusal remains
authoritative: use the normal installed entrypoint or investigate upstream
identity detection, rather than bypassing the verifier.

This is **cooperative role adoption**, not a hot reload: existing instructions,
plugins, hooks, MCP servers, cwd and environment are unchanged. Higher-priority
rules and any competing orchestrator must permit adoption; otherwise the agent
must stop before accepting. The agent uses an explicit checkout/home for each
helper call and an **attended foreground** drain/handle/checkpoint loop. Missing
Stop hooks are not invented; unattended/away-mode notification parity is not
provided. If the harness cannot sustain the loop, it must report that limit.

## tmux badge

In tmux, separate launches receive a `⚓ Firstmate` pane-border badge. A live
promotion receives it only after explicit acceptance and ownership checks.
The badge identifies the selected coordinator, **not successful crew execution**
or proof that the model understood the handoff.

- Only the current pane is marked; existing border text and top/bottom placement
  are preserved. If borders were off, the current window enables top headers.
- No global tmux config, key bindings or other panes' titles are changed.
- A native tmux format job checks the coordinator PID and process start time.
  The badge disappears after exit on tmux's next format refresh, rather than
  marking a later process that reuses the pane. No model or monitor daemon is
  started. The window's header layout remains enabled after exit.
- Separate launch still works without tmux (or if badge setup fails). Live
  acceptance requires the agent's own tmux pane and fails closed otherwise.

To hide the badge manually without relinquishing upstream coordination, run
`tmux set-option -pu @cue_firstmate_badge` from the marked pane. This is cosmetic;
use Firstmate's own handoff protocol to transfer actual fleet ownership.

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
