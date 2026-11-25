<div align="center">

# cuecards

**Project profiles for Claude Code and Codex.**

Give each repository its own skills, MCP servers, and instructions.<br>
Run the coding agent you already use.

[Install](#install) · [Profile catalog](#the-catalog) · [Compare tools](#how-it-compares) · [Community](https://cuecards.cc)

[![npm version](https://img.shields.io/npm/v/cue-ai)](https://www.npmjs.com/package/cue-ai)
[![MIT license](https://img.shields.io/github/license/opencue/cuecards)](LICENSE)

</div>

## Install

Requires Node.js 20+ and an existing [Claude Code](https://github.com/anthropics/claude-code)
or [Codex](https://github.com/openai/codex) installation. Run this in your project:

```sh
npm install -g cue-ai
cue setup
```

Setup suggests a profile and configures the launch shims. Open a fresh shell if
the setup output asks you to. Then run `claude` or `codex` as usual.

[Agent-guided setup](setup/lean-cue.md) · [macOS](setup/macos.md) · [Linux](setup/linux.md) · [Windows](setup/windows.md) · [Shell setup and removal](docs/shell-setup.md)

<img src="https://raw.githubusercontent.com/opencue/cuecards/main/docs/assets/demo.gif" alt="Terminal demo: selecting a project profile and launching a coding agent" width="760" loading="lazy">

## How it works

A **cuecard** is a reusable profile. For example, pin `backend` in an API repo
and `frontend` in a web app. Each gets a different set of tools instead of one
shared global loadout.

```sh
cue use backend   # pin this repository's .cue.profile
cue current       # see the profile selected for this directory
cue cost          # estimate its always-on context
```

At launch, Cue resolves the profile, prepares or reuses its runtime, and runs
the original Claude Code or Codex binary. No daemon. Other clients can receive
native config files through `cue materialize`; they do not use the launch shim.
[See the launch flow](docs/launch.md).

The interactive picker shows local matches first. Claude Code or Codex can
then suggest profiles and catalog skills from project signals, without
installing anything. Set `CUE_PROFILE_ADVISOR=off` to keep suggestions local.

## The catalog

Start with `core` for a minimal baseline, `backend` for API work, or
`frontend` for UI work. Use `cue auto-detect` for a suggestion, or `cue list`
to browse available profiles. [See the full catalog](docs/data/profiles.md).

## Skills and rules

| I want to… | Run |
| --- | --- |
| Find a skill on skills.sh without installing it | `cue discover search --skills-sh react` |
| Search GitHub instead | `cue discover search react` |
| Preview the active profile's rule files | `cue ruler --dry-run` |
| Check a Rulesync project's generated files for drift | `cue ruler --rulesync --check` |

[Integration setup and limits](docs/skill-and-rule-integrations.md) · [Independent review gate](docs/review-visibility.md)

## How it compares

| Use | When you want to… |
| --- | --- |
| **Cue** | Choose the context an agent starts with in each repository. |
| [HarnessKit](https://github.com/RealZST/HarnessKit#-kits) | Distribute a portable kit of skills, rules, and other project assets. |
| [Vercel Skills](https://github.com/vercel-labs/skills) | Find and install a standalone skill. |
| [Rulesync](https://github.com/dyoshikawa/rulesync) | Generate several agents' native config files from one project source. |

[Compare 13 related projects by use case](docs/alternatives.md).

## Contributing

[Open an issue](https://github.com/opencue/cuecards/issues), submit a profile,
or run the CLI from source with `bun run src/index.ts --help` after
`bun install`.

[MIT license](LICENSE) · [Source and installation guide for coding agents](AGENTS.md)
