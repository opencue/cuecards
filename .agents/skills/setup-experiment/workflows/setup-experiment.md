---
name: setup-experiment
description: >
  End-to-end interactive workflow: ask what to experiment on, create tasks,
  select or create environments, build the experiment, generate and attach
  a signal config, and optionally trigger the first iteration.

  Trigger when users say: "set up an experiment", "create an experiment",
  "I want to run an experiment", "new experiment", "configure an experiment".
---

# Setup Experiment

## Overview

Walk the user through creating a complete agent simulation experiment — from defining what to test, through task and environment setup, to signal configuration and the first run.

## Prerequisites

- `tpc` CLI installed (`tpc --version`)
- Authenticated: `tpc auth whoami`
- Active product set: `tpc product list` → `tpc product switch <product-slug>`

## Required Workflow

**Follow all steps in order. Do not skip steps or create resources without user confirmation.**

---

### Step 1 — Understand what the user wants to experiment on

Ask the user:

> "What do you want to experiment on? For example: comparing agent performance across models, testing a new system prompt, measuring hallucination rates on specific tasks, or benchmarking different agent configurations."

You need to understand:
- **The hypothesis or goal** — what are they trying to learn or compare?
- **The scope** — how many tasks, how many environments, what dimensions vary?
- **Success criteria** — what would a good result look like?

If the user gives a clear, specific answer, do not ask follow-up questions — proceed.

---

### Step 2 — Create or select tasks

Tasks define what the agent will be asked to do in each run.

#### 2a — Check for existing tasks

```bash
tpc sim task list
```

Show the user any tasks that look relevant. Ask:

> "Here are your existing tasks. Do any of these fit your experiment, or should we create new ones?"

#### 2b — Create new tasks (if needed)

For each new task the user wants, collect:
- **Name** — short scenario name
- **Description** — one sentence on what this task validates
- **Category** — `coding`, `research`, `documentation`, or `analysis`
- **Prompt** — the specific instruction the agent will receive
- **Goals** — observable outcomes with passing thresholds

Draft a `task.json` for each task:

```json
{
  "name": "<short scenario name>",
  "description": "<what this task validates>",
  "category": "<coding | research | documentation | analysis>",
  "prompt": "<specific, actionable instruction>",
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

Show the draft to the user and ask for confirmation before creating:

```bash
tpc sim task create --file task.json
```

Note each returned task ID. Repeat for all tasks needed.

---

### Step 3 — Select or create environments

Environments define the agent configuration (harness, model, approval policy, sandbox resources).

#### 3a — List existing environments

```bash
tpc sim env list
```

Show the user the available environments. Ask:

> "Here are your existing environments. Which ones do you want to include in this experiment? Or should we create new ones?"

#### 3b — Create new environments (if needed)

For each new environment, collect:
- **Name** — descriptive name (e.g., "Claude Sonnet 4 - default", "GPT-4o - strict")
- **Description** — what this configuration tests
- **Agent config** — harness, provider, model, approval policy, sandbox resources

Draft the agent config:

```json
{
  "harness": "claude",
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "approvalPolicy": "auto-approve-all",
  "sandboxMode": true,
  "sandboxResources": {
    "cpu": "2",
    "memory": "4Gi",
    "disk": "10Gi"
  }
}
```

Show the draft and confirm before creating:

```bash
tpc sim env create --name "<name>" --agent-config '<json>' --description "<description>"
```

Note each returned environment ID. Repeat for all environments needed.

---

### Step 4 — Create the experiment and attach tasks and environments

#### 4a — Create the experiment

```bash
tpc sim experiment create --name "<experiment name>" --description "<hypothesis or goal>"
```

Note the returned experiment ID.

#### 4b — Add tasks to the experiment

For each task ID collected in Step 2:

```bash
tpc sim experiment task add <experiment-id> <task-id>
```

#### 4c — Add environments to the experiment

For each environment ID collected in Step 3:

```bash
tpc sim experiment env add <experiment-id> <env-id>
```

#### 4d — Confirm the experiment shape

```bash
tpc sim experiment get <experiment-id>
```

Show the user the experiment summary: name, description, tasks, environments.

> "Here's your experiment. It will run **[N tasks] x [M environments] = [N*M runs]** per iteration. Does this look right?"

Wait for confirmation before proceeding.

---

### Step 5 — Configure signals

Signals define what to measure from each run.

#### 5a — Suggest signals based on the experiment goal

Based on the experiment's hypothesis from Step 1, suggest relevant signals. Common suggestions:

| Experiment goal | Suggested signals |
|---|---|
| Compare model performance | `token_total` (stats), `duration` (stats), `cost` (stats), task pass rate |
| Measure hallucinations | Fabricated API/function detection (pattern), LLM hallucination judge |
| Test prompt quality | Goal pass rate, `steps` (stats), error classification (LLM category) |
| Benchmark reliability | `status` (stats), `termination_reason` (stats), error rate |

Present your suggestions:

> "Based on your experiment goals, I'd suggest tracking these signals: [list]. Would you like to use these, modify them, or do you have specific signals in mind?"

#### 5b — Collect user signal preferences

If the user wants custom signals, ask:
- What behavior or metric to track
- Whether it's per-message or per-run
- What experiment-level summary they want (rate, average, count, etc.)

---

### Step 6 — Generate and attach the signal config

**Delegate to the signal-config skill** to generate the YAML config.

Use the `/signal-config` skill (or invoke the `generate-config` workflow directly) with the signal requirements gathered in Step 5. The signal-config skill will:

1. Map each measurement to the correct signal type, extraction method, and scope
2. Add fold and aggregation as needed
3. Validate the config against all decision rules
4. Repair any violations and re-validate until clean
5. Write the config to a file

Once the signal config file is ready, validate it locally:

```bash
tpc sim experiment validate-signal-config signal-config.yaml
```

If validation fails, fix the issues and re-validate until it passes.

Then attach it to the experiment:

```bash
tpc sim experiment update <experiment-id> --signal-config signal-config.yaml
```

Confirm:

> "Signal config attached to experiment. Signals will be extracted after each iteration completes."

---

### Step 7 — Offer to run the first iteration

Ask the user:

> "Your experiment is fully configured. Would you like to trigger the first iteration now? This will create **[N*M]** runs (one per task-environment pair)."

If the user says yes:

```bash
tpc sim experiment run <experiment-id>
```

Then offer to watch progress:

```bash
tpc sim experiment run status <experiment-id> --watch
```

If the user says no, provide the commands for later:

> "When you're ready, run:
> ```bash
> tpc sim experiment run <experiment-id>
> tpc sim experiment run status <experiment-id> --watch
> tpc sim experiment results <experiment-id>
> tpc sim experiment signals <experiment-id>
> ```"
