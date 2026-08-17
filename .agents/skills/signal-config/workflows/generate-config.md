---
name: generate-config
description: >
  Interactive workflow to create a signal config YAML file: ask what to measure,
  generate the config from schema, validate and repair in a loop, then write to disk.

  Trigger when users say: "generate a signal config", "create signals for my experiment",
  "write a signal YAML", "I want to track [metric]", "set up extraction for [thing]",
  "create a signal config", "create signal config file", "build a signal config".
---

# Generate Signal Config

## Overview

Interactively create a valid `version: 1.0` YAML signal config — ask what to measure, generate the config according to the schema, validate and repair until clean, then write to disk.

## Prerequisites

- `tpc` CLI installed (`tpc --version`) — needed for validation via `tpc sim experiment validate-signal-config`
- Authenticated: `tpc auth whoami` (only if attaching to an experiment)

## Required Workflow

**Follow all steps in order. Do not write the file until validation passes.**

---

### Step 1 — Ask what to measure

Ask the user:

> "What kind of signal config do you want to create? Tell me what you want to measure — for example: hallucination rate, token usage, error classification, task completion, or something else."

Gather enough detail to proceed:
- **What behaviors or metrics** to track (e.g., hallucinations, cost, errors, hedging, refusals)
- **Per-message or per-run** — is this something to detect in each message, or a property of the whole run?
- **What summary** they want at the experiment level (rate, average, count, most common category)
- **How many signals** — one focused signal or a full config with multiple signals?

If the user's request is clear and specific (e.g., "track hallucination rate and average tokens"), do not ask follow-up questions — proceed to Step 2.

If the user is unsure, suggest common signal patterns:

| Use case | Signals | Extraction |
|---|---|---|
| Performance benchmarking | token_total, duration, cost | `stats` (built-in) |
| Hallucination detection | fabricated API calls, invented facts | `pattern` (message-scoped) |
| Error classification | error type categorization | `llm` (run-scoped category) |
| Reliability tracking | run status, termination reason | `stats` (built-in) |
| Quality assessment | hedging, vagueness, refusals | `llm` (message-scoped boolean) |

---

### Step 2 — Map each measurement to signal + extraction

For each thing the user wants to measure, determine:

1. **Signal type**: `boolean` (did X happen?), `number` (how many?), `category` (which bucket?)
2. **Extraction method**: `pattern` (regex), `stats` (built-in metric), `llm` (LLM judge)
3. **Scope**: `run` (once per artifact) or `message` (once per matching message)

Prefer extraction methods in this order: `stats` > `pattern` > `llm` (cheapest and most deterministic first).

Use the decision rules in the Schema Reference below to validate your choices.

---

### Step 3 — Add fold and aggregation

- If any signal is `scope: message`, add a `fold` block to collapse per-message values into a per-run scalar.
- Add an `aggregates` entry for every experiment-level metric the user wants.
- Validate that each aggregate `fn` is compatible with the post-fold type.

Build the complete YAML config with `version: 1.0`, `signals`, and `aggregates`.

---

### Step 4 — Validate and repair (loop until clean)

#### 4a — Run the generation checklist

Before any external validation, check every item:

1. `version: 1.0` is present at the top
2. Every signal has `id`, `name`, `type`, and `extract.method`
3. Every `type: category` signal has `category_enums`
4. Every `scope: message` signal has `target_role` and `fold`
5. No `scope: message` signal has `source`
6. Every `scope: run` signal has `source` (unless method is `stats`)
7. `pattern` signals are `scope: message`; `stats` signals are `scope: run`
8. Every `aggregate.signal_id` matches a signal `id`
9. Aggregate `fn` is compatible with the post-fold type
10. All signal `id` values are unique

If any item fails, fix the violation immediately and re-check.

#### 4b — Validate with the CLI

Write a temporary file and validate:

```bash
tpc sim experiment validate-signal-config /tmp/signal-config-draft.yaml
```

#### 4c — Repair loop

If the CLI reports errors:

1. Read each error message
2. Identify the root cause (wrong scope, missing field, incompatible types, etc.)
3. Fix the specific violation in the YAML
4. Re-run validation

**Repeat until validation passes with zero errors.** Do not proceed to Step 5 with a config that has any validation errors.

If the same error persists after 3 repair attempts, show the user the error and ask for guidance.

---

### Step 5 — Write the file

Once validation passes, ask the user where to save the file:

> "Signal config validated successfully. Where should I save it? Default: `signal-config.yaml` in the current directory."

Write the file to the chosen path.

Confirm:

> "Signal config written to `signal-config.yaml`. You can attach it to an experiment with:
> ```bash
> tpc sim experiment update <experiment-id> --signal-config signal-config.yaml
> ```"

---

## Schema Reference

Every config is a single YAML document:

