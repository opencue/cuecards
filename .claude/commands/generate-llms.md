---
description: Regenerate llms.txt and web/public/llms.txt from current README and docs/llms-full.txt — keeps AI-discovery files in sync with the product
---

# /generate-llms — Regenerate llms.txt Files

Regenerate `llms.txt` (root) and `web/public/llms.txt` from current source material.
Run this after any significant change to the README, profiles list, or agent support.

## Source files to read first

1. `README.md` — product description, tagline, install command, agent list
2. `docs/llms-full.txt` — dense technical summary (authoritative)
3. `profiles/` — list current profiles with `ls profiles/ | grep -v '^_'`
4. `package.json` — current version and npm package name

## Root llms.txt — what it must contain

```
# cuecards (cue)

<one-paragraph description — from README tagline + what-it-does>

## What it solves
<2–3 sentences on the problem>

## Core docs
- [README](<url>) — <purpose>
- [llms-full.txt](<url>) — <purpose>
- [AGENTS.md](<url>) — <purpose>
- [launch.md](<url>) — <purpose>

## Setup guides
- [macOS](<url>)
- [Linux / WSL2](<url>)
- [Windows](<url>)

## Comparisons
- [cue vs claude-code-switcher](<url>)
- [cue vs skillport](<url>)
- [cue vs Kiro Powers](<url>)

## Repository
- GitHub: https://github.com/opencue/cuecards
- npm: https://www.npmjs.com/package/cue-ai
- License: MIT
```

## web/public/llms.txt — condensed version

Same structure as root `llms.txt` but:
- Shorter descriptions (1 sentence max per link)
- Point to deployed URLs (`https://opencue.github.io/cuecards/...`) where they exist
- Include the `## GEO files` section pointing to `content/geo/`

## After generating

1. Diff the new files against the previous versions: `git diff llms.txt web/public/llms.txt`
2. Verify no URLs were broken (spot-check 3 links)
3. Commit as: `docs: refresh llms.txt [skip ci]`

## Automation note

This command is also triggered by the nightly `discover` workflow. If running
manually, check the workflow hasn't already run today:
`git log --oneline --since="24 hours ago" | grep "llms"`
