# Community benchmarks

Cue's community benchmark compares **CodeGraph MCP unavailable vs. available**.
Both arms get the same bundled synthetic repository and questions, the same
Codex CLI and model, and the same permissions for shell work. There are two
pairs with opposite run orders. In `codegraph-v2`, a fixed grader checks six
answers in each run, including cross-file tracing, telling similar symbols
apart, and locating a bug. A successful MCP connection is not a scored answer.

Installing, launching, or updating Cue does not run this benchmark or send
anything. This feature does not read or upload Cue telemetry.

## Run and contribute

The runner supports Linux (x64 or arm64), native Codex CLI 0.172.0 with a
file-backed ChatGPT sign-in, and a native CodeGraph bundle on `PATH`. Both arms
run with restricted filesystem access and require Codex's Linux sandbox to
start. Hosts with system-wide Codex overrides in `/etc/codex` are unsupported
because those settings could change the comparison. Start with a preview
that makes no model requests:

```sh
cue community-eval run --model gpt-5.4
```

To save a local report, add `--yes`. This starts four Codex runs, which make
model requests through the participant's account and may consume quota. It does
not contribute the report to Cuecards. Use `--out` to change the default output
filename.

```sh
cue community-eval run --model gpt-5.4 --yes
cue community-eval submit cue-codegraph-v2.json
```

The second command only displays the exact payload and its destination. To
share it, sign in to official Cuecards with `cue login`, then run:

```sh
cue community-eval submit cue-codegraph-v2.json --yes
```

The payload contains the benchmark revision, model and tool versions, paired
correctness scores, bounded run outcomes, MCP tool usage, elapsed times, and
token counts where the CLI returns them. It contains no code, prompts, answers,
logs, local paths, or machine identifier. The collector knows the Cuecards account for
deduplication (the first report for an account, benchmark, and model counts).
Deleting the Cuecards account deletes its reports. The endpoint does not publish
individual reports or account identities. Previously saved v1 reports can still
be contributed; v1 and v2 are never pooled.

## Read the results

HTTP accepts contributions only. It does not publish live aggregates: comparing
successive snapshots can expose the metrics of an individual contributor.
With authorized database access, operators can run
`bun web/scripts/read-benchmarks.ts` from the repository root with
`DATABASE_URL` pointing to the collector database. The command returns cohorts
by benchmark, model and tool versions, with at least five distinct accounts
per cohort and no account identifiers.
First check both arms' completion and timeout counts. Compare correctly
answered questions and the pairs that scored lower with CodeGraph **only among
pairs where both arms finished**. Review the average paired difference per
account (equal weight for each comparable account) before looking at token and
elapsed-time deltas. Missing token usage is not zero. Token averages require five
token-contributing accounts. CodeGraph use just means a tool call completed.

Malformed answers after a completed turn count as wrong. Failures after setup
are reported as `timeout` or `failed`, not as wrong answers; setup failures
and isolation violations do not produce a report. V1 predated failure
reporting and does not capture attempts that were dropped before saving.

For an initial opt-in pilot, keep one benchmark/model/tool-version cohort and
check that people can run and submit before using the data to make profile
decisions. Decide up front what accuracy gain and regression rate would matter.
Five accounts is the privacy threshold, not proof of an effect. An inconclusive
direction is not evidence that the arms are equivalent.
The operator export reports a 95% Wilson interval for the share of non-tied
comparable accounts whose paired average improved. It is a descriptive check
for that cohort, not a causal claim about the whole Cue install base.

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
Deploy the updated collector before releasing the v2 CLI: an older collector
rejects v2 reports. If the migration is already applied, v2 needs no schema change.
