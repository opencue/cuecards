<div align="center">

# cuecards

**Your agent reads every skill you own, on every message. cue loads only the ones that project needs.**

<p align="center">
  <img src="https://raw.githubusercontent.com/opencue/cuecards/main/docs/assets/hero.svg" alt="cuecards — agent profile manager for Claude Code and Codex" width="820">
</p>

<p align="center">
  <a href="https://github.com/opencue/cuecards/stargazers"><img src="https://img.shields.io/github/stars/opencue/cuecards?style=for-the-badge&logo=github&label=%E2%AD%90%20Star%20this%20repo&color=yellow" alt="Star cuecards on GitHub"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cue-ai"><img src="https://img.shields.io/npm/v/cue-ai?style=for-the-badge&logo=npm&logoColor=white&label=npm&color=cb3837" alt="npm version"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/cue-ai"><img src="https://img.shields.io/npm/dw/cue-ai?style=for-the-badge&label=downloads&color=2b3137" alt="npm downloads"></a>
  &nbsp;
  <a href="https://github.com/opencue/cuecards/blob/main/LICENSE"><img src="https://img.shields.io/github/license/opencue/cuecards?style=for-the-badge&label=license&color=4c1" alt="MIT license"></a>
  &nbsp;
  <img src="https://img.shields.io/badge/node-%E2%89%A520-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node 20+">
  &nbsp;
  <img src="https://img.shields.io/badge/telemetry-none-success?style=for-the-badge" alt="zero telemetry">
</p>

