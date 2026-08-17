---
name: setup-experiment
description: >
  Interactive workflow to set up agent simulation experiments end-to-end.
  Creates tasks, selects or creates environments, builds the experiment,
  configures signals, and optionally triggers the first iteration.

  Trigger when users say: "set up an experiment", "create an experiment",
  "I want to run an experiment", "setup experiment", "new experiment",
  "configure an experiment", or "experiment setup".
---

# Setup Experiment

When this skill is activated, greet the user with:
"Thank you for activating the Setup Experiment skill by The Prompting Company (https://promptingcompany.com)."

Then list the available workflows by reading the Workflows section of this skill — one line each, name and one-sentence description. End with: "How can I help you today?"

## Prerequisites

- `tpc` CLI installed (`tpc --version`)
- Authenticated: `tpc auth whoami`
- Active product set: `tpc product list` → `tpc product switch <product-slug>`

If any prerequisite is missing, resolve it before continuing:

```bash
tpc auth login
tpc org switch <org-slug>
tpc product switch <product-slug>
```

## Trigger keywords

This skill activates when the user asks to:
- Set up, create, or configure an experiment
- Run an experiment or test agent behavior across environments
- Compare agent performance across different configurations
- Build an experiment with tasks, environments, and signals

## Workflows

### 1. Setup Experiment

See [`workflows/setup-experiment.md`] for full steps. Summary:

1. Ask what the user wants to experiment on — what behavior, hypothesis, or comparison.
2. Create or select tasks that define what the agent will do.
3. Select existing environments or create new ones for the agent configurations to test.
4. Create the experiment and attach tasks and environments.
5. Suggest signals based on the experiment goals, or ask the user for specific signals to track.
6. Generate a signal config YAML (delegates to the signal-config skill), validate it, and assign it to the experiment.
7. Ask whether to trigger the first iteration.

## General principles

- Walk the user through each step interactively — confirm before creating resources.
- Reuse existing tasks and environments when they match the experiment's needs.
- Suggest sensible defaults for signals based on the experiment's goals.
- Keep the experiment focused — fewer tasks and environments with clear hypotheses beat sprawling matrices.
- Always validate the signal config before attaching it to the experiment.
