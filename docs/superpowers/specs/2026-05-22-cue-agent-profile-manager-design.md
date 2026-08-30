# cue — agent profile manager (design)

**Status:** design, awaiting implementation plan
**Date:** 2026-05-22
**Supersedes:** `draft.md` (Soul Skill Profiles Through authmux)

## 1. Goal

Rebuild the existing `soul` CLI into `cue`: an agent profile manager that owns the
*launch boundary* for both Claude Code and Codex. Typing `claude` or `codex` opens
a profile picker (on first use per cwd), and the chosen profile materializes a
fully isolated per-profile `CLAUDE_CONFIG_DIR` / `CODEX_HOME` before the real
agent binary is executed. Skills, MCP servers, and Claude Code plugins are all
scoped to the profile.

## 2. Non-goals

- Per-profile auth/identity isolation. That stays with authmux.
- Daemon-backed picker or sub-50 ms launch latency. The single-pass launcher is
  cheap enough.
- A web or Electron picker UI.
- Live mid-session swap of skills/MCPs/plugins inside a running agent. Switching
  requires a process restart.

## 3. Rename

- Repo folder `soul/` → `cue/`.
- `package.json` `name`: `soul` → `cue`. Stays `"private": true`.
- CLI binary `bin/soul` → `bin/cue`.
- A `bin/soul` tombstone script remains for 2 weeks after the rename, prints a
  deprecation notice, and execs `cue` with the same args.

## 4. Architecture

`cue` is a Bun CLI with three runtime modules and one installer module:

| Module        | Responsibility                                                                          | Side effects                                                  |
|---------------|------------------------------------------------------------------------------------------|---------------------------------------------------------------|
| `resolve`     | Given a cwd, return a profile name.                                                      | None.                                                          |
| `materialize` | Given a profile, build `~/.config/cue/runtime/<profile>/{claude,codex}/`.                | Writes runtime tree; atomic swap.                              |
| `launch`      | Resolve → materialize → `exec` the real agent binary with the right env.                 | Replaces the process with the agent's.                         |
| `shell`       | Install/uninstall shim binaries in `~/.local/bin`. Detect PATH ordering issues.          | Writes shim files; never on the launch path.                   |

The TUI `picker` is invoked only from inside `resolve` when no pin is found.

The existing libs from the May 20 Wave 2 work plug in unchanged:

- Profile Generator (A12) → `src/lib/generator/`
- Profile Linter (A13) → `src/lib/linter/`
- Profile Materializer (A14) → `src/materialize/`

All existing `soul` subcommands (`list`, `new`, `validate`, `use`, `scan`,
`doctor`) survive under the new name with no behavioural change.

## 5. Profile schema delta

Existing schema (`profiles/SCHEMA.md`) is unchanged except for two additions.

### 5.1 Promote `skills.plugins` → top-level `plugins`

```yaml
plugins:
  - frontend-design@claude-plugins-official
  - superpowers@claude-plugins-official
  - claude-mem@thedotmack
```

The `<plugin>@<marketplace>` form matches Claude Code's existing
`enabledPlugins` key format so it round-trips when writing
`settings.json`. Inheritance and dedupe rules (concat parent then child,
dedupe by string identity) match `mcps`.

`skills.plugins` is retired. Materializer reads `plugins:` and writes both
the `enabledPlugins` map in `settings.json` AND the per-plugin skill
symlinks into `runtime/<profile>/<agent>/skills/`. The two concepts that
were tangled (enabling a plugin vs exposing its skills) collapse into one
declaration.

### 5.2 Per-resource `agents` override

```yaml
mcps:
  - id: medusadocs
    agents: [claude-code]    # optional; default = profile.agents
  - claude-mem               # plain string still works
```

Same for `skills.local`, `skills.npx`, `plugins`. Object form is opt-in;
plain-string entries continue to work and are equivalent to
`{ id: <string> }` with no `agents` filter.

## 6. Launch flow

