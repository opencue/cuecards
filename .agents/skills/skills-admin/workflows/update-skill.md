---
name: update-skill
description: >
  Updates an already-installed skill to the latest version from the agent-skills repository.
  Compares the installed metadata.json version against upstream and re-installs if out of date.

  Trigger when users say: "update my skills", "get the latest skill", "how do I update",
  or "is my skill up to date".
---

# Update an Installed Skill

## Overview

Check whether an installed skill is out of date and update it to the latest version.

## Prerequisites

- Skill previously installed to `~/.claude/skills/` or via `npx skills add`
- Internet access to fetch the latest version from upstream

## Required Workflow

**Follow all steps in order.**

---

### Step 1 — Check installed version

Read the `metadata.json` of the installed skill:

```bash
cat ~/.claude/skills/<skill-name>/metadata.json
```

Note the `version` field.

---

### Step 2 — Check upstream version

Fetch the latest `metadata.json` directly from the repo:

```bash
curl -s https://raw.githubusercontent.com/promptingcompany/agent-skills/main/skills/<skill-name>/metadata.json
```

Compare the `version` fields. If they match, tell the user: "Your skill is already up to date (`v[version]`)." and stop.

---

### Step 3 — Update

**Option A — via the `skills` CLI (recommended):**

```bash
npx skills add https://github.com/promptingcompany/agent-skills --skill <skill-name>
```

This overwrites the local copy with the latest version.

**Option B — manual:**

```bash
git clone https://github.com/promptingcompany/agent-skills /tmp/agent-skills
cp -r /tmp/agent-skills/skills/<skill-name> ~/.claude/skills/
rm -rf /tmp/agent-skills
```

---

### Step 4 — Confirm

Re-read the installed `metadata.json` and confirm the version now matches upstream:

```bash
cat ~/.claude/skills/<skill-name>/metadata.json
```

Tell the user: "Updated to `v[new-version]`."
