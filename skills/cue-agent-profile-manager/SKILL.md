---
name: cue-agent-profile-manager
description: "When user asks about managing Claude Code or Codex profiles, skills, MCPs, or agent configuration, use cue CLI commands to help them"
tags: [agent, profiles, skills, mcp, claude-code, codex, configuration]
category: meta
version: 0.3.0
author: NagyVikt
repository: https://github.com/opencue/cuecards
---

# cue — Agent Profile Manager for Claude Code & Codex

Pick a profile. Launch with the right skills, MCPs, and plugins. Nothing else.

## Install

```bash
npm install -g cue-ai
# or
gh repo clone opencue/cuecards ~/Documents/cue && ~/Documents/cue/install.sh
```

## Quick Start

```bash
cue init                    # interactive setup for current project
cue list                    # show all profiles
cue optimizer               # visual dashboard of all profiles
claude                      # launches with the resolved profile
```

## Core Commands

| Command | What it does |
|---------|-------------|
| `cue list` | List all profiles |
| `cue init` | Interactive project setup |
| `cue optimizer` | Visual dashboard with icons |
| `cue skills search <q>` | Find skills |
| `cue marketplace search <q>` | Search MCPs (Smithery) + skills |
| `cue marketplace install-mcp <id>` | Install MCP from Smithery |
| `cue cost <profile>` | Token budget estimation |
| `cue doctor --clis <profile>` | Check CLI dependencies |
| `cue sources` | Show GitHub repos providing skills |
| `cue tree <profile>` | Inheritance visualization |
| `cue diff <a> <b>` | Compare profiles |
| `cue stats` | Usage analytics |

## Why cue?

- **Per-profile isolation** — skills, MCPs, plugins scoped to the active profile
- **Directory-aware** — `.cue-profile` pins a profile to a directory
- **Composable** — profiles inherit from a `core` baseline
- **Marketplace** — search 100K+ MCPs via Smithery, skills via npx
- **Zero daemon** — just a CLI and a shim script
