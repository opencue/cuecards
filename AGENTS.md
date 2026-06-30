# AGENTS - cue bootstrap contract

Keep this file lean. It is read by coding agents that help install or maintain
cue. Detailed context-budget and install notes live in
`docs/agent-context-budget.md`; open that doc only when the task needs it.

## What cue is

cue is an agent profile manager for Claude Code and Codex. It sits between the
user's shell and the real `claude` / `codex` binary, resolves the active profile
from cwd, materializes a per-profile runtime under `~/.config/cue/runtime/`, and
then execs the real agent.

Key paths:
- `profiles/` - bundled profile definitions.
- `resources/skills/` - installable skills.
- `resources/mcps/` - MCP server configs.
- `resources/rules/` - shared rule library; `cue ruler` distributes a profile's
  `rules[]` into every agent's native rule file (CLAUDE.md, AGENTS.md, .cursorrules, …).
- `setup/` - per-OS install prompts.
- `docs/launch.md` - resolve -> materialize -> exec flow.

## Bootstrap Rules

1. Detect the OS before shell work: `uname -s` for Linux/macOS and `$OS` /
   `$env:OS` for Windows.
2. Pick one setup file and load only that file:
   - lean stack: `setup/lean-cue.md`
   - macOS: `setup/macos.md`
   - Linux: `setup/linux.md`
   - Windows: `setup/windows.md`
   - WSL2: use `setup/linux.md` inside WSL
   - parallel agents: `setup/parallel-agents.md`, only after lean stack works
3. Ask before hard-to-reverse or external steps: shell profile edits, existing
   Claude/Codex config merges, global package installs, `sudo`, or downloads.
4. Run one setup phase at a time and verify after each phase.
5. Keep installs idempotent. Guard each install with an existence check.
6. Do not auto-enable plugins until the user confirms the exact settings write.
7. Default profile should stay `core` unless the user explicitly chooses a
   broader composite.

## Repo Work Rules

- Preserve user work. Do not revert, reset, or overwrite unrelated changes.
- Prefer small, source-backed changes over broad rewrites.
- For repo architecture, feature-flow, or symbol-impact questions, use
  CodeGraph before broad file reads or grep.
- For context-heavy files, inspect with `wc`, narrow `rg`, `sed -n`, `head`,
  or `tail` before reading more.
- Do not paste large fixtures, catalogs, generated files, full logs, or full
  setup manuals into chat.
- Verify with the smallest check that proves the touched surface. For profile
  edits, start with `cue validate <profile>` plus targeted tests; run
  `cue validate --all` only when requested or when a shared loader/materializer
  change creates real cross-profile risk.
- For default-profile behavior, source of truth is `src/commands/init.ts` and
  profile resolution tests under `src/lib/cwd-resolver.test.ts`.

## Context Traps

Avoid reading these by default:
- `resources/skills/catalog/*.json`
- `resources/skills/skills/**/test/fixtures/*`
- `resources/skills/skills/**/fixtures/*`
- `docs/assets/*.svg`
- `dist/`, `node_modules/`, coverage output, generated output, submodule
  dependency trees, package-manager caches
- `~/.config/cue/analytics.jsonl`, `~/.config/cue/session-log.jsonl`

If one is required, sample it first and cap output. For broad `rg`, use
explicit `--glob` excludes for these traps.

## After Bootstrap

When `claude --version` or `codex --version` works through cue:
- Start a fresh agent session so runtime changes register.
- Verify `cue current`.
- Test only the capabilities the user installed.
- Keep the next session on `core` unless a task needs a broader profile.
