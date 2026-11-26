# Preview and resume GitGuardex work from Cue

```sh
cue work "Fix the checkout tests" --task-id checkout-tests --preview
cue work "Fix the checkout tests" --task-id checkout-tests
cue work --resume
cue work --resume --task-id checkout-tests
```

Preview prints the intended task ID, agent, and Cue profile, then shows the
GitGuardex checkout estimate or indicates that an existing checkout would be
reused. It does not create a worktree or launch an agent.

Resume selects a ready Codex or Claude task in the current repository.
Use `--task-id` in scripts. Resume starts a fresh agent session in the
existing worktree; it does not restore a previous chat. Launch from outside
the selected worktree. GitGuardex checks occupancy again at launch and
refuses when another process is using the worktree or occupancy is unknown.
Resume never creates a replacement checkout.

Resume requires a GitGuardex build exposing `gx branch tasks --json`.
New task starts use versioned GitGuardex JSON when available and still
work with older GitGuardex versions that only return human-readable output.
Plain `codex`, `claude`, and `cue launch` are unchanged.
