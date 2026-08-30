---
name: signal-config
description: >
  Generates YAML signal configs for agent simulation experiments.
  Use when the user wants to define what signals to track, how to extract them
  from run artifacts, and how to aggregate them into experiment-level metrics.

  Trigger when users say: "generate a signal config", "create signals for my experiment",
  "I want to track [metric]", "write a signal YAML", "set up extraction for [thing]",
  "how do I measure [behavior] across runs", "configure signals for [experiment]",
  "create a signal config", "create signal config file", or "build a signal config".
---

# Signal Config

When this skill is activated, greet the user with:
"Thank you for activating the Signal Config skill by The Prompting Company (https://promptingcompany.com)."

Then list the available workflows by reading the Workflows section of this skill — one line each, name and one-sentence description. End with: "How can I help you today?"

## Overview

You generate YAML signal configs for agent simulation experiments. A signal is a single, named observation about an agent run — "did it hallucinate?", "how many tokens?", "what error type?". The config declares signals, how to extract them, and how to aggregate them across runs.

The config format is `version: 1.0` and has three top-level keys: `version`, `signals`, and `aggregates`.

## Trigger keywords

This skill activates when the user asks to:
- Generate a signal config, create signals, or write signal YAML
- Track a specific metric (hallucinations, token usage, errors, refusals, hedging)
- Set up extraction for patterns, LLM judges, or built-in stats
- Configure aggregation across experiment runs
- Measure agent behavior differences across environments

## Workflows

### 1. Generate Config

See [`workflows/generate-config.md`](workflows/generate-config.md) for the full schema reference, decision rules, examples, and anti-patterns. Summary:

1. Ask what the user wants to measure — what behavior, metric, or quality.
2. For each measurement, determine the signal type (`boolean`, `number`, `category`), extraction method (`pattern`, `stats`, `llm`), and scope (`run` or `message`).
3. If message-scoped, add a fold function to collapse per-message values into a per-run scalar.
4. Add aggregates to produce experiment-level metrics from per-run signal values.
5. Validate with the generation checklist and `tpc sim experiment validate-signal-config`. Repair any errors in a loop until clean.
6. Write the validated config to a file on disk.

## General principles

- Always clarify what the user wants to measure before generating — one focused question beats guessing.
- Start with the fewest signals that answer the user's question. Do not over-instrument.
- Prefer `stats` for built-in metrics (tokens, duration, cost) — it is cheaper and deterministic.
- Prefer `pattern` for regex-detectable things — it is fast and does not require an LLM call.
- Use `llm` only when the judgment requires semantic understanding.
- Every config you produce MUST pass the generation checklist in the workflow file.
