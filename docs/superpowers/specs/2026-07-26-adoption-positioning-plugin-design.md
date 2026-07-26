# Adoption: one pitch, one command, one install path

**Date:** 2026-07-26
**Status:** approved, ready for implementation planning

## Problem

cue has ~100 subcommands, 90 profiles, a marketplace, a web studio, and a fully
written marketing playbook in `docs/marketing/`. None of the playbook has been
executed — not a single checkbox is marked. The bottleneck is not knowing what
to do; it is that three specific things block every channel before it starts:

1. **Two different products are advertised on two surfaces.** `README.md` sells
   scoping ("the right context for every project — and nothing else"). The
   GitHub Pages landing (`docs/index.md`) sells discovery ("Discover skills your
   AI agent is missing"). People cannot repeat in one sentence what cue is, so
   there is no word of mouth and no SEO focus.

2. **cue cannot be installed from inside Claude Code.** A plugin exists at
   `plugins/cue/` with six slash commands, but there is no
   `.claude-plugin/marketplace.json` at the repo root, so
   `/plugin marketplace add opencue/cuecards` fails. The highest-intent
   discovery channel — people already sitting in Claude Code looking for
   tooling — is closed.

3. **"Install it and it works" is not true today.** Getting to a working cue
   takes three commands (`npm install -g cue-ai`, `cue shell install`,
   `cue init`), and the shim step fails silently when `~/.local/bin` is not on
   `PATH`.

Supporting drift found while scoping, all in the same class as (1):

- Root `llms.txt` states the pin file is `.cue-profile`; the real file is
  `.cue.profile`.
- Root `llms.txt` gives the repo as `opencue/claude-code-skills`;
  `package.json` says `opencue/cuecards`.
- Root `llms.txt` says "16 profiles ship by default"; `README.md` says 69 in two
  places; `profiles/` actually holds 85 directories containing a `profile.yaml`.

## Non-goals

- **This work does not measure whether discovery improved.** That shows up in
  npm downloads and star delta over weeks. This removes three blockers; the
  measurement is separate work.
- **No paid acquisition, no influencer outreach, no Show HN.** Show HN fires
  once and is deliberately held until positioning is settled.
- **The programmatic-SEO engine is not touched.** The nightly discover scan,
  `docs/discovered.md`, and the per-profile pages keep running exactly as they
  do. They are the acquisition channel, not the product.
- **No new profiles, no CLI feature work** beyond the single `cue setup`
  command described below.

## Decision: cue is a scoper

cue is positioned as a **scoper** — it loads less. Discovery (`cue discover`)
remains a real feature and the SEO engine, but it is never the headline.

Two canonical strings, stored in `docs/marketing/positioning.md` as the single
source of truth. They do different jobs and must not be merged.

**The repeatable claim** — README H1, HN title, social, OG card. Optimized for a
human repeating it to another human:

> Your agent reads every skill you own, on every message. cue loads only the
> ones that project needs.

**The searchable descriptor** — npm, awesome-list entries, GitHub About,
`/plugin search`. Optimized for keyword match, not for wit:

> Per-project profile manager for Claude Code, Codex, and 8 other AI coding
> agents — scopes which skills and MCP servers load, per directory.

Neither contains the word "discover".

## Workstream B — canonical copy across eight surfaces

| Surface | Current | Becomes |
|---|---|---|
| `package.json` `description` | "Agent Profile Manager for Claude Code & Codex. Pick a profile, launch with the right skills, MCPs, and plugins." | descriptor |
| `README.md` H1 + subtitle | "Give your AI coding agent the right context for every project — and nothing else." | claim |
| `docs/index.md` front-matter `title`/`description` + H1 | "Discover skills your AI agent is missing" | claim |
| GitHub repo About + topics | — | descriptor + topics |
| `docs/marketing/awesome-lists.md` | three competing variants | one canonical entry = descriptor |
| `docs/assets/og-card.png` | — | claim |
| `plugins/cue/.claude-plugin/plugin.json` `description` | "Manage profiles, skills, and MCPs from inside a running session." | descriptor |
| `llms.txt` + `docs/llms.txt` | divergent, plus three factual errors | claim + descriptor, errors fixed |

The factual errors listed under Problem are corrected as part of this
workstream: `.cue-profile` → `.cue.profile`, repo URL → `opencue/cuecards`, and
the profile count → **85** everywhere it appears (`llms.txt` says 16, `README.md`
says 69 at lines 165 and 184). The count is the number of `profiles/*/profile.yaml`
files; if it has changed by implementation time, use the then-current count.

**Deliberately preserved:** the "Top 10 Hidden Gems" table in `docs/index.md`
and every nightly-generated discover page stay. They are already indexed. They
move below the fold and become evidence that the tool is alive, not the pitch.
The landing page install line changes from `cue discover search` to `cue setup`.

## Workstream S — `cue setup`

A new subcommand, `cue setup`, that performs `shell install` + `auto-detect` +
`init` as one guided flow. It is the only install instruction the README gives:

```bash
npm install -g cue-ai && cue setup
```

The `postinstall` message in `package.json`, which currently names two separate
follow-up commands, changes to name only `cue setup`.

`cue setup` must handle the failure modes that make the current promise false:

- **`~/.local/bin` not on `PATH`** — print the exact line to add, for the
  detected shell. Do not silently drop a shim that will never be found.
- **Neither `claude` nor `codex` present on the machine** — say so before
  installing anything, not after.
- **Re-run** — idempotent, matching the guarantee `install.sh` already makes.

Ordering inside the flow is deliberate and is the one place where the product's
central claim can be proven *before* trust is requested:

1. Ensure the `cue` CLI is present.
2. `cue auto-detect` + `cue cost --compare` — the user sees their own numbers.
3. `cue shell install` — stated plainly: it places a `~/.local/bin/claude` shim
   that intercepts the `claude` command, and it is undone with
   `install.sh --uninstall`.
4. `cue init`.

Step 2 runs before step 3 so the user sees the payoff before granting the
largest permission in the flow.

## Workstream A — marketplace entry point and plugin

### Files

```
.claude-plugin/marketplace.json       NEW — repo root. Without it,
                                      `/plugin marketplace add opencue/cuecards` fails.
plugins/cue/
  .claude-plugin/plugin.json          MOVED from plugins/cue/plugin.json
  commands/*.md                       unchanged in location
```

The manifest move matches every working plugin installed on disk (superpowers,
claude-seo): the manifest lives at `<plugin-root>/.claude-plugin/plugin.json`.

`marketplace.json` declares one marketplace (`cuecards`) containing exactly one
plugin (`cue`) with `source: "./plugins/cue"`.

### plugin.json changes

- Drop the explicit `commands[]` array. Working plugins on disk do not declare
  it; commands are discovered from `commands/`. Do not depend on a field with no
  live example.
- Add `homepage`, `repository`, `license`, `keywords` — these feed
  `/plugin search`, which is the discovery surface this workstream exists for.
- `description` becomes the canonical descriptor.

**Scope decision:** one plugin, named `cue`. Exposing the 90 profiles as 90
marketplace entries was considered and rejected — each is meaningless without
the CLI, and 90 dead entries are worse for discovery than one live one.

### Behaviour after install

The six slash commands shell out to the `cue` binary (e.g. `cue list --json`). A
user arriving from the marketplace has no `cue`, so today the install ends in
`command not found`. A dead marketplace entry is worse for discovery than no
entry, because it is the first impression.

- **`/cue-setup`** becomes the plugin's primary entry point. It invokes the
  `cue setup` flow described in Workstream S — it does not reimplement it. One
  flow, two entry points (CLI and slash command).
- The other five commands gain a single precondition line: if `cue` is not on
  `PATH`, instruct the user to run `/cue-setup` rather than surfacing a raw
  shell error.

**Deliberately cut:** shipping a *skill* in the plugin so the agent proactively
suggests cue ("you have 40 skills loaded, this could be scoped"). That is the
nagging pattern users resent, and it is new content to write. It can be added
later if wanted.

## Agent-paste install (amendment, 2026-07-26)

cue's target user is already sitting in front of an agent. The primary install
instruction is therefore a **copy-pasteable prompt**, not a shell command: the
user drops it into Claude Code, Codex, or Cursor and the agent performs the
install, relaying prompts and asking before it touches anything.

This path already exists in the repo as `setup/macos.md`, `setup/linux.md`, and
`setup/windows.md`, surfaced as the fourth row of a four-row install table. It
is promoted to the top and reduced to one OS-agnostic block.

The canonical text lives at `setup/agent-prompt.md` and is inlined verbatim in
the README. It is deliberately the same flow as the plugin's `/cue-setup` slash
command, so there is one description of the install, not three.

Constraints on the prompt:

- **It never installs without asking.** The final line is an explicit
  instruction to that effect, and step 3 asks before `npm install -g cue-ai`.
- **No `curl | bash`.** The agent runs named commands the user can read.
- **Agent-agnostic.** No Claude-specific or Codex-specific syntax, so the same
  block works wherever it is pasted.
- **It delegates to `cue setup`** rather than restating the steps `cue setup`
  performs, for the same reason `/cue-setup` does.

The README's Install section leads with this block, followed by the manual
`npm install -g cue-ai && cue setup` for people who would rather type it
themselves. The four-path table stays behind the `<details>` block as before.

## README restructure

The problem is order, not length: roughly 80 lines of argument precede the first
command, the Install section offers four paths in a table, and the marketplace
API-token section — a power-user topic — sits above the shell setup.

New first screen, and nothing more:

```
[claim]

npm install -g cue-ai && cue setup

[demo gif]
```

Below it, in order: three lines on what just happened (shim, profile, launch);
the numbers table as proof; then `cue use` / `cue auto-detect`.

Everything else moves down, unchanged in content: the profile catalog, the
ten-agent materialize table, built-in rigor, everyday commands, FAQ, comparison,
deep dives.

Moved **out** of the README into `docs/`, linked only:

- the marketplace API-token section
- the ~90-line Shell setup internals section

Neither is needed to get started.

The four install paths stay, collapsed behind a `<details>` block. The npm path
is the only one visible on the first screen.

The README remains entirely in English.

## Verification

**Workstream B.** The risk is not the rewrite; it is that the surfaces diverge
again in six months, which is exactly what happened. Mitigation:
`docs/marketing/positioning.md` holds the two strings, and one test asserts that
the `description` in `package.json` and in
`plugins/cue/.claude-plugin/plugin.json` match the canonical descriptor byte for
byte. A new test file under the existing `bun test` setup — not a new CI job.

The remaining six surfaces are prose and are checked by hand, plus a grep
proving the retired pitch (`"Discover skills your AI agent is missing"`) survives
nowhere outside git history.

**Workstream S.** Unit coverage for the three failure modes: `PATH` missing
`~/.local/bin`, no agent binary present, and re-run idempotency.

**Workstream A.** There is no meaningful unit test for "the marketplace actually
accepts this". The smallest check that proves it is manual, in a live Claude
Code session:

```
/plugin marketplace add /home/deadpool/Documents/cue
/plugin install cue@cuecards
```

then confirm `/cue-setup` and the five other commands appear. Alongside it, a
cheap test asserting both JSON files parse and carry their required key sets —
that catches the typo class, which is the realistic failure, not the semantics.

## Risks

- **The manifest-location and dropped-`commands[]` decisions are inferred from
  plugins installed on this machine, not from published schema documentation.**
  The manual marketplace check is what confirms them; if it fails, that check is
  where it surfaces, cheaply, before anything is announced.
- **`cue setup` wraps three existing commands.** If their individual flows
  change, `setup` drifts. Keeping `/cue-setup` a thin caller of `cue setup`
  rather than a parallel implementation limits this to one place.
- **Effort is larger than a single sitting**: eight copy surfaces, a README
  restructure, a new CLI command, and the plugin packaging. Ordering matters —
  B gates A and the README, because the plugin description and the awesome-list
  entry are both derived from the canonical strings.
