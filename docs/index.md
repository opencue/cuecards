---
layout: default
title: "cue — Agent profile manager for Claude Code & Codex"
description: "Per-directory profiles select which skills, MCP servers, and plugins load — automatically, before launch. Install: npm install -g cue-ai"
image: https://opencue.github.io/cuecards/assets/og-card.png
---

# Discover skills your AI agent is missing

**cue** scans GitHub for skill-compatible repos, scores them, and installs the best ones into your agent profile — Claude Code, Codex, Cursor, Cline, Gemini, Copilot, Windsurf, Roo Code, Amp, and Aider.

```bash
npm install -g cue-ai && cue discover search
```

---

## 🏆 Top 10 Hidden Gems

| | Repo | Score | Profile | What it does |
|---|------|-------|---------|-------------|
| 💎 | [wedding-invitation-skill](https://github.com/wyx-sg/wedding-invitation-skill) | 15 | core | AI skill that designs wedding invitations from conversation |
| 💎 | [Deliberation-Loop](https://github.com/butevecom-commits/Deliberation-Loop) | 11.5 | core | Multi-path reasoning via 6-role structured debate |
| 💎 | [the-council](https://github.com/DantesPeak85/the-council) | 11.5 | core | Multi-model advisory board — second opinions from GPT-4, Gemini |
| 💎 | [claude-ecosystem-health](https://github.com/aplaceforallmystuff/claude-ecosystem-health) | 10.4 | backend | Detect drift between skills, agents, MCP servers |
| 💎 | [moodle-quizsmith](https://github.com/Rick-254/moodle-quizsmith) | 10 | core | Moodle MCQ Generator for GIFT XML & Aiken |
| 💎 | [dokpilot](https://github.com/kyzdes/dokpilot) | 9.8 | backend | VPS deployment via Dokploy — setup, deploy, domains |
| 💎 | [pre-sales_career_navigator](https://github.com/diabolikss-debug/pre-sales_career_navigator) | 9 | core | Analyzes pre-sales experience, generates career paths |
| 💎 | [skill-ci](https://github.com/QuickClaw-Skills/skill-ci) | 8.5 | core | Reusable CI workflow — validates SKILL.md format |
| 💎 | [plugins](https://github.com/glitchwerks/plugins) | 8.3 | core | Claude Code plugins marketplace |
| 💎 | [Cursor-history-MCP](https://github.com/pedrohenrique316/Cursor-history-MCP) | 8 | backend | Extract and vectorize Cursor chat history |

[→ Full discovered list](./discovered.md)

---

## Profiles

| Profile | Domain |
|---------|--------|
| [core](./discovered.md#-core-23-gems) | Baseline — memory, reasoning, meta skills |
| [backend](./discovered.md#-backend-6-gems) | APIs, deployment, diagnostics |

---

## Install

```bash
npm install -g cue-ai
cue discover search                    # find gems
cue discover install --min-score 8     # install top gems
cue use backend                        # switch profile
```

[GitHub →](https://github.com/opencue/cuecards)