```
shell                                                cue (Bun)              real agent
─────                                                ─────────              ──────────
~/.local/bin/claude  ─exec─►  cue launch claude $@   ─►  resolve(cwd)
                                                         │
                                                         ├─ .cue.profile pin?   ──yes──►  profile
                                                         ├─ git-repo default?   ──yes──►  profile
                                                         ├─ global default?     ──yes──►  profile
                                                         └─ TUI picker          ──pick──►  profile + write .cue.profile
                                                                                            │
                                                                                            ▼
                                                                                       materialize(profile)
                                                                                            │
                                                                                            ├─ hash matches  ──►  skip rewrite
                                                                                            └─ hash differs  ──►  rebuild runtime/<profile>/claude/
                                                                                                                  ▼
                                                                                       exec claude (CLAUDE_CONFIG_DIR=runtime/<profile>/claude, "$@")
```

`codex` is identical with `CODEX_HOME` in place of `CLAUDE_CONFIG_DIR`.

### 6.1 Resolve precedence

In order, stop at the first hit:

1. `--cue-profile <name>` CLI flag.
2. `.cue.profile` file found while walking up from cwd. Walk stops at the
   git repo root, then at `$HOME`, whichever comes first.
3. `~/.config/cue/repo-defaults.json` — keyed by git-repo-root absolute path,
   value is the profile name. Only consulted when cwd is inside a git repo
   and no `.cue.profile` was found above.
4. `~/.config/cue/default-profile` — single-line file with the global default
   profile name.
5. TUI picker.

### 6.2 Shim

`~/.local/bin/claude`:

```bash
#!/usr/bin/env bash
exec cue launch claude "$@"
```

`~/.local/bin/codex` is the same with `codex` substituted. `cue shell install`
writes these, sets the executable bit, and verifies `~/.local/bin` is earlier
in PATH than the directories containing the real `claude`/`codex`. If not, it
prints the line the user needs to add to their rc file and exits non-zero
without writing the shims.

### 6.3 Bypass paths

- `claude --cue-profile <name>` — skip resolve, force this profile.
- `claude --cue-pick` — skip pin lookup, always open the picker.
- `CUE_BYPASS=1 claude` — exec the real claude binary directly, no cue at all.
- Explicit absolute path (e.g. `/opt/homebrew/bin/claude`) — bypasses, since
  the shim only intercepts via PATH.

### 6.4 Recursion guard

Before `exec`-ing the real agent, `cue launch` sets `CUE_LAUNCHING=1` in the
environment. If `cue launch` is invoked with `CUE_LAUNCHING=1` already set, it
exits with: `shim recursion detected — check PATH ordering`. This catches the
common misconfiguration where the real binary isn't found and the shim ends up
calling itself.

### 6.5 Exit codes

`cue launch` propagates the agent's exit code unchanged. Picker cancel
(Ctrl-C / esc) returns 130, never launches. Missing real-agent binary returns
127.

## 7. Materialization

For Claude Code, `materialize(profile)` produces:

```
~/.config/cue/runtime/<profile>/claude/
├── .cue-hash                      sha256(resolved profile JSON, sorted keys)
├── settings.json                  enabledPlugins, mcpServers, env, theme
├── CLAUDE.md                      profile stamp + inherited CLAUDE.md content
├── skills/
│   ├── <name> -> /home/.../cue/resources/skills/<cat>/<name>     symlinks
│   └── <plugin>:<name> -> ~/.claude/plugins/<plugin>/skills/<name>
└── (Claude reads mcpServers from settings.json; no separate file)
```

For Codex: same shape under `runtime/<profile>/codex/`, with `~/.codex/skills/<name>`
target symlinks and a `config.toml` written for MCP servers.

### 7.1 Algorithm

1. Resolve inheritance chain → flat list of `{skills, mcps, plugins, env}`.
2. Compute `sha256(JSON.stringify(resolved, sortKeys))`. If
   `runtime/<profile>/<agent>/.cue-hash` matches, return — no work.
3. `mkdir -p runtime/<profile>/<agent>.tmp/`.
4. Symlink every skill source into `<tmp>/skills/`. Resolve npx skills from
   `profiles/_cache/`.