```yaml
version: 1.0          # MUST always be 1.0
signals: [...]        # array of signal definitions
aggregates: [...]     # array of cross-run metrics
```

### Signal fields

| Field | Type | Required | Allowed values |
|-------|------|----------|----------------|
| `id` | string | ALWAYS | kebab-case, unique across all signals |
| `name` | string | ALWAYS | human-readable display name |
| `type` | string | ALWAYS | `boolean`, `number`, `category` |
| `category_enums` | string[] | ONLY when `type: category` | non-empty list of valid values |
| `scope` | string | optional | `run` (default), `message` |
| `target_role` | string | ONLY when `scope: message` | `assistant`, `user`, `tool` |
| `context_window` | integer | optional | default `0`, only for `scope: message` |

### `extract` (nested under each signal, required)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `method` | string | ALWAYS | `pattern`, `stats`, `llm` |
| `source` | string | ONLY when `scope: run` | see source table (includes `any` for all events) |
| `patterns` | array | when `pattern` + `boolean` | `[{ name, regex }]` |
| `needle` | string | when `pattern` + `number` | single regex |
| `flags` | string | optional | regex flags, e.g. `gi` |
| `stat` | string | when `stats` | see stat table |
| `model` | string | when `llm` | model identifier |
| `prompt` | string | when `llm` | template with `${text}` interpolation |

### `fold` (nested under each signal, required when `scope: message`)

| Field | Type | Required | Allowed values |
|-------|------|----------|----------------|
| `fn` | string | ALWAYS | `sum`, `count`, `average`, `min`, `max` |
| `filter` | literal or object | optional | see filter syntax |

### Aggregate fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | ALWAYS | kebab-case, unique |
| `signal_id` | string | ALWAYS | MUST match an existing signal `id` |
| `fn` | string | ALWAYS | see aggregation functions table |
| `label` | string | ALWAYS | human-readable display name |

---

## Decision Rules

IMPORTANT: Follow these rules exactly. Violations produce runtime errors.

1. If `scope: message` → MUST have `target_role` and `fold`. MUST NOT have `source`.
2. If `scope: run` (or omitted) → MUST have `source` on extract (unless method is `stats`). MUST NOT have `target_role` or `fold`.
3. If `method: pattern` → scope MUST be `message`. Type MUST be `boolean` or `number`.
4. If `method: stats` → scope MUST be `run`. NEVER set `scope: message` with `stats`.
5. If `method: llm` → scope can be `run` or `message`. Type MUST be `boolean` or `category`.
6. If `type: category` → MUST have `category_enums`. NEVER omit it.
7. Every `aggregate.signal_id` MUST match an existing signal `id`.
8. Aggregate `fn` validates against the **post-fold type**:
   - Signal has a fold → post-fold type is always `number` (all fold functions output number).
   - Signal has no fold → post-fold type equals signal `type`.
9. `rate` and `count_where` accept both `boolean` and `number` inputs (number: `> 0` = truthy).
10. `mode` ONLY works with `category` input → only use on run-scoped signals with `type: category`.

---

## Reference Tables

### Source projection (run scope only)

| Value | Contents |
|-------|----------|
| `codeText` | Concatenated code output files |
| `assistantText` | All assistant message content joined |
| `userText` | All user message content joined |
| `thinkingText` | Chain-of-thought / reasoning tokens |
| `toolCalls` | Serialized tool call names + args |
| `toolResults` | Serialized tool call results |
| `finalAnswer` | Last assistant message only |
| `any` | All event contents joined regardless of type (assistant, user, thinking, tool, etc.) |

### Built-in stats

| Stat | Type | Description |
|------|------|-------------|
| `duration` | number | Wall-clock duration in ms |
| `token_in` | number | Input tokens |
| `token_out` | number | Output tokens |
| `token_total` | number | Total tokens |
| `cost` | number | Run cost in USD |
| `tool_calls` | number | Total tool calls made |
| `turns` | number | Conversation turns |
| `steps` | number | Agent steps taken |
| `status` | category | `completed`, `failed`, `running` |
| `termination_reason` | category | `completed`, `maxSteps`, `error`, `timeout` |

### Fold functions

All fold functions output `number`. Boolean inputs are coerced: `true = 1`, `false = 0`.

| Function | Accepts | Description |
|----------|---------|-------------|
| `sum` | number, boolean | Sum of values |
| `count` | any | Count of non-null values |
| `average` | number, boolean | Mean of values |
| `min` | number | Minimum |
| `max` | number | Maximum |

### Filter syntax (optional on fold)

| Form | Example |
|------|---------|
| Bare literal (exact match) | `filter: true` |
| Not equal | `filter: { not_equals: "none" }` |
| Greater than | `filter: { gt: 0 }` |
| Greater/equal | `filter: { gte: 5 }` |
| Less than | `filter: { lt: 10 }` |
| In set | `filter: { in: [timeout, refusal] }` |

