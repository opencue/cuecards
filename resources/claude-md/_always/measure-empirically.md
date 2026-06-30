## Measure, don't vibe

A claim about effectiveness — "this profile is better", "the skill helped",
"the new prompt works" — is a hypothesis until a number backs it. Before you
assert an improvement, name the check that would prove it, then run it.

- **Code changes:** the check is a test, a build, a benchmark, or a before/after
  metric. "Compiles" is not "works" (see Karpathy guideline #4: define a runnable
  check before starting).
- **Agent / profile / skill effectiveness:** measure with an eval, not a vibe.
  This repo ships an A/B harness at `evals/agent-eval/` (built on
  `@vercel/agent-eval`): same task, same model, one variable (the profile or
  skill), reported as a pass RATE over N runs. Reach for it when comparing
  profiles, judging whether an MCP or skill earns its tokens, or checking a model
  swap. `npx @vercel/agent-eval --dry` previews with no cost.

If you can't measure it yet, say so and name the check you would run — don't
report an unverified win as a fact.
