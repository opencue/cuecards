# Plan: Hermes-style skill self-evolution — full upgrade

> Status: **in progress** on branch `feat/skill-evolution-upgrade` (worktree-isolated).
> Builds on the existing `evolution/` package (ported from NousResearch/hermes-agent-self-evolution)
> and the `docs/self-learner.md` Stop-hook loop. The loop already exists; this makes it
> real, well-judged, and wired into `core` — default-OFF, propose-only.

## Why this work

The Hermes-ported evolver is complete but **dormant**: default-OFF, pilot-wired into
`skill-writer` only, never run (0 `skill_gap` events on the dev machine), and carrying two
documented quality caveats (keyword-overlap metric by default; eval scores a synthetic proxy,
not real Claude Code behaviour). The **automated** path uses the `single-shot` optimizer
(`auto_evolve.py` → `evolve(optimizer="single-shot")`), *not* GEPA — so a one-shot rewrite +
one text-diff judge is all that runs today.

## Resolved decisions

- **D1 — Writer-critic loop, default 2 rounds** (`CUE_WRITER_LOOP_ROUNDS`). Retry on `WORSE`
  always; on `EQUAL` only when the critic returned actionable fixes and rounds remain.
  `propose_improved_body`/`judge_is_better` stay as back-compat wrappers (hooks import by name).
- **D2 — Task-grounded critic (DSPy-free):** critic runs ONE mined task through the candidate
  skill via `run_claude_p`, then judges the real transcript with the existing `run_claude_p`
  judge prompt. Soft-falls-back to text-diff review. 1 subagent call/round — not the
  20×/iteration cost bomb.
- **D3 — Judge defaults (GEPA/holdout path):** acceptance/holdout metric default `overlap → judge`
  (LLMJudge); GEPA *inner* metric stays `overlap` (cost), `judge` opt-in; new `--metric subagent`
  is holdout-only, cost-flagged, soft-fallback. `--eval-source` default `synthetic → auto`.
- **D4 — Activation:** wire `profile-self-improve.json` + `auto-evolve.json` + `learnings-surface.json`
  into `core`, default-OFF behind the flag files; fix the `CUE_EVOLUTION_DIR` portability gap.
  Enabling on a machine is a separate explicit step, propose-only.
- **D5 — propose-only everywhere.** No auto-apply enabled by this work.

## Stages (each independently verifiable + revertable)

| Stage | Work | Verify |
|---|---|---|
| 0 | Worktree + baseline | tests green (78p/2s) + `auto_evolve --dry-run` ✅ |
| 1 | Writer-critic loop (`reflective.py`, `evolve_skill.py`, `config.py`) | retry-logic unit test; `evolve <skill> --propose-only` → lint-passing proposal logged `optimizer:"writer-loop"` |
| 2a | **Task-grounded critic** (`reflective.py`, `evolve_skill.py`) — critic runs the candidate on a real mined task (`run_claude_p`) and judges the transcript | ✅ done: grounding + mining unit tests; loop feeds the critic a real transcript |
| 2b/2c | GEPA `judge` default + `SubagentJudgeMetric` (holdout) | **deferred** — see below |
| 3 | Activate into `core` (`profiles/core/profile.yaml`, `auto-evolve.sh`) | `cue validate` clean; materialized `settings.json` shows both Stop hooks; flags-OFF = no-op |
| 4 | Review + ship | no CRITICAL/HIGH; full suite green; gated PR |

## Deferred: Stage 2b/2c (GEPA judge default + subagent holdout metric)

Cut from this pass on purpose — they only touch the **manual GEPA** path (the
automated Stop-hook loop runs `single-shot`, never GEPA), and they **cannot be
live-verified in this environment** (`dspy` import is broken). Spirit of "default
to the LLM judge on real behaviour" is already delivered for the path that runs
by Stage 2a. Ready-to-execute change-points when `dspy` works:

- **2b — default the holdout/acceptance metric to `judge`.** Do NOT naively flip
  `evolve_skill.py:~205` `metric_mode` default `overlap → judge`: that puts
  `LLMJudge` in GEPA's *inner* loop (~`max_metric_calls` calls/run — a cost bomb).
  Instead split it: keep GEPA's inner `fitness_metric` on `overlap`, and build a
  separate `holdout_metric = make_judge_metric(config, skill_text=...)`
  (`CUE_EVOLVE_HOLDOUT_METRIC`, default `judge`, soft-fallback) used only in the
  holdout loop at `evolve_skill.py:~410-413`.
- **2c — `SubagentJudgeMetric`** (`fitness.py`, beside `make_judge_metric`): a
  metric that runs the candidate through `run_claude_p` on a holdout example and
  feeds the transcript to `LLMJudge.score()`. Holdout-ONLY (one subprocess/example
  ≈120s); never pass it as the GEPA inner metric. Soft-fallback to overlap when
  `claude` is absent. `--eval-source` default `synthetic → auto` (sessiondb then
  synthetic) at `evolve_skill.py:~155`.

## Environment notes

- `evolution/.venv` is gitignored → absent in a worktree. Run edited source via the main venv:
  `PYTHONPATH=<worktree>/evolution /home/deadpool/Documents/cue/evolution/.venv/bin/python -m ...`
  (PYTHONPATH shadows the editable main install — verified).
- `dspy` import is broken in this env (`libstdc++.so.6` missing), so live GEPA/LLMJudge can't run
  here. Stage 1 is DSPy-free and fully verifiable; Stage 2 relies on the repo's existing dspy-mock
  seam tests. Fixing dspy = a system-lib install (out of scope, network/sudo).
