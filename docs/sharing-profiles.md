# Sharing Profiles — cue Marketplace Tutorial

Share your cue profiles with the community so others can install your exact agent setup in one command.

## Quick Start

```bash
# Share a profile
cue share backend

# Browse what others shared
cue share browse

# Install someone's profile
cue share install NagyVikt/backend
```

---

## How It Works

When you run `cue share <profile>`, cue:

1. Reads your profile (skills, MCPs, plugins, description)
2. Publishes it as a **public GitHub Gist** via the `gh` CLI
3. Gives you a link + install command to share

No backend, no account, no signup — just GitHub.

---

## Step-by-Step Guide

### 1. Prerequisites

```bash
# Make sure gh CLI is installed and authenticated
gh auth status

# If not authenticated:
gh auth login

# If you get "needs gist scope":
gh auth refresh -h github.com -s gist
```

### 2. Share a Profile

```bash
cue share frontend
```

Output:
```
📤 Sharing profile "frontend" as YourUsername/frontend...

✅ Profile shared!

  🔗 https://gist.github.com/YourUsername/abc123...
  📋 Others install with: cue share install YourUsername/frontend

  Profile: 🦋 frontend
  Skills:  10
  MCPs:    0
  Author:  YourUsername
```

### 3. Share All Your Profiles

```bash
for profile in $(ls profiles/*/profile.yaml | sed 's|profiles/||;s|/profile.yaml||' | grep -v "^_"); do
  cue share "$profile"
  sleep 1
done
```

### 4. Tell Others to Install

Share the install command:

```bash
cue share install YourUsername/frontend
```

Or share the gist URL directly — they can also use:

```bash
cue import https://gist.github.com/YourUsername/abc123.../raw
```

---

## Browsing Shared Profiles

```bash
# Browse all shared profiles
cue share browse

# Search by keyword
cue share browse "kubernetes"
cue share browse "medusa"
```

---

## What Gets Shared

The shared profile YAML includes:

```yaml
name: backend
description: APIs, webhooks, security review, CI, package, database, and deploy work
icon: 🐻
author: NagyVikt
shared_at: 2026-05-23T19:02:52.341Z
skills:
  local:
    - nvidia/aiq-research
    - meta/analyze
    - review/code-review
    - stripe/stripe-webhooks
    # ... all skills in the profile
mcps:
  - coolify
plugins:
  - claude-mem@thedotmack
stats:
  skill_count: 19
  mcp_count: 1
```

**What's NOT shared:**
- Your API keys or secrets
- Your local file paths
- Your session history
- Your `.env` files

---

## Installing a Shared Profile

```bash
cue share install NagyVikt/backend
```

This creates `profiles/backend/profile.yaml` in your cue directory. Then:

```bash
# Pin it to a project
cd ~/my-project
echo backend > .cue.profile

# Launch
claude
```

---

## Tips

- **Name your profiles clearly** — `nextjs-fullstack` is better than `my-stuff`
- **Write good descriptions** — they show up in the marketplace
- **Keep profiles focused** — share `backend` and `frontend` separately, not `full`
- **Update shared profiles** — just run `cue share <profile>` again (creates a new gist)

---

## Available Profiles from the cue Team

| Profile | Install command | What it's for |
|---------|----------------|---------------|
| 🐻 backend | `cue share install NagyVikt/backend` | APIs, webhooks, security, CI, deploy |
| 🦋 frontend | `cue share install NagyVikt/frontend` | UI, React, Tailwind, screenshots |
| 🦊 medusa-dev | `cue share install NagyVikt/medusa-dev` | Medusa v2 ecommerce |
| 🔒 cybersecurity | `cue share install NagyVikt/cybersecurity` | 754 security skills |
| 🟢 nvidia | `cue share install NagyVikt/nvidia` | NVIDIA cuOpt optimization |
| 🦚 creative-media | `cue share install NagyVikt/creative-media` | Image/video generation |
| 🐝 docs-writer | `cue share install NagyVikt/docs-writer` | Documentation, Markdown |
| 🦉 research | `cue share install NagyVikt/research` | Web research, data lookup |
| 🐺 fleet-control | `cue share install NagyVikt/fleet-control` | Multi-agent orchestration |
| 🦜 marketing | `cue share install NagyVikt/marketing` | Copywriting, SEO, growth |

---

## Creating a Profile Worth Sharing

```bash
# 1. Create a focused profile
cue init
# or
cue skills new my-category/my-skill
cue create-profile my-profile --icon "🚀" --description "What it does"

# 2. Add skills
cue skills add-to-profile review/code-review
cue skills add-to-profile deployment/coolify

# 3. Add MCPs
cue mcps add coolify

# 4. Test it
cue cost my-profile    # check token budget
cue doctor my-profile  # check for issues

# 5. Share it
cue share my-profile
```

---

## FAQ

**Q: Can I make my shared profile private?**
A: Not yet — `cue share` creates public gists. For private sharing, use `cue export` and send the YAML file directly.

**Q: Can I update a shared profile?**
A: Run `cue share <profile>` again. It creates a new gist (old one stays up too).

**Q: Do I need the skills installed locally to use a shared profile?**
A: Yes — the profile references skill IDs. If you don't have them, run `cue doctor` to see what's missing.

**Q: Can I share profiles without GitHub?**
A: Use `cue export backend --output backend.yaml` and share the file however you want. Others import with `cue import backend.yaml`.
