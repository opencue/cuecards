---
name: open-pr
description: >
  Opens a pull request to update one or more skills in the agent-skills repository.
  Checks what has changed, commits, pushes to a branch, and creates the PR.

  Trigger when users say: "open a PR", "create a PR for this skill", "submit my changes",
  "push this skill", or "update the skills repo".
---

# Open a PR to Update Skills

## Overview

Commit skill changes and open a pull request against the main branch.

## Prerequisites

- Changes to one or more skill files that are ready to ship
- `gh` CLI authenticated (`gh auth status`)
- A fork of [github.com/promptingcompany/agent-skills](https://github.com/promptingcompany/agent-skills) set as `origin`, with `upstream` pointing to the source repo

If the user has not forked yet, run Step 0 first.

## Required Workflow

**Follow all steps in order.**

---

### Step 0 — Fork and clone (first-time contributors only)

Check whether the user already has a fork:

```bash
gh repo view promptingcompany/agent-skills --json isFork
```

If no fork exists:

```bash
gh repo fork promptingcompany/agent-skills --clone --remote
cd agent-skills
git remote add upstream https://github.com/promptingcompany/agent-skills.git
```

Confirm the remotes are set correctly:

```bash
git remote -v
# origin    https://github.com/<username>/agent-skills (fetch/push)
# upstream  https://github.com/promptingcompany/agent-skills (fetch/push)
```

---

### Step 1 — Sync with upstream

Before making changes, ensure the fork is up to date:

```bash
git fetch upstream
git rebase upstream/main
```

If conflicts arise, resolve them before continuing.

---

### Step 2 — Audit what has changed

Run `git status` and `git diff` to understand the full scope of changes:

- List every modified or untracked file under `skills/`
- Flag any files outside `skills/` that were changed unexpectedly — confirm with the user before including them
- If there are no changes, tell the user and stop

---

### Step 3 — Summarise the changes

Before committing, produce a short summary for the user:

```
Skill:    [skill folder name]
Changed:  [list of files]
Type:     [new skill | workflow update | metadata | install guide | other]
```

Ask:
> "Does this look right? Anything to exclude?"

Wait for confirmation before proceeding.

---

### Step 4 — Commit

Stage only the confirmed files and commit:

```bash
git add [confirmed files]
git commit -m "[type]: [short description of what changed]"
```

Commit message conventions:
- `add:` — new skill or workflow file
- `update:` — changes to an existing skill or workflow
- `fix:` — correcting a mistake in a skill
- `meta:` — metadata, README, or install guide only

---

### Step 5 — Push to a branch on the fork

Never commit directly to `main`. Create a branch and push to `origin` (the fork):

```bash
git checkout -b skills/[skill-name]-[short-description]
git push -u origin HEAD
```

---

### Step 6 — Open the PR against upstream

```bash
gh pr create \
  --repo promptingcompany/agent-skills \
  --title "[type]: [skill name] — [short description]" \
  --body "[summary of what changed and why]" \
  --base main
```

PR body should include:
- What skill was changed and why
- Any workflows added or removed
- A one-line test instruction (e.g., "Trigger with: `simulate agent for [product]`")

Confirm back with the PR URL once created.