### Aggregation functions

| Function | Accepts | Output | Description |
|----------|---------|--------|-------------|
| `count` | any | number | Runs where signal is non-null |
| `count_where` | boolean, number | number | Runs where `true` or `> 0` |
| `rate` | boolean, number | percentage | `count_where / total_runs` |
| `sum` | number | number | Sum across runs |
| `avg` | number | number | Mean across runs |
| `min` | number | number | Minimum |
| `max` | number | number | Maximum |
| `median` | number | number | p50 |
| `mode` | category | string | Most frequent value |

---

## Examples

### Example 1 — Simple: run-level stat with aggregation

User asks: "I want to know the average token usage per run."

```yaml
version: 1.0

signals:
  - id: total-tokens
    name: Total tokens
    type: number
    # scope defaults to run — no fold needed
    extract:
      method: stats
      stat: token_total

aggregates:
  - id: avg-tokens
    signal_id: total-tokens
    fn: avg
    label: Avg tokens per run
```

Why: `stats` reads a built-in metric. `scope: run` is the default, no fold needed. `avg` accepts number.

### Example 2 — Message-scoped pattern with fold + rate

User asks: "I want to detect fabricated API calls per message and get the percentage of runs that had any."

```yaml
version: 1.0

signals:
  - id: fabricated-apis
    name: Fabricated API calls
    type: boolean
    scope: message
    target_role: assistant
    extract:
      method: pattern
      patterns:
        - name: "useChat({ api })"
          regex: 'useChat\s*\(\s*\{\s*api\s*:'
        - name: "streamObject({ resumable })"
          regex: 'streamObject\s*\([^)]*resumable'
    fold:
      fn: max                  # 1 if any message matched, 0 if none

aggregates:
  - id: hallucination-rate
    signal_id: fabricated-apis
    fn: rate                   # % of runs where max > 0
    label: Hallucination rate
```

Why: `pattern` requires `scope: message`. Fold `max` on boolean (coerced to 1/0) = "any true?". `rate` accepts number post-fold (> 0 = truthy).

### Example 3 — LLM category judge with mode aggregation

User asks: "I want an LLM to classify the primary error type per run, then find the most common one."

```yaml
version: 1.0

signals:
  - id: error-type
    name: Error classification
    type: category
    category_enums: [hallucination, schema-mismatch, timeout, refusal, none]
    extract:
      method: llm
      source: assistantText
      model: claude-haiku-4.5
      prompt: |
        What is the primary error category in this agent run?
        Choose exactly one: hallucination, schema-mismatch, timeout, refusal, none.

        ---
        ${text}

aggregates:
  - id: most-common-error
    signal_id: error-type
    fn: mode
    label: Most common error
```

Why: `llm` with `type: category` at run scope. No fold (already per-run). `mode` accepts category directly.

---

## Anti-patterns

IMPORTANT: NEVER produce configs with these errors.

### WRONG: `source` on a message-scoped signal

```yaml
# BAD — source is only for run scope
- id: hedging
  type: boolean
  scope: message
  target_role: assistant
  extract:
    method: llm
    source: assistantText    # REMOVE — message scope uses target message implicitly
    model: claude-haiku-4.5
    prompt: "..."
```

### WRONG: `pattern` method with `scope: run`

```yaml
# BAD — pattern MUST be scope: message
- id: fabricated-apis
  type: boolean
  extract:
    method: pattern          # INVALID — add scope: message and target_role
    source: codeText
    patterns:
      - name: test
        regex: 'test'
```

### WRONG: missing fold on message-scoped signal used by aggregate

```yaml
# BAD — message-scoped signals need fold before aggregation
- id: hedging
  type: boolean
  scope: message
  target_role: assistant
  extract:
    method: llm
    model: claude-haiku-4.5
    prompt: "..."
  # MISSING fold — add fold: { fn: sum } or similar
```

### WRONG: `mode` on a folded signal

```yaml
# BAD — fold outputs number, mode needs category
- id: error-type
  type: category
  category_enums: [hallucination, timeout, none]
  scope: message
  target_role: assistant
  extract:
    method: llm
    model: claude-haiku-4.5
    prompt: "..."
  fold:
    fn: count                # outputs number — mode cannot consume this
```

Fix: make it `scope: run` (remove fold) so `mode` sees category directly.

### WRONG: `category` type without `category_enums`

```yaml
# BAD — category MUST have category_enums
- id: error-type
  type: category             # INVALID — add category_enums
  extract:
    method: llm
    source: assistantText
    model: claude-haiku-4.5
    prompt: "..."
```

### WRONG: `stats` method with `scope: message`

```yaml
# BAD — stats is always run-scoped
- id: tokens-per-msg
  type: number
  scope: message             # INVALID — stats requires scope: run
  target_role: assistant
  extract:
    method: stats
    stat: token_total
```
