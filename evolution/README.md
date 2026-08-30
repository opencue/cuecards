# cue skill-content evolution

GEPA-optimize the **body** of a cue `SKILL.md` from real session usage, gated by
`cue lint-skill`. Ported and adapted from
[NousResearch/hermes-agent-self-evolution](https://github.com/NousResearch/hermes-agent-self-evolution).

## How it relates to `cue evolve`

These operate at two different altitudes and are **complementary**:

| | `cue evolve` (TS, existing) | this package (Python, new) |
|---|---|---|
| Altitude | **profile composition** — which skills are in `profile.yaml` | **skill content** — the SKILL.md body text |
| Action | add/remove skills | rewrite the body via DSPy + GEPA |
| Gate | manual `--apply` | `cue lint-skill` (auto-apply if it passes) |
| Log | `~/.config/cue/evolution-log.jsonl` | same log (`kind: "skill-content"`) |

## The loop (mirrors the hermes diagram)

```
find cue skill → build eval dataset (synthetic | sessiondb | golden)
        ↓
   GEPA optimizer  ← keyword-overlap metric (see caveat)
        ↓
   candidate body → constraint gates: size, growth, structure, `cue lint-skill`
        ↓
   holdout beats baseline AND lint passes?
     ├ yes → write SKILL.md + backup (.bak-<ts>) + evolution-log entry
     └ no  → write inert proposal under evolution/proposals/, log, don't mutate
```

## Quick start

```bash
# offline — validates the cue wiring with NO install and NO LLM key:
python3 -m venv .venv && ./.venv/bin/pip install -e .
./.venv/bin/python -m evolution.skills.evolve_skill \
    --skill eu-funding/ted-tender-search --dry-run

# real optimization — needs the optimize extra + an LLM key:
./.venv/bin/pip install -e '.[optimize]'
export ANTHROPIC_API_KEY=...          # default models are anthropic/claude-*
./.venv/bin/python -m evolution.skills.evolve_skill \
    --skill eu-funding/ted-tender-search --iterations 10

# evolve from your real Claude Code history (~/.claude/history.jsonl):
./.venv/bin/python -m evolution.skills.evolve_skill \
    --skill eu-funding/ted-tender-search --eval-source sessiondb
```

## Configuration (env)

| Var | Default | Purpose |
|---|---|---|
| `CUE_REPO` | auto-discovered | path to the cue checkout |
| `CUE_LINT_CMD` | `cue lint-skill {path} --json` | the auto-apply gate command |
| `CUE_EVOLVE_OPTIMIZER_MODEL` | `anthropic/claude-sonnet-4-5` | GEPA reflection model |
| `CUE_EVOLVE_EVAL_MODEL` | `anthropic/claude-haiku-4-5` | eval / judge / dataset model |

The provider is inferred from the model-string prefix by DSPy/LiteLLM
(`anthropic/…`, `openai/…`, `openrouter/…`). Nothing is hardcoded to OpenAI —
cue is a Claude shop, so Claude is the default.

## Honest caveats (read before trusting a holdout delta)

- **The GEPA metric is a keyword-overlap heuristic, not the LLM judge.** Carried
  over verbatim from upstream: `skill_fitness_metric` scores word-set overlap
  between the rubric and the output. The richer `LLMJudge` exists but is not
  wired into the loop. Overlap is a *weak* proxy for "the skill is genuinely
  better." Treat holdout deltas as directional and lean on the `cue lint-skill`
  gate + human review of proposals. (Slice 2b: wire `LLMJudge` into the metric.)
- **It optimizes a proxy task**, not Claude Code itself: the skill body is run as
  instructions to the eval model on synthetic/mined tasks. Transfer to real
  Claude Code behaviour is plausible but unvalidated.
- **A real run costs tokens** and needs an LLM key. The `--dry-run` path costs
  nothing and is the offline wiring check.
- **Frontmatter is immutable.** Only the body is evolved; `name`/`description`/
  `tags` are preserved so a skill's identity and registry id never drift.

---

# cue description evolution (`evolution.descriptions`)

The companion engine that optimizes **descriptions** — the text that decides
whether Claude *reaches for* a capability — and lands every change **per-profile
in the cue repo, never in the opencue/skills submodule.** Run it via the wrapper:

```bash
bin/evolve-description --skill meta/smart-loader --target skill --profile coolify --dry-run
bin/evolve-description --target persona --profile coolify --dry-run
```

(`--dry-run` needs no DSPy and no LLM key. A real run needs `pip install -e '.[optimize]'`
+ an LLM key, same as the body engine.)

## Targets

| `--target` | Optimizes | Metric | Lands in | Autonomy |
|---|---|---|---|---|
| `skill` | a skill's routing description | routing-F1 on real/synthetic prompts | `persona_routing:` rows in `profiles/<p>/profile.yaml` | gated auto-apply (lint + F1Δ>0.05 + backup + revert) |
| `persona` | a profile's `persona:` block | LLM-judge over behavioral scenarios | `persona:` field in `profile.yaml` | **propose-only** (opt in with `--allow-persona-apply`) |
| `description` | a profile's one-line `description:` | LLM-judge | `description:` field (≤200 chars, Ajv-hard) | propose-only (`--allow-persona-apply`) |
| `command` | — | — | — | **null target** (see below) |
| `mcp` | — | — | — | **null target** |
| `cli` | — | — | — | **null target** |

## Null targets (verified, not stubs)

These were investigated and found to have **zero agent-behavior leverage**, so the
tool refuses them with an explanation rather than shipping a placebo optimizer:

- **`command`** — cue renders slash commands into CLAUDE.md as bare names only
  (`runtime-materializer.ts:619`); the `description:`/`argument-hint:` frontmatter is
  read only by the web dashboard, the router is skills-only, and `persona_routing`
  can't target a command. The real lever is the command **body** (a body-engine track).
- **`mcp`** — MCP configs carry no human description field; Claude learns MCP tools
  from the server's own runtime descriptors, which cue does not control.
- **`cli`** — `cue --help` strings are terminal-only; Claude never reads them.

## Honest caveats

- **Skill routing is synthetic-primary.** `analytics.jsonl` `skill_hit` fires for
  *every* skill in a profile, so the co-occurrence filter (≤3) drops almost all real
  sessions — even the top skill yields ~0 clean positives. Synthetic carries the load;
  analytics is opportunistic.
- **Description quality isn't enforced by lint alone** — R003 (≤200 chars) and R004
  (trigger phrase) are *warnings*. The skill gate adds explicit prechecks + lint-score
  non-regression on top of `cue lint-skill`.
- **Persona is propose-only by design.** A persona rewrite changes the agent's whole
  identity, and the LLM-judge-on-scenarios signal is directional, not authoritative —
  so it never auto-applies unless you pass `--allow-persona-apply` (which still gates on
  judge improvement + `cue validate` + backup/revert).
