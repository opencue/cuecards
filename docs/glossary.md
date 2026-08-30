# cue Glossary

Formal definitions of every term cue uses. Each entry is written as a standalone sentence so LLMs (ChatGPT, Perplexity, Google AI Overviews) and traditional search engines can cite it directly.

_Last updated: 2026-05-24_

---

<a id="agent"></a>
## Agent

In cue, an **agent** is any AI coding assistant cue can materialize a profile for: Claude Code, OpenAI Codex, Cursor, Cline, Google Gemini CLI, GitHub Copilot, Windsurf, Roo Code, Sourcegraph Amp, or Aider. cue translates a single `profile.yaml` into each agent's native config format (`.cursorrules`, `.clinerules`, `~/.gemini/skills/*.md`, etc.) via the `cue materialize <agent>` command.

<a id="claude-code"></a>
## Claude Code

[Claude Code](https://github.com/anthropics/claude-code) is Anthropic's official command-line AI coding agent. It reads configuration from `~/.claude/` by default. cue intercepts the `claude` invocation via a shim and points it at a per-profile `CLAUDE_CONFIG_DIR` instead.

<a id="cli-recipe"></a>
## CLI recipe

A **CLI recipe** is a per-tool entry in `resources/cli-recipes.json` declaring how to install that CLI on each platform (apt, brew, dnf, pacman, snap, winget, pipx, pip, npm, script, or manual). The `cue cli install` command reads the recipe for each missing CLI and runs the right install command for the current OS.

<a id="eval"></a>
## Eval (eval scenario)

A **cue eval** is a structural fitness scenario declared as a markdown file under `resources/evals/<name>.md`. It declares "for task X, the profile should have skills A, B + commands C + recommended playbook D + recommended quality gate E." `cue eval-behavior <profile>` scores each declared scenario against the profile's actual loadout — no LLM call needed, pure structural check.

<a id="failure-loop"></a>
## Failure loop

The **failure loop** is cue's Phase 5 feedback mechanism. The `session-summary` Stop hook logs every session to `~/.config/cue/session-log.jsonl`. The `cue failures` command scans recent transcripts for failure markers (tool errors, retries, quality-gate vetoes, test failures, rollbacks). `cue failures --propose` bundles the top patterns + transcript excerpts + profile snapshot and asks Claude to draft concrete profile improvements as a markdown proposal file.

<a id="hook"></a>
## Hook (in cue profile)

A **hook** in a cue profile is a reference to a JSON file under `resources/hooks/` declaring Claude Code lifecycle hooks (`PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`). cue merges the declared hooks into the materialized `settings.json` and symlinks any companion scripts (`.sh`, `.py`) into `<runtime>/hooks/`. Universal safety hooks shipped with cue include `bash-quality-preflight.json` (blocks destructive shell commands), `secrets-guard.json` (refuses writes to `.env` / `id_rsa` / `credentials.json`), `commit-message-guard.json` (rejects one-word commits like "wip"), and `session-summary.json` (logs session end to the failure-loop database).

<a id="materialization"></a>
## Materialization

**Materialization** is the process by which cue builds a per-profile, per-agent runtime config directory at `~/.config/cue/runtime/<profile>/{claude,codex}/`. The materializer is content-addressed via sha256: if the resolved profile hasn't changed, materialization is a no-op (<5 ms warm path). On a cold rebuild it symlinks skills + rules + commands + playbooks + quality-gate scripts, writes `CLAUDE.md` (or `AGENTS.md`), merges hooks into `settings.json`, and overlays per-agent session state.

<a id="mcp"></a>
## MCP (Model Context Protocol server)

An **MCP server** implements the [Model Context Protocol](https://modelcontextprotocol.io) — a standard for exposing tools, resources, and prompts to AI agents. cue resolves declared MCP IDs (e.g. `gbrain`, `claude-mem`) against `resources/mcps/configs/*.sanitized.json` and writes them into the materialized agent config (`settings.json` for Claude Code, `config.toml` for Codex).

<a id="persona"></a>
## Persona (profile field)

A **persona** in a cue profile is a multi-line string that defines who the agent IS, not just what tools it has. cue injects it at the top of the materialized `CLAUDE.md` as a `## Your Expertise` block, priming the model with role-specific defaults ("You're a senior Rust engineer. You default to safety. You write tests first."). Personas use leaf-wins inheritance: child profiles override parent personas fully, since concatenation produces awkward "you are X. ALSO you are Y" priming.

<a id="playbook"></a>
## Playbook

A **cue playbook** is a markdown file under `resources/playbooks/` containing a proven step-by-step protocol for a recurring task type (e.g. `ship-feature.md`, `triage-bug.md`). Profiles opt in via `playbooks: [name, ...]` in `profile.yaml`. The materializer symlinks each declared playbook into `<runtime>/playbooks/` and indexes them in `CLAUDE.md` so the model consults the matching playbook when the user's request matches its trigger phrasing.

<a id="plugin"></a>
## Plugin (Claude Code plugin)

A **Claude Code plugin** is a published bundle of skills, commands, and hooks distributed through Anthropic's plugin marketplace system. cue's profiles declare plugins by `<plugin>@<marketplace>` identifier (e.g. `claude-mem@thedotmack`) and write the activation map into the materialized `settings.json` under `enabledPlugins`.

<a id="profile"></a>
## Profile

A **cue profile** is a directory under `profiles/<name>/` containing a `profile.yaml` that declares which skills, MCPs, plugins, rules, commands, hooks, persona, playbooks, quality gates, and evals are scoped to that profile. A profile inherits from at most one parent via `inherits:`, composing up to 3 levels deep. The active profile for a directory is resolved from `.cue.profile`, a repo-level default, a global default, or an interactive TUI picker — in that precedence order.

<a id="profile-yaml"></a>
## profile.yaml

`profile.yaml` is the **canonical declaration file** for a cue profile, validated against `profiles/schema.json`. Required fields are `name` (kebab-case slug matching the directory name) and `description` (one-line summary). Optional fields cover the 5 expert-agent dimensions plus the four core resource lists (skills, mcps, plugins, env). The full schema is at [`profiles/SCHEMA.md`](../profiles/SCHEMA.md).

<a id="quality-gate"></a>
## Quality gate

A **quality gate** is a per-profile validator script that runs at Claude Code's `Stop` event and vetoes "done" if the work doesn't meet the bar. Quality gates ship under `resources/quality-gates/` and profiles opt in via `qualityGates: [name, ...]`. The `tests-pass.sh` gate auto-detects bun, npm, pytest, cargo, or go and fails Stop if the project's test runner exits non-zero. Vetos surface to the user via stderr and force the model to fix the underlying issue before ending the session.

<a id="rule"></a>
## Rule (profile field)

A **rule** in a cue profile is a markdown file under `resources/rules/` containing coding standards, security policies, or workflow conventions (e.g. `common/security.md`, `typescript/patterns.md`). The materializer symlinks declared rules into `<runtime>/rules/` and indexes them in `CLAUDE.md` so the model reads them on demand — not inlined, to keep per-message token cost minimal.

<a id="shim"></a>
## Shim

A **cue shim** is the bash one-liner installed at `~/.local/bin/claude` (and `~/.local/bin/codex`) that intercepts every invocation of those binaries and routes it through `cue launch <agent>`. The shim is the seam that makes per-directory profile resolution invisible — users type `claude` like always, the right environment just shows up. Removed cleanly via `install.sh --uninstall`.

<a id="skill"></a>
## Skill

A **skill** is a markdown file (`SKILL.md`) declaring a single capability the AI agent can invoke. Its frontmatter contains `name`, `description` (the trigger string Claude's discovery matches against), `allowed-tools` (which CLIs the skill shells out to), and optional `tags`, `domain`, `category`. cue validates SKILL.md files against 8 spec-compliance rules (R001–R008) via `cue lint-skill`. A skill is not just a prompt — cue treats it as a wired capability backed by the right CLIs and MCPs being installed and connected before the session starts.

<a id="skill-md"></a>
## SKILL.md

`SKILL.md` is the canonical filename for a single Claude Code skill (introduced by Anthropic's official skill spec). Each lives in its own directory under either the cue repo's `resources/skills/skills/<category>/<slug>/SKILL.md` (vendored skills), `~/.claude/skills/<slug>/SKILL.md` (Claude-managed cache), or a third-party GitHub repo at any path. cue's lint engine, eval harness, and discovery flow all key on this filename.

<a id="trigger-phrase"></a>
## Trigger phrase

A **trigger phrase** is a verb-leading sentence in a skill's `description` frontmatter (e.g. *"Use when the user asks to analyze a video"*, *"Triggers on 'fix the bug where X'"*). Claude's skill discovery prefers descriptions with explicit trigger phrasing over noun-phrase descriptions ("A Python library for parsing X") — cue's R004 lint rule flags descriptions missing one.

---

## See also

- [`README.md`](../README.md) — main docs + 5-minute quickstart
- [`profiles/SCHEMA.md`](../profiles/SCHEMA.md) — full `profile.yaml` schema
- [`docs/launch.md`](./launch.md) — full resolve → materialize → exec flow
- [`docs/comparison/`](./comparison/) — cue vs each competitor, head-to-head
- [`docs/use-cases/`](./use-cases/) — domain-specific landing pages
