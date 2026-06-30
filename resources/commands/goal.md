---
description: Prove a measurable check, then keep working — continue to the next goal on the topic instead of stopping. Use when the user says "/goal", "work longer", or "keep going".
---

# /goal — goal-driven execution

Turn a fuzzy request into a goal you can *prove* you hit, then keep going. This
replaces "make it work" (unverifiable, invites scope creep) with a measurable
target and a check that closes it — and replaces "stop when done" with "prove
it, then propose the next goal and continue." Each passing check is a
checkpoint, not the exit.

**TL;DR:** restate the ask as outcome + a runnable check → reach it by the
highest-ROI path → loop (smallest change, then run the check) until it passes →
commit → propose the next checkable goal and continue. Interactive asks before
each new goal; `auto` self-picks. Three fails on one check is a hard stop.

## Arguments

`/goal [topic] [auto] [cap=N]` — all optional.

- **topic** (free text) — the request to pursue. Omitted → use the current task
  in context.
- **auto** — run unattended: each round, pick the top-ROI next goal yourself and
  continue without asking. Also implied when the user says "keep going", "work
  longer", or "until I say stop". Absent → **interactive** (the default): ask
  before starting each new goal.
- **cap=N** — max continuation rounds before pausing to confirm (default 5).
  `cap=1` runs one goal and stops at Step 5; "until I say stop" lifts the cap.

The chosen mode (interactive vs auto) and cap are set here once and govern the
Step 6 fork for the whole run.

## Step 1 — Restate as a measurable goal + a runnable check

Rewrite the ask as **outcome + a success criterion you can run.**

| Fuzzy ask | Measurable goal + check |
|-----------|-------------------------|
| "make it faster" | p95 of `GET /search` < 200ms, proven by `<bench cmd>` |
| "fix the flaky test" | `<test>` passes 50/50: `for i in $(seq 50); do …; done` |
| "add validation" | invalid inputs rejected — new tests in `<file>` go red→green |
| "clean up the module" | same public API, tests still green, `<lint>` 0 warnings |

If you can't name a check, you don't have a goal yet — stop and define one with
the user. A check is a command, a test, a metric, or a before/after
measurement (for visual claims, a screenshot or `getBoundingClientRect`, not a
read of the CSS).

## Step 2 — Rank the ways to reach it by ROI

List the candidate approaches. If there are 3+, run `/roi-estimator` so each
carries a `dimension +N% 🟢/🟡/🟠` tag. Take the highest-ROI path first; name
the low-ROI tail as skippable. One goal at a time — don't braid two goals into
one diff.

## Step 3 — Loop: smallest change → run the check

1. Make the **smallest** change that should move the check.
2. Run the check. Capture the actual output (not "looks right").
3. Pass → commit, go to Step 5. Fail → Step 4.

## Step 4 — On failure, diagnose before retrying

- Read the failure output. State a one-line hypothesis for *why* it failed.
- Change one thing. Re-run.
- **After 3 failed attempts on the same check: stop.** The goal or the approach
  is probably wrong. Re-state the goal, escalate to `/investigate` for
  root-cause, or ask the user. Do not keep flailing.

## Step 5 — Confirm the check

Re-run the check one final time, clean. Report: the goal, the check, its actual
output, and the diff. Commit this round on its own so the loop stays bisectable.
This goal is proven — now extend, don't exit.

## Step 6 — Continue: propose the next goal, don't stop

A passing check unlocks the next move. Keep working on the topic instead of
ending the session.

1. **Reflect** (one line each): what did passing this check unlock? what's now
   adjacent, half-done, or newly worth doing?
2. **Generate your own next goals.** Write 3-5 candidate goals, each with its
   own runnable check (no check = drop it). Spread across three lanes:
   - **continuation** — finish what this just enabled
   - **loose-end** — a gap it exposed: a missing test, edge case, or error path
   - **upside** — a sharper, more precise version of what you just shipped
3. **Rank by ROI.** Run `/roi-estimator` when there are 3+ so each carries a
   `dimension +N% 🟢/🟡/🟠` tag.
4. **Fork on the next goal** (per the mode set in Arguments):
   - **Interactive** (default): ask via `AskUserQuestion` — "what to implement
     next?" with the top-ROI goal first (recommended) and **"Stop here"** as the
     last option. Name the check in each option so the user picks a provable goal.
   - **Auto** (`/goal auto`, or "keep going" / "work longer"): take the top-ROI
     goal yourself, log one line (`picked X because Y`), and continue. Pause to
     ask only when the best remaining ROI is 🟠 or lower, or you're out of
     checkable ideas.
5. **Restart at Step 1** with the chosen goal as the new measurable goal. One
   goal in flight at a time — chain them, never braid two into one diff.

## Guardrails

- **No check = not a goal.** Refuse to "just do it" without a success criterion.
  This applies to every *generated* next goal too — drop ideas you can't check.
- **3-strike rule is a hard stop**, not a suggestion. A wall *ends the
  marathon*; it never gets auto-picked around — escalate to `/investigate` or
  the user.
- **Continuation is bounded and consensual.** At the `cap` (see Arguments,
  default 5 rounds), summarize and ask whether to keep going — a yes resets the
  cap. Stop immediately on "stop", or when two rounds in a row produce no
  checkable idea.
- **One goal in flight, atomic commit per round.** Chain goals; keep the loop
  bisectable.
- A goal you "verified" by reading code instead of running the check is
  unproven — say so with the matching confidence tag.
