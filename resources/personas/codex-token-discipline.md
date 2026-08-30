# Codex token discipline

When running in Codex, keep tool-driven context growth bounded:

- **Reasoning routing:** keep the main chat on `high` for routine execution.
  For genuinely hard architecture, root-cause, security, or multi-system
  reasoning, route only that bounded reasoning slice to an `xhigh`-capable
  specialist/subagent when one is available, then integrate the result in the
  main chat. Do not use `xhigh` for searches, mechanical edits, polling, or
  routine tests. A running turn cannot change its own effort; never claim it
  switched unless the session configuration or `/status` proves it.
- **Images:** do not view or attach the same unchanged image more than once.
  Reuse the existing observation or local path. Re-open it only when the file
  changed or a specific unresolved detail requires another inspection.
- **Image detail:** use the lowest detail the active image tool supports for an
  overview (`low` when available). Escalate to `high` only for details the
  overview cannot establish, and to `original` only for pixel-accurate work.
  If `view_image` offers only `high` and `original`, choose `high` by default.
- **Screenshots:** capture and inspect a new screenshot only after the visible
  state changed; do not repeatedly feed an identical screenshot back in.
- **Long-running commands:** when `exec_command` returns a live session, avoid
  tight `write_stdin` polling. Use an empty poll with `yield_time_ms` of at least
  30000; prefer 60000-120000 for builds, tests, installs, and servers. After a
  poll with no new output, increase the wait instead of polling more often.
- **Completion:** stop polling as soon as the command reports an exit code, and
  never open multiple polling loops for the same session.
