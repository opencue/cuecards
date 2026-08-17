---
name: agent-simulation
description: >
  Creates and runs agent simulation tasks via the TPC CLI.
  Checks for existing tasks to avoid overlap, collects product context,
  drafts a task.json, confirms with the user, then creates and queues the run.

  Trigger when users say: "simulate agent", "run agent loop", "test agent",
  "create a simulation task", or "test this prompt".
---

# Agent Simulation

## Overview

Create and queue an agent simulation task using the `tpc` CLI — check for overlaps, collect product context, draft the task, confirm, then create and run it.

## Prerequisites

- `tpc` CLI installed (`tpc --version`)
- Authenticated: `tpc auth whoami`
- Active product set: `tpc product list` → `tpc product switch <product-slug>`

If any prerequisite is missing, resolve it before continuing:

```bash
tpc auth login                        # authenticate
tpc org switch <org-slug>             # set active org
tpc product switch <product-slug>     # set active product (required for sim commands)
```

## Required Workflow

**Follow all steps in order.**

---

### Step 1 — Check for existing simulation tasks

Before creating anything, search for tasks that may already cover the same scenario:

```bash
tpc sim task list
tpc sim task list --search "<keyword from product or scenario>"
```

- If a matching task exists, show it to the user with `tpc sim task get <task-id>` and ask: "There's already a task for this — do you want to extend it, run it again, or create a new one?"
- If none exist, proceed to Step 2.

---

### Step 2 — Understand the product

Collect context on what the product is solving for. Ask the user:

- **What does the product do?** — core problem it solves and for whom
- **What should the agent accomplish?** — the specific job being tested
- **What does success look like?** — what should the agent reliably produce or decide?
- **What category fits best?** — `coding`, `research`, `documentation`, or `analysis`

If a URL is provided, use web search to fill in gaps before proceeding.

Use this to write a sharp, specific simulation prompt in Step 3 — not a generic description.

---

### Step 3 — Draft task.json

Write a `task.json` using the product context from Step 2:

```json
{
  "name": "<short scenario name>",
  "description": "<one sentence: what this task validates>",
  "category": "<coding | research | documentation | analysis>",
  "prompt": "<the instruction the agent will receive — specific, actionable, grounded in real user behaviour>",
  "taskType": "cli_execution",
  "timeLimitMs": 3600000,
  "goals": [
    {
      "name": "<goal name>",
      "description": "<what a passing run looks like>",
      "passingThreshold": 70
    }
  ]
}
```

**Prompt writing rules:**
- Write in second-person imperative: "Open the app, add an item to cart, and complete checkout."
- Be specific — include realistic detail (promo codes, item names, expected state)
- One prompt = one scenario. Do not combine multiple test cases.
- Goals should be observable outcomes, not internal states.

Show the draft to the user before proceeding.

---

### Step 4 — Confirm

Ask:
> "Does this task.json look right? Should I go ahead and create it?"

Wait for confirmation. Adjust the prompt or goals if the user requests changes.

---

### Step 5 — Create the task

Write `task.json` to disk and create the task:

```bash
tpc sim task create --file task.json
```

Note the returned task ID (e.g., `task_123`). The CLI will also print suggested next commands.

---

### Step 6 — Attach to an environment

List available environments and attach the new task:

```bash
tpc sim env list
tpc sim env task attach <env-id> <task-id>
```

If the user knows which environment to use, skip the list step. If no environments exist yet, tell the user they need to create one before the task can run.

---

### Step 7 — Queue the run

```bash
tpc sim task run <task-id>
```

Confirm back with:
> "Simulation queued. Check results with: `tpc sim run list --task-id <task-id>`"

To inspect logs once the run completes:

```bash
tpc sim run list --task-id <task-id>
tpc sim run logs <run-id>
tpc sim analysis get --task-id <task-id>
```
