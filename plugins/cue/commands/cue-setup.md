---
description: Install cue and pin a profile to this project — the one-command setup
---

Set up cue for this machine and this directory. Work through these steps in
order, and stop to report if any step fails.

1. Check whether the CLI is present: run `command -v cue` via Bash. If it exits
   non-zero, tell the user cue is not installed yet and ask permission to run
   `npm install -g cue-ai`. Do not install without an explicit yes.

2. Once `cue` resolves, run `cue setup` via Bash. It is interactive: it scans the
   project, suggests a profile, shows the token budget for that profile against
   loading everything, then asks before installing the `~/.config/cue/shims/`
   shim that makes `claude` load profiles. Relay its prompts to the user and pass their
   answers back.

3. `cue setup` prints its own PATH guidance when the shim directory is not on
   PATH, including the exact line to add. Surface that verbatim — the shims do
   nothing until it is fixed.

4. Finish by reporting which profile was pinned and whether the shim is active.
   Mention that the shim is undone with `install.sh --uninstall`.

Do not reimplement any of this flow yourself — `cue setup` is the single source
of truth for it, and the same flow runs for users who install from npm.