5. Write `<tmp>/settings.json`:
   - `mcpServers` — merged from `resources/mcps/configs/claude.sanitized.json`
     keyed by the profile's `mcps:` list.
   - `enabledPlugins` — map of `<plugin>@<marketplace>` → `true` for each entry
     in `plugins:`.
   - `theme`, telemetry, and other UI prefs inherited from
     `~/.claude/settings.json`.
6. Write `<tmp>/CLAUDE.md`: header stamp (`# cue profile: <name>`) then the
   user's own `~/.claude/CLAUDE.md` content appended verbatim.
7. Write `<tmp>/.cue-hash`.
8. Atomic swap: on Linux, `renameat2(RENAME_EXCHANGE)` between
   `runtime/<profile>/<agent>` and `<tmp>`, then `rm -rf` the old. On macOS
   (no `RENAME_EXCHANGE`), fall back to `rm -rf` then `rename`. Only `cue` ever
   writes here, so the macOS race is acceptable.

### 7.2 What is *not* isolated

OAuth tokens (`~/.claude/`), telemetry, theme. Profiles isolate *capabilities*,
not *identity*. Identity isolation is authmux's domain.

### 7.3 Plugins are referenced, not copied

Claude Code resolves `enabledPlugins` against `~/.claude/plugins/` regardless
of `CLAUDE_CONFIG_DIR`. The profile only controls which plugin names appear in
the materialized `settings.json`'s `enabledPlugins`. Plugin source dirs live
once at the user level, not per-profile.

## 8. Picker UX

### 8.1 Out-of-shell picker (default, via `cue launch`)

Bun TUI driven by `@clack/prompts` (or equivalent):

```
  ▍cue · pick a profile for ~/Documents/recodee

  ▸ medusa-dev    Medusa v2 backend + storefront work
    frontend      Frontend UI implementation, redesign, polish
    backend       API/server work
    docs-writer   Writing docs and changelogs
    full          All skills (rescue/emergency)
    research      Read-heavy, low-write
    ─────
    + new profile from this cwd...
    ⓘ details (d) · pick once, no pin (n) · cancel (esc)
```

- `Enter` — pin to `./.cue.profile` and launch.
- `n Enter` — launch without pinning (this session only).
- `d` — show resolved skills/MCPs/plugins for the highlighted profile before
  committing.
- `/` — incremental filter.
- `esc` / `Ctrl-C` — cancel; exit 130; no launch; no pin.

### 8.2 In-session switching

A `cue` Claude Code plugin (shipped from `plugins/cue/`) registers a `/cue`
slash command, enabled in every profile by default:

| Command            | Behaviour                                                                                                              |
|--------------------|------------------------------------------------------------------------------------------------------------------------|
| `/cue`                       | Prints profiles as a numbered list (no TUI in-session). User replies with a number or name. Updates `.cue.profile` in cwd. |
| `/cue switch <name\|number>` | Same as `/cue` with the choice pre-supplied.                                                                                |
| `/cue reload`      | Executes `exec ~/.local/bin/claude` from the agent shell. The shim resolves the new pin and re-launches.               |
| `/cue current`     | Prints the active profile name and the resolved skill/MCP/plugin list.                                                  |

Mid-session swap of skills/MCPs/plugins inside a running session is **not
supported** — Claude Code reads them at session boot. `/cue reload` is the
honest path: it restarts the process under the new profile.

Codex gets the same surface via its equivalent skill mechanism.

## 9. Repo layout (target)

```
cue/                                  (was soul/)
├── README.md                         rebranded: "cue — agent profile manager"
├── package.json                      name: "cue", bin: { "cue": "bin/cue" }
├── bin/
│   ├── cue                           (was bin/soul) bash launcher → bun src/cli/index.ts
│   ├── soul                          tombstone, removed after 2 weeks
│   ├── envoult, envoultd, medusa-dev unchanged
│   └── README.md
├── src/                              (was bin/cli/)
│   ├── index.ts                      command dispatch
│   ├── commands/
│   │   ├── launch.ts                 NEW
│   │   ├── shell.ts                  NEW
│   │   ├── current.ts                NEW
│   │   ├── migrate-symlinks.ts       NEW
│   │   └── list.ts, new.ts, validate.ts, use.ts, scan.ts, doctor.ts
│   ├── picker/                       NEW
│   ├── resolve/                      NEW
│   ├── materialize/                  Profile Materializer A14 lives here
│   └── lib/                          generator (A12), linter (A13), schema, util
├── resources/                        NEW grouping
│   ├── skills/                       (was soul/skills/)
│   ├── mcps/                         (was soul/mcps/)
│   └── claude-plugins-official/      (was at repo root) — gitignored clone
├── plugins/                          NEW
│   └── cue/                          Claude Code plugin shipping `/cue` slash command
├── profiles/                         unchanged
├── docs/                             unchanged + docs/launch.md, docs/shell-install.md
├── setup/                            unchanged
├── agents-fleet/                     unchanged (orthogonal)
└── test/                             unchanged
```

