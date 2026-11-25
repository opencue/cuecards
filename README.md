<div align="center">

# cuecards

**Project profiles for Claude Code and Codex.**

Give each repository its own skills, MCP servers, and instructions.<br>
Run the coding agent you already use.

[Install](#install) · [Profile catalog](#the-catalog) · [Compare tools](#how-it-compares) · [Community](https://cuecards.cc)

[![npm version](https://img.shields.io/npm/v/cue-ai)](https://www.npmjs.com/package/cue-ai)
[![MIT license](https://img.shields.io/github/license/opencue/cuecards)](LICENSE)

</div>

## Quick start
<a id="install"></a>

Requires Node.js 20+ and an existing [Claude Code](https://github.com/anthropics/claude-code)
or [Codex](https://github.com/openai/codex) installation. In an API repository:

```sh
npm install -g cue-ai
cue setup --profile backend
cue current --plan --agent claude
cue launch claude --cue-profile backend
```

Use `codex` in the last two commands if that's your agent. Setup pins the profile,
installs launch shims, and can update your PATH. Once the shims are on PATH, run
`claude` or `codex` as usual. Optional tooling is not required.

The plan shows why Cue selected the profile and lists local, missing, deferred,
and remote resources. To try a profile before pinning anything, run
`cue current --plan --profile backend`. The preview installs and writes nothing.

[Install with an AI agent](setup/agent-prompt.md) · [macOS](setup/macos.md) · [Linux](setup/linux.md) · [Windows](setup/windows.md) · [Shell setup and removal](docs/shell-setup.md)

<img src="https://raw.githubusercontent.com/opencue/cuecards/main/docs/assets/demo.gif" alt="Terminal demo: selecting a project profile and launching a coding agent" width="760" loading="lazy">

## How it works

A **cuecard** is a reusable profile. For example, pin `backend` in an API repo
and `frontend` in a web app. Cue prepares each profile's runtime and starts
your existing agent with it. No daemon. [See the launch flow](docs/launch.md).

The picker can suggest profiles and skills from project signals; it installs
nothing. Set `CUE_PROFILE_ADVISOR=off` for local-only matches.

## The catalog

Start with `core` for a minimal baseline, `backend` for API work, or
`frontend` for UI work. Use `cue auto-detect` for a suggestion, or `cue list`
to browse available profiles. [See the full catalog](docs/data/profiles.md).

## Skills and rules

Requires Cue 0.11.0 or newer.

```sh
cue discover search --skills-sh react   # find a skill without installing it
cue ruler --rulesync --check            # check a Rulesync project for drift
```

[Integration setup and limits](docs/skill-and-rule-integrations.md) · [Independent review gate](docs/review-visibility.md)

## How it compares

| Use | When you want to… |
| --- | --- |
| **Cue** | Choose the context an agent starts with in each repository. |
| [HarnessKit](https://github.com/RealZST/HarnessKit#-kits) | Distribute a portable kit of skills, rules, and other project assets. |
| [Vercel Skills](https://github.com/vercel-labs/skills) | Find and install a standalone skill. |
| [Rulesync](https://github.com/dyoshikawa/rulesync) | Generate several agents' native config files from one project source. |

[See the full feature matrix: Cue and 13 related projects](docs/alternatives.md#feature-comparison).

## Contributing

[Open an issue](https://github.com/opencue/cuecards/issues), submit a profile,
or run the CLI from source with `bun run src/index.ts --help` after
`bun install`.

[MIT license](LICENSE) · [Source and installation guide for coding agents](AGENTS.md)
