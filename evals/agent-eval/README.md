# cue-agent-eval

A/B test cue **profiles** with [`@vercel/agent-eval`](https://github.com/vercel-labs/agent-eval).
Same task, same model, run in an isolated sandbox — the **only variable is the
cue profile's `CLAUDE.md`** (persona + rules + skill-routing). The output is a
**pass rate** per profile, so "gstack is better than core for X" stops being a
vibe and becomes a number.

```
experiments/core.ts       baseline
experiments/gstack.ts     58-role full profile
experiments/improver.ts   goal-with-a-check loop
evals/create-button/      one starter task (PROMPT.md + EVAL.ts)
lib/with-profile.ts       injects a profile's CLAUDE.md into the sandbox
```

## How a profile becomes the variable

`lib/with-profile.ts` adds a `setup()` that runs **on the host**:

1. `cue launch <profile> --rematerialize` — materializes the profile's full
   runtime (persona + rules + skill-routing + `_always` fragments → `CLAUDE.md`)
   **without exec'ing claude**, and prints `{ runtimeDir }`.
2. Reads that `CLAUDE.md` and writes it into the sandbox project root, so the
   in-sandbox Claude Code runs under that profile's instructions.

**Not injected** (by design): MCP servers, hooks, and the headroom proxy env.
They need keys/network and would fail to start in a throwaway sandbox. The
measured variable is the profile's *instructions*, not its infra. Skill **bodies**
aren't injected yet either (the `CLAUDE.md` already carries each profile's skill
list + routing) — see the extension note at the bottom of `lib/with-profile.ts`.

## Prerequisites

- `@vercel/agent-eval` — installed globally (`agent-eval --help`).
- **Docker** — the experiments use `sandbox: 'docker'` (no Vercel token needed).
- **An agent API key** — `ANTHROPIC_API_KEY` (direct, the default) **or**
  `AI_GATEWAY_API_KEY` (gateway). Without one the sandbox can't authenticate, so
  runs fail. `--dry` needs no key.
- `cue` on `PATH` (this repo's CLI) — `with-profile.ts` shells out to it.
  Run the eval from a **plain shell**, not from inside a cue-launched session:
  `CUE_LAUNCHING=1` trips cue's recursion guard and `--rematerialize` would fail.

## Run

```bash
cd evals/agent-eval
cp .env.example .env          # add ANTHROPIC_API_KEY (or AI_GATEWAY_API_KEY)
npm install                   # only needed to typecheck / run EVAL.ts locally

npx @vercel/agent-eval --dry  # preview all 3 profiles — no API calls, no cost
npx @vercel/agent-eval        # run all 3 (core, gstack, improver)
npx @vercel/agent-eval core   # run just one
npx @vercel/agent-eval --smoke  # one run per experiment — verify keys/sandbox
```

Results land in `results/<experiment>/<timestamp>/`. Compare `passRate` in each
`summary.json` across the three profiles.

## Extend

- **More tasks:** add `evals/<task>/` with `PROMPT.md` + `EVAL.ts` (+ `package.json`,
  `src/`). They run against every experiment automatically.
- **More profiles:** copy an experiment file and change `withProfile('<name>')`.
- **All profiles:** map `withProfile` over `cue list` output from a generator
  script (heavier; most configs you'd never run — start with the 3 here).

## Cost note

Each run spins up a sandbox, installs Claude Code, and runs the agent. `runs: 3`
× 3 profiles × tasks = real API tokens. Start with `--dry`, then `--smoke`, then
a full run on a small task set.