Things that don't move (orthogonal to the profile manager):
`agents-fleet/`, `bin/envoult*`, `bin/medusa-dev`, `setup/`.

## 10. Migration

1. `git mv soul cue` (single commit). Tag `pre-cue` on the source branch first
   for a clean revert point.
2. `grep -rl 'soul' --include='*.md' --include='*.sh' --include='*.ts'` and
   fix `package.json`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `setup/*.md`.
3. Run `cue migrate-symlinks` to rewrite every symlink under
   `~/.codex/skills/` and `~/.claude-accounts/*/skills/` from `…/soul/…` to
   `…/cue/…`. The command is idempotent and dry-run-safe.
4. `bin/soul` tombstone stays for 2 weeks, prints a deprecation banner, and
   execs `cue` with the same args.

## 11. Error handling

| Scenario                                       | Behaviour                                                                                                  |
|------------------------------------------------|------------------------------------------------------------------------------------------------------------|
| Picker cancelled (Ctrl-C / esc)                | Exit 130. No launch. No pin written.                                                                       |
| Cwd pinned to a deleted profile                | Print one-line warning, fall through to picker.                                                            |
| Materialize fails mid-build                    | Atomic swap protects the old runtime dir. Print failing step + path to the kept temp dir for inspection.   |
| Real agent binary missing on PATH              | Exit 127 with `couldn't find the real 'claude' binary; PATH=…`.                                            |
| Shim recursion (`CUE_LAUNCHING=1` already set) | Exit non-zero with `shim recursion detected — check PATH ordering`.                                        |
| Stale `.cue-hash` from a hand-edited YAML      | Hash compare detects the change; materialize re-runs.                                                      |

## 12. Testing

Three tiers:

1. **Unit** — `bun test` coverage on `src/resolve/`, `src/materialize/`,
   `src/picker/`. Fixtures from `profiles/_examples/` (extend as needed).
   Target: 80%+ line coverage on resolve + materialize.
2. **Integration** — `test/integration/launch.test.ts` runs
   `cue launch claude --dry-run` against fixture cwds and asserts the
   resolved env + materialized dir layout. `--dry-run` is a new flag that
   skips the final `exec`.
3. **Manual smoke** — `test/manual/README.md` walkthrough: install shim,
   launch claude in 3 cwds with different pins, verify the right skills
   appear via `/skills` inside the session. Run once before merge.

No end-to-end browser-driving tests; the agent UI is out of scope.

## 13. Rollout

1. Land rename + reorg as one commit. Tag `pre-cue` first.
2. Add `cue launch`, `cue shell install`, materializer wiring. Existing
   subcommands (`list`, `new`, `validate`, `use`, `scan`, `doctor`) keep
   working without behaviour change.
3. Ship the `cue` slash-command plugin under `plugins/cue/`. Register it in
   the default profile's `plugins:` list.
4. Manual smoke against `medusa-dev`, `frontend`, and `full` profiles. Verify
   `~/.codex/skills/` symlinks survive after `cue migrate-symlinks`.
5. Update `setup/*.md` and `AGENTS.md` to reflect the new name and the new
   launch flow.
6. Remove `bin/soul` tombstone after 2 weeks.

## 14. Out of scope (deliberate)

- Daemon mode / IPC picker.
- Per-profile auth identity (authmux's domain).
- Web or Electron picker UI.
- Migrating Claude Code's plugin marketplaces config (stays global).
- Live mid-session swap of skills/MCPs/plugins.
