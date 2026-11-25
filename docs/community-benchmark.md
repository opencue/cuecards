# Community benchmarks

Cue's first community benchmark compares **CodeGraph MCP unavailable vs.
available**. Both arms get the same bundled synthetic repository and questions,
the same Codex CLI and model, and the same permissions for shell work. There are
two pairs with opposite run orders. A fixed grader checks three answers in each
run; a successful MCP connection is not a scored answer.

Installing, launching, or updating Cue does not run this benchmark or send
anything. This feature does not read or upload Cue telemetry.

## Run and contribute

The v1 runner uses Linux, local Codex with a ChatGPT sign-in, and CodeGraph on
`PATH`. Start with a free preview:

```sh
cue community-eval run --model gpt-5.4
```

To save a local report, add `--yes`. This makes four model calls through the
participant's Codex account and may consume quota. It does not contribute the
report to Cuecards. Use `--out` to change the default output filename.

```sh
cue community-eval run --model gpt-5.4 --yes
cue community-eval submit cue-codegraph-v1.json
```

The second command only displays the exact payload and its destination. To
share it, sign in to official Cuecards with `cue login`, then run:

```sh
cue community-eval submit cue-codegraph-v1.json --yes
```

The payload contains the benchmark revision, model and tool versions, the
paired correctness scores, MCP tool usage, elapsed times, and token counts
where the CLI returns them. It contains no code, prompts, answers, logs, local
paths, or machine identifier. The collector knows the Cuecards account for
deduplication (the first report for an account, benchmark, and model counts).
It does not publish individual reports or account identities.

## Read the results

`GET https://cuecards.cc/api/v1/benchmarks` publishes cohorts by benchmark,
model and tool versions, with at least five distinct accounts per cohort.
Compare correctly answered questions and the pairs that scored lower with
CodeGraph first; compare token and elapsed-time deltas second. An arm marked as
using the MCP says only that the tool call completed. Missing usage is not
counted as zero. Token averages need five token-contributing accounts too.

This is a self-selected, self-reported comparison on a fixed task. It does not
measure all users' repositories, and the service cannot independently verify
that the reported model runs happened. Do not use it as a leaderboard or a
general claim that CodeGraph improves task success.

## Collector setup

The collector lives in `web/api/v1/benchmarks.ts`. Apply
`web/migrations/003-community-benchmarks.sql` to the Cuecards database after
the existing auth schema, using the usual migration process. Vercel builds
with `web/` as their root must include source files outside that root because
the CLI and collector share the report validator in `src/lib/community-eval/`.
Deploying the collector and releasing the Cue CLI are separate steps.