[Install](#install) · [How it works](#how-it-works) · [Profiles](#85-ready-made-cuecards) · [Multi-agent](#one-cuecard-ten-agents) · [FAQ](#faq) · [Contributing](#contributing)

</div>

---

## Install

**Already have an agent open?** Paste this into Claude Code, Codex, Cursor, or
whatever you use — it installs cue and sets up this project, asking before it
touches anything:

```text
Install cue (https://github.com/opencue/cuecards) on this machine and set it up
for this project.

1. Check Node >= 20 with `node --version`. If it's missing or older, stop and tell me.
2. Check whether cue is already installed: `command -v cue`. If it resolves, skip to 4.
3. Ask me before installing anything, then run: `npm install -g cue-ai`
4. Run `cue auto-detect --json`. Show me the profile suggestions it returns and what
   each one is for, and let me pick one — don't choose for me.
5. Run `cue setup --profile <the one I picked> --yes`. That pins the profile and
   installs the shim that makes `claude`/`codex` load it. It will not enable
   telemetry and will not install third-party skills.
6. If it prints PATH guidance, show it verbatim — the shims do nothing until that
   line is added.
7. Report which profile got pinned and whether the shim is active. Mention that
   `install.sh --uninstall` undoes it.

Do not install anything without asking me first.
```

**Rather type it yourself?**

```bash
npm install -g cue-ai && cue setup
```

`cue setup` installs the `claude`/`codex` shim, scans this project, shows what
the matching profile costs against loading everything, and pins it. Requires
Node ≥ 20 and an existing [Claude Code](https://github.com/anthropics/claude-code)
or [Codex](https://github.com/openai/codex) install — cue is a thin shim that
hands off to your real agent, not a replacement for it.

Three things happen when you type `claude` afterwards:

1. The shim resolves this directory's `.cue.profile`.
2. cue materializes only that profile's skills, MCPs, and persona into a runtime.
3. The real Claude Code binary starts against it.

Pin a different project to a different profile:

```bash
cd ~/projects/my-shop
cue use medusa-dev      # writes .cue.profile in this directory
claude                  # launches with the medusa-dev loadout
```

Not sure which fits? `cue auto-detect` reads your project (package.json,
pyproject.toml, Cargo.toml, …) and suggests one.

<details>
<summary>Other install paths (script, clone, guided)</summary>

| Path | Command |
|---|---|
| One-line script | `curl -fsSL https://raw.githubusercontent.com/opencue/cuecards/main/get.sh \| bash` |
| Manual clone | `git clone https://github.com/opencue/cuecards.git && ./cuecards/install.sh` |
| Per-OS notes (Homebrew, WSL2, PowerShell PATH) | [setup/macos.md](https://github.com/opencue/cuecards/blob/main/setup/macos.md) · [setup/linux.md](https://github.com/opencue/cuecards/blob/main/setup/linux.md) · [setup/windows.md](https://github.com/opencue/cuecards/blob/main/setup/windows.md) |

All paths are idempotent — safe to re-run. `install.sh --help` lists `--yes`,
`--codex`, `--uninstall`.

</details>

---

## Why this exists

If you've been using AI coding agents for a while, you've probably collected a pile of skills, MCP servers, and custom instructions. Maybe hundreds. Here's the problem:

**your agent re-reads all of them, on every single message** — including the 95% that have nothing to do with the task in front of it.

That hurts twice:

1. **You pay for it.** Every always-loaded skill description and MCP schema is input tokens, billed on every turn of every session.
2. **Your agent gets dumber.** Picking the right tool out of 330 irrelevant ones is harder than picking it out of 12 relevant ones.

cue fixes this by scoping everything per directory. Your Medusa shop loads the Medusa cuecard. Your Rust CLI loads the Rust cuecard. Nothing else comes along for the ride.

### Before vs after — in numbers

<p align="center">
  <img src="https://raw.githubusercontent.com/opencue/cuecards/main/docs/assets/isolation-comparison.svg" alt="Everything-loaded vs a scoped cuecard — always-on context compared" width="820">
</p>

| Loadout | Always-on context | Cost / 100 msgs (Sonnet input) |
|---|---|---|
| Everything loaded (`full` profile) | ~81k tokens | ~$24 |
| `backend` cuecard | ~9k tokens | ~$2.70 |
| `caveman-quick` cuecard | ~6.8k tokens | ~$2.00 |

That's **9–16× less always-on context**, compounding on every message. Reproduce the numbers yourself:

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

## How it works

No daemon, no background process. cue intercepts the *call* to your agent, resolves the directory's cuecard, materializes it once, then hands off to the real binary:

<p align="center">
  <img src="https://raw.githubusercontent.com/opencue/cuecards/main/docs/assets/architecture.svg" alt="cue resolve to materialize to exec flow" width="820">
</p>

```
you type `claude`
       │
       ▼
 ~/.config/cue/shims/claude ──► cue launch
       │
       ▼
 resolve  ──►  which cuecard owns this directory?  (.cue.profile / auto-detect)
       │
       ▼
 materialize ──►  build the runtime (skills + MCPs + persona + gates)
       │           sha256-cached — rebuilds only when something changed
       ▼
 exec  ──►  the real Claude Code / Codex, scoped to this project
```

Cold start 50–200 ms, warm start under 5 ms. Nothing stays resident. Full flow: [docs/launch.md](https://github.com/opencue/cuecards/blob/main/docs/launch.md).

---

## 85 ready-made cuecards

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
cue list           # see all 85
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

<p align="center">
  <img src="https://raw.githubusercontent.com/opencue/cuecards/main/docs/assets/optimizer-dashboard.svg" alt="cue optimizer dashboard — skills, MCPs, CLIs, and usage per profile" width="820">
</p>

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
arbitrary `add` string. See [web/AUTH.md](https://github.com/opencue/cuecards/blob/main/web/AUTH.md) for the auth model,
self-hosting, and `CUE_API_URL` (point the CLI at a different deployment).

---

## Shell setup

`cue shell install` (Quickstart step 2) writes the `~/.config/cue/shims/claude` shim and the PATH line for it. Two more lines round out the experience — drop them in your `.bashrc` / `.zshrc` / fish config:

```bash
eval "$(cue shell hook)"   # auto-switch profile when you cd into a project (bash/zsh/fish, auto-detected)
export CUE_KITTY=1          # inline profile-picker images in Kitty (CUE_DISABLE_KITTY_IMAGES=1 to opt out)
```

<details>
<summary><b>A real <code>.bashrc</code>, for reference</b> — agent wrappers, gitignored MCP secrets, parallel Claude accounts, and a per-session cost readout. Lift what's useful.</summary>

```bash
# --- cue -------------------------------------------------------------
eval "$(cue shell hook)"        # auto-switch profile on cd
export CUE_KITTY=1              # inline picker images in Kitty

# Source local MCP/API tokens so servers cue launches inherit them.
# Keep these files chmod 600 and out of git — never commit secrets.
[ -f "$HOME/.config/cue/secrets.env" ] && . "$HOME/.config/cue/secrets.env"
if [ -f "$HOME/.config/cue/runtime/<profile>/secrets.env" ]; then
  set -a; . "$HOME/.config/cue/runtime/<profile>/secrets.env"; set +a
fi

# Launch Codex through cue, inheriting GitHub auth from the gh keyring
# (token pulled at runtime, never written to the rc file).
codex() {
  local tok; command -v gh >/dev/null && tok="$(gh auth token 2>/dev/null)"
  local prof="${CUE_CODEX_PROFILE:-core}"
  if command -v cue >/dev/null && [ -z "${CUE_SKIP_LAUNCH:-}" ]; then
    GH_TOKEN="$tok" GITHUB_TOKEN="$tok" cue launch codex --cue-profile "$prof" "$@"
  else
    GH_TOKEN="$tok" GITHUB_TOKEN="$tok" command codex "$@"
  fi
}

# Parallel Claude accounts — each gets its own CLAUDE_CONFIG_DIR + profile.
# Usage: claude-acct work pick   |   claude-acct personal backend
claude-acct() {
  local dir="$HOME/.claude-accounts/$1" prof="${2:-pick}"; shift 2 2>/dev/null
  if [ "$prof" = "pick" ]; then
    CLAUDE_CONFIG_DIR="$dir" cue launch claude --cue-pick "$@"
  else
    CLAUDE_CONFIG_DIR="$dir" cue launch claude --cue-profile "$prof" "$@"
  fi
}

# Open Claude in a fresh detached Kitty window (sidesteps tmux repaint contention).
kcc() { kitty --detach --title "claude${1:+ ($1)}" -- bash -lc "cd ${1:-$PWD} && exec claude" & disown; }

# Per-session token + cost readout from the live Claude transcript.
cc-tokens() {
  local f; f=$(ls -t ~/.claude/projects/*/*.jsonl 2>/dev/null | head -1)
  [ -z "$f" ] && { echo "No session log found"; return 1; }
  python3 - "$f" <<'PY'
import sys, json, re
totals, turns = {}, 0
for line in open(sys.argv[1]):
    try: e = json.loads(line)
    except Exception: continue
    if e.get("type") != "assistant": continue
    u = e.get("message", {}).get("usage") or {}
    if not u: continue
    turns += 1
    m = re.sub(r"^[a-z]{2}\.", "", e["message"].get("model", "?"))
    t = totals.setdefault(m, {"in": 0, "out": 0, "cr": 0, "cc": 0})
    t["in"] += u.get("input_tokens", 0);  t["out"] += u.get("output_tokens", 0)
    t["cr"] += u.get("cache_read_input_tokens", 0); t["cc"] += u.get("cache_creation_input_tokens", 0)
PRICE = {  # $/Mtok: input, cache-read, cache-write, output
    "claude-opus-4-8": (15, 1.5, 18.75, 75), "claude-sonnet-4-6": (3, .3, 3.75, 15),
    "claude-haiku-4-5": (.8, .08, 1, 4)}
DEF = (3, .3, 3.75, 15)
print(f"\n{'Model':<20}{'In':>9}{'Out':>8}{'CacheR':>9}{'Cost$':>9}")
for m, t in totals.items():
    p = PRICE.get(m, DEF)
    cost = t['in']*p[0]/1e6 + t['cr']*p[1]/1e6 + t['cc']*p[2]/1e6 + t['out']*p[3]/1e6
    print(f"{m:<20}{t['in']:>9,}{t['out']:>8,}{t['cr']:>9,}${cost:>8.4f}")
print(f"\n{turns} turns this session")
PY
}
# --- /cue ------------------------------------------------------------
```

> Secrets are sourced from gitignored files (`chmod 600`), never hardcoded, and the GitHub token is read from `gh` at runtime — nothing sensitive lives in your rc. `cue cost` gives the per-profile budget; `cc-tokens` above is the live per-session spend.

</details>

---

## FAQ

<details>
<summary><b>Does this break Claude Code's auto-update?</b></summary>

No. cue never touches the `claude` binary, and never writes to `~/.local/bin` where the native installer keeps it. It intercepts the *call* via a one-line bash shim in its own `~/.config/cue/shims/`, sets `CLAUDE_CONFIG_DIR`, and `exec`s the real binary. Updates work exactly as before — the installer rewrites its symlink, the shim is untouched, and the next launch picks up the new version.
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

---

<div align="center">

Built by [Viktor Nagy](https://github.com/NagyVikt) at [opencue](https://github.com/opencue) · [opencue.github.io/cuecards](https://opencue.github.io/cuecards/)

**If cue saves you tokens, star it — that's how other people find it.**

<a href="https://github.com/opencue/cuecards/stargazers"><img src="https://img.shields.io/github/stars/opencue/cuecards?style=for-the-badge&logo=github&label=%E2%AD%90%20Star%20this%20repo&color=yellow" alt="Star cuecards on GitHub"></a>

License: [MIT](https://github.com/opencue/cuecards/blob/main/LICENSE) · zero telemetry · no daemon

</div>
