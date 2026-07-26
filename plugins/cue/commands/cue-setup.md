---
description: Install cue and pin a profile to this project — the one-command setup
---

Set up cue for this machine and this directory. Work through these steps in
order, and stop to report if any step fails.

1. Check whether Node and the CLI are present: run `command -v node` and
   `command -v cue` via Bash. If `cue` is missing, tell the user cue is not
   installed yet and ask permission to run `npm install -g cue-ai`. Do not
   install without an explicit yes.

2. Once `cue` resolves, run `cue auto-detect --json` via Bash. It scans the
   project and returns ranked profile suggestions with confidence and reasons
   — no prompts, just data.

3. Present the top suggestions to the user in this conversation and let them
   pick one (or name a different profile from `cue list --json`). This is the
   step that replaces the interactive picker: `cue setup` is built on
   `@clack/prompts` arrow-key widgets that block on a TTY read, which a
   one-shot Bash call cannot drive. The choice still belongs to the user — it
   just happens here in chat instead of at that menu.

4. Run `cue setup --profile <chosen> --yes` via Bash. `--yes` runs the rest of
   the flow with no prompts at all: it pins the profile, installs the
   `~/.config/cue/shims/` shim, and — if needed — appends a PATH line to the
   user's shell rc file (~/.bashrc, ~/.zshrc, or fish config) so the shim takes
   effect. It does NOT enable telemetry and does NOT install any discovered
   third-party gems — both stay off until the user asks for them separately.

5. `cue setup` prints its own PATH guidance when the shim directory is not on
   PATH, including the exact line to add. Surface that verbatim — the shims do
   nothing until it is fixed.

6. Finish by reporting which profile was pinned and whether the shim is
   active. Mention that the shim is undone with `install.sh --uninstall`.

Do not reimplement any of this flow yourself — `cue setup` is the single source
of truth for it, and the same flow runs for users who install from npm.
