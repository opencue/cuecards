# cuecards

**Give your AI coding agent the right context for every project — and nothing else.**

cue is a profile manager for AI coding agents like [Claude Code](https://github.com/anthropics/claude-code) and [Codex](https://github.com/openai/codex). You pick (or auto-detect) a *cuecard* for each project directory, and when you launch your agent, cue loads only the skills, MCP servers, persona, and quality gates that project actually needs — instead of your entire library.

<p align="center">
  <img src="https://raw.githubusercontent.com/opencue/cuecards/main/docs/assets/hero.svg" alt="cuecards — Agent Profile Manager for AI coding agents" width="820">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cue-ai"><img src="https://img.shields.io/npm/v/cue-ai?style=flat-square&label=npm&color=1d1d1f&labelColor=f5f5f7" alt="npm"></a>&nbsp;
  <a href="https://www.npmjs.com/package/cue-ai"><img src="https://img.shields.io/npm/dw/cue-ai?style=flat-square&label=downloads&color=1d1d1f&labelColor=f5f5f7" alt="downloads"></a>&nbsp;
  <a href="https://github.com/opencue/cuecards/stargazers"><img src="https://img.shields.io/github/stars/opencue/cuecards?style=flat-square&label=stars&color=1d1d1f&labelColor=f5f5f7" alt="stars"></a>&nbsp;
  <a href="https://github.com/opencue/cuecards/blob/main/LICENSE"><img src="https://img.shields.io/github/license/opencue/cuecards?style=flat-square&label=license&color=1d1d1f&labelColor=f5f5f7" alt="MIT"></a>&nbsp;
  <img src="https://img.shields.io/badge/telemetry-none-1d1d1f?style=flat-square&labelColor=f5f5f7" alt="zero telemetry">
</p>

```bash
npm install -g cue-ai
```

> Requires Node ≥ 20 and an existing [Claude Code](https://github.com/anthropics/claude-code) or [Codex](https://github.com/openai/codex) install. cue is a thin shim that hands off to your real agent — not a replacement for it.
>
> package `cue-ai` · command `cue` · repo [opencue/cuecards](https://github.com/opencue/cuecards)

---

## Why does this exist?

If you've been using AI coding agents for a while, you've probably collected a pile of skills, MCP servers, and custom instructions. Maybe hundreds. Here's the problem:

**your agent re-reads all of them, on every single message** — including the 95% that have nothing to do with the task in front of it.

That hurts twice:

1. **You pay for it.** Every always-loaded skill description and MCP schema is input tokens, billed on every turn of every session.
2. **Your agent gets dumber.** Picking the right tool out of 330 irrelevant ones is harder than picking it out of 12 relevant ones.

cue fixes this by scoping everything per directory. Your Medusa shop loads the Medusa cuecard. Your Rust CLI loads the Rust cuecard. Nothing else comes along for the ride.

### What that saves, in numbers

| Loadout | Always-on context | Cost / 100 msgs (Sonnet input) |
|---|---|---|
| Everything loaded (`full` profile) | ~81k tokens | ~$24 |
| `backend` cuecard | ~9k tokens | ~$2.70 |
| `caveman-quick` cuecard | ~6.8k tokens | ~$2.00 |

That's **9–16× less always-on context**, compounding on every message. You can reproduce these numbers yourself:

```bash
cue cost              # token budget for your active profile
cue cost --compare    # every profile ranked against the `full` baseline
```

---

## What is a cuecard?

A cuecard (also called a *profile*) is everything your agent needs to be useful in one project, bundled into a single `profile.yaml`:

| Layer | What it controls |
|---|---|
| **Skills** | Only the ones this project actually needs |
| **MCP servers** | Scoped per directory — no global sprawl |
| **Plugins** | The Claude Code plugins this project wants, no more |
| **Persona** | How the agent thinks, writes, and self-edits |
| **Playbooks** | Step-by-step procedures for known tasks |
| **Gates** | What must pass before the agent can claim "done" |

One cuecard per project. Your agent reads the right one the moment you launch it. That's what makes a cuecard more than a skills list — it's composable expertise, not just "more tools loaded."

---

## Quickstart

Five commands from zero to a profile-aware agent:

```bash
npm install -g cue-ai                     # 1. install
cue shell install                         # 2. activate the claude shim (one-time; add --codex for codex)
cue discover search "code review"         # 3. find a skill you want
cue discover install review/code-review   # 4. add it to your cuecard
claude                                    # 5. launch — your cuecard is loaded
```

Step 2 is the magic: it installs a tiny `~/.local/bin/claude` shim that hands off to `cue launch`. From then on, typing `claude` in any directory loads that directory's cuecard first, then starts the real Claude Code. Skip step 2 and `claude` just runs vanilla.

To pin a project to a profile:

```bash
cd ~/projects/my-shop
cue use medusa-dev      # writes .cue.profile in this directory
claude                  # launches with the medusa-dev loadout
```

Not sure which profile fits? `cue auto-detect` reads your project (package.json, pyproject.toml, Cargo.toml, …) and suggests one.

---

## 69 ready-made cuecards

cue ships with pre-built profiles for common stacks and workflows. A taste:

| Profile | What it's for |
|---|---|
| 🐢 **core** | Minimal baseline shared by every profile |
| 🐻 **backend** | APIs, webhooks, security review, CI, databases, deploys |
| 🦋 **frontend** | UI implementation, redesigns, screenshots, browser testing |
| ▲ **nextjs** | Next.js App Router, Server Components, Vercel |
| 🐍 **python** | FastAPI/Django/Flask, SQLAlchemy, pytest |
| 🦀 **rust** | Async, web, CLI/TUI, embedded, FFI, WASM |
| 🦊 **medusa-dev** | Medusa v2 backend, storefront, admin |
| 🔒 **cybersecurity** | 754 red/blue-team skills + audit tooling |
| 🦜 **marketing** | Copywriting, SEO, CRO, growth |
| 🐝 **docs-writer** | Documentation, Markdown, PDF, structured writing |
| 🏢 **agency** | 63 delegatable subagents — design, sales, product, PM, QA |

```bash
cue list           # see all 69
cue auto-detect    # suggest the right one for the current directory
cue use <name>     # pin it
```

Full machine-readable catalog: [docs/data/profiles.md](https://github.com/opencue/cuecards/blob/main/docs/data/profiles.md). Nothing fits? `cue ai "describe your stack"` scaffolds a new one.

---

## One cuecard, ten agents

The same `profile.yaml` materializes into each agent's native config format — write your setup once, use it everywhere:

| Agent | Output |
|---|---|
| Claude Code / Codex | runtime dirs under `~/.config/cue/runtime/` (via the shim) |
| Cursor | `.cursorrules` + `.cursor/mcp.json` |
| Cline | `.clinerules` + `cline_mcp_settings.json` |
| Gemini CLI | `~/.gemini/skills/*.md` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Windsurf | `.windsurfrules` + `.windsurf/mcp.json` |
| Roo Code | `.roo/rules/*.md` + `.roo/mcp.json` |
| Sourcegraph Amp | `AGENTS.md` + `.amp/mcp.json` |
| Aider | `.aider.conventions.md` |

```bash
cue materialize cursor --profile backend   # one agent
cue materialize --all --profile backend    # all ten at once
```

---

## Built-in rigor

cuecards don't just load tools — they hold your agent to a standard.

**The reviewer gate.** Profiles can enable an independent review gate: when the agent finishes a code-producing turn, cue spawns a *fresh, separate* reviewer agent over the diff before the turn is allowed to finish. A real catch from a live session: the reviewer flagged a unit bug where a product's `weight` was kilograms in one place and grams in two others — left in, carts would have displayed `20000 kg`. The gate held the merge until it was fixed.

Enable it with `touch ~/.config/cue/auto-review-enabled`, watch reviews live with `cue-review-watch`, and skip one turn with `[skip-auto-review]`. Details: [docs/review-visibility.md](https://github.com/opencue/cuecards/blob/main/docs/review-visibility.md).

**Confidence tags.** cue-managed agents tag research- and decision-relevant claims with colored confidence markers so you can scan trust at a glance:

| Tier | Tags | Meaning |
|---|---|---|
| 🟢 | `[VERIFIED]` `[KNOWN]` | Checked firsthand / well-documented fact |
| 🟡 | `[INFERRED]` `[ASSUMED]` | Deduced or assumed — verify if stakes matter |
| 🟠 | `[GUESSED]` `[STALE]` | Pattern-match or possibly outdated — verify first |
| 🔴 | `[UNKNOWN]` | The agent said "I don't know" instead of making it up |

---

## Everyday commands

```bash
# Profiles
cue use <profile>            # pin a profile to this directory
cue list                     # all available profiles
cue auto-detect              # suggest one for the current project

# Cost
cue cost                     # token budget for the active profile
cue cost --compare           # all profiles ranked vs `full`

# Skills & discovery
cue discover search <query>  # find skills on GitHub
cue discover install <skill> # install one
cue lint-skill <path> --fix  # validate a SKILL.md

# Marketplace (push your own to cuecards.cc)
cue marketplace login --token <t>          # save the API token from the studio → API view
cue marketplace publish profile ship-fast  # push a profile / skill / mcp for everyone

# Health
cue doctor --fix             # diff declared vs actual state, auto-repair
cue optimizer                # dashboard: skills, MCPs, CLIs, usage per profile
cue failures --propose       # let Claude draft profile improvements from failures
```

`cue --help` shows the full ~50-subcommand surface; the set above covers a typical week.

---

## API

cuecards.cc gives every account a free, per-user **API token** and a small HTTP
API. Mint a token in the studio (`cue dashboard` → **API** view, or
[cuecards.cc](https://cuecards.cc)), then use it from your own machine to push
profiles, skills, and MCPs to the community marketplace.

```bash
# 1. Save the token (verifies it against the server before writing ~/.config/cue/credentials.json)
cue marketplace login --token cue_sk_…       # or: export CUE_API_TOKEN=cue_sk_…
cue marketplace whoami                        # confirm which account you're authenticated as

# 2. Push something to the marketplace
cue marketplace publish profile ship-fast --tags build,review
cue marketplace publish skill seo-audit --source-url https://github.com/me/skills
cue marketplace publish mcp my-server --desc "internal tooling MCP"
```

Authenticate HTTP calls with a Bearer header (the token also works as
`x-api-key`):

```bash
curl https://cuecards.cc/api/v1/me            -H "Authorization: Bearer $CUE_API_TOKEN"
curl https://cuecards.cc/api/v1/community     # public community catalog (no auth)
curl https://cuecards.cc/api/v1/community     -H "Authorization: Bearer $CUE_API_TOKEN" \
  -X POST -H 'content-type: application/json' \
  -d '{"type":"profile","name":"ship-fast","tags":["build"]}'
```

Install commands are **derived server-side** — a submission can never inject an
arbitrary `add` string. See [web/AUTH.md](web/AUTH.md) for the auth model,
self-hosting, and `CUE_API_URL` (point the CLI at a different deployment).

---

## Install options

| Path | Command |
|---|---|
| npm (recommended) | `npm install -g cue-ai` |
| One-line script | `curl -fsSL https://raw.githubusercontent.com/opencue/cuecards/main/get.sh \| bash` |
| Manual clone | `git clone https://github.com/opencue/cuecards.git && ./cuecards/install.sh` |
| Guided (paste into Claude Code) | [setup/macos.md](https://github.com/opencue/cuecards/blob/main/setup/macos.md) · [setup/linux.md](https://github.com/opencue/cuecards/blob/main/setup/linux.md) · [setup/windows.md](https://github.com/opencue/cuecards/blob/main/setup/windows.md) |

All paths are idempotent — safe to re-run. `install.sh --help` lists `--yes`, `--codex`, `--uninstall`.

---

## FAQ

<details>
<summary><b>Does this break Claude Code's auto-update?</b></summary>

No. cue never touches the `claude` binary — it intercepts the *call* via a one-line bash shim in `~/.local/bin/claude`, sets `CLAUDE_CONFIG_DIR`, and `exec`s the real binary. Updates work exactly as before.
</details>

<details>
<summary><b>Is this a daemon?</b></summary>

No. Pure CLI. When you type `claude`, the shim runs `cue launch`, compares a sha256, materializes only if something changed, then `exec`s. Nothing stays resident.
</details>

<details>
<summary><b>How much overhead does it add?</b></summary>

Cold start 50–200 ms; warm start under 5 ms. Imperceptible next to your agent's own startup.
</details>

<details>
<summary><b>Does cue send telemetry?</b></summary>

No. Everything cue computes — including the per-skill usage bars in `cue optimizer` — reads from your local transcript files. Nothing leaves your machine.
</details>

<details>
<summary><b>What does cue NOT do?</b></summary>

- It doesn't modify or repackage the Claude Code / Codex binaries.
- It doesn't lock you in — skills live in your repo or come from open source; the optional [cuecards.cc marketplace](#api) is just a sharing layer you push to with your own token, never a requirement.
- It doesn't coordinate multi-agent runs (that's [colony](https://github.com/recodeee/colony) + [gitguardex](https://github.com/recodeee/gitguardex), layered on top via the parallel-agents tier).
</details>

---

## How it compares

|  | cuecards | skillport / agent-skills-cli | Kiro Powers |
|---|---|---|---|
| Skills | ✅ | ✅ | ✅ |
| MCPs | ✅ | — | ✅ |
| Plugins | ✅ | — | — |
| Per-directory profiles | ✅ | — | ◐ (IDE-only) |
| Inheritance | ✅ | — | — |
| Persona / playbooks / gates | ✅ | — | — |
| Multi-agent (Cursor/Cline/Copilot/…) | ✅ (10) | Claude only | IDE-only |
| Failure-feedback loop | ✅ | — | — |
| Daemon required | none | none | IDE process |

---

## Deep dives

| Topic | Read |
|---|---|
| Launch flow (resolve → materialize → exec) | [docs/launch.md](https://github.com/opencue/cuecards/blob/main/docs/launch.md) |
| Full profile catalog | [docs/data/profiles.md](https://github.com/opencue/cuecards/blob/main/docs/data/profiles.md) |
| Bootstrap contract for AI agents installing cue | [AGENTS.md](https://github.com/opencue/cuecards/blob/main/AGENTS.md) |
| Parallel agents tier (Colony + gitguardex) | [setup/parallel-agents.md](https://github.com/opencue/cuecards/blob/main/setup/parallel-agents.md) |
| Confidence-tag system | [integrity-tags/SKILL.md](https://github.com/opencue/cuecards/blob/main/resources/skills/skills/meta/integrity-tags/SKILL.md) |

---

## Contributing

```bash
git clone https://github.com/opencue/cuecards.git
cd cuecards && bun install
bun test                          # tests (lib + commands)
bun run src/index.ts --help       # run locally
```

| Want to | Run |
|---|---|
| Add a skill | `cue skills-new <name>`, then edit `resources/skills/skills/<category>/<name>/SKILL.md` |
| Add a profile | `cue new <name>`, then `cue validate <name>` |
| Share your profile | `cue share publish --profile <name>` |
| Report a bug | [Open an issue](https://github.com/opencue/cuecards/issues) |

License: [MIT](https://github.com/opencue/cuecards/blob/main/LICENSE) · zero telemetry · no daemon
