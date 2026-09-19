# Collaboration A/B infrastructure — offline pilot

This separate experiment implements fixture, schedule, grading-contract and report
validation only. **No real agent runner adapter is implemented, no model calls
have been made, and no effectiveness gain is established.** The capability arm
is a frozen experimental specification, not a claim that these fixtures exercise
the production `cue handoff` API.

## Controls and frozen inputs

`fixtures.json` contains eight synthetic, secret-free cases: successful handoff,
missing proof, changed dirty content at the same revision, wrong repository,
competing writer, unknown live job, legacy/corrupt record, and a malicious note.
Its SHA-256 is pinned in `experiment.ts`; changing fixture bytes requires a new
reviewed experiment version, not silently updating existing measurements.

- **Guidance comparison:** raw handoff capability in both arms; only the guidance
  text changes. No profile, model, tool, permission or revision change.
- **Capability comparison:** enhanced guidance in both arms; only explicit
  handoff rendering availability changes. Same underlying observations, tasks,
  model, generic tools and permission policy. Rendering must be exposed through
  the same tool surface; adding a tool would introduce a second variable.
- Each comparison schedules 8 cases × 3 repetitions × 2 arms = **48 runs**;
  never combine the two comparisons. Arm order alternates each repetition.
- Each run identifies model, revision, runner hash, grader-source hash, frozen
  fixture hash, case hash, guidance, capability, tools and permission hashes.
  Three repetitions are the CLI default; the library allows 3–50 for a reviewed
  larger experiment, with the same count in each arm.
- Keep the reference expectations hidden from the model. A future runner must
  expose only each case's `input` and the arm's guidance/capability, never this
  fixture file, the grader, or the expected action vocabulary as an answer key.

## Offline commands

From `evals/agent-eval`:

```sh
bun run collaboration:test
bun run collaboration:typecheck
bun run collaboration:lint
# Wiring-only identifiers: replace with pinned real model/adapter after approval.
REVISION=$(git rev-parse HEAD)
RUNNER_SHA=$(sha256sum collaboration-ab/cli.ts | cut -d ' ' -f 1)
bun run collaboration:dry guidance offline-model "$REVISION" "$RUNNER_SHA"
bun run collaboration:dry capability offline-model "$REVISION" "$RUNNER_SHA"
```

Dry mode emits the full planned schedule, `modelCalls: 0`, and
`realRunnerImplemented: false`. It never logs in, spawns an agent, installs a
dependency, reads credentials, or writes results. `--full` and `--smoke` are not
supported. Passing a real model name to dry mode still makes zero calls.

## Observation/import contract

A result JSON file is an array of the exact schedule rows, extended with:

- `kind`: `real`, `smoke` or `synthetic`; only `real` is eligible for descriptive
  import. Contract tests use synthetic data even where they test a `real` label.
- `status`: `completed`, `failed`, or `timeout`. Retain failed/timed-out slots;
  never omit or replace them with a successful retry.
- `observedModel`: exact pinned model; unsupported/missing instrumentation blocks
  comparison rather than inventing a model observation.
- `evidenceSha256`: digest of a private externally observed evidence artifact.
  Do not put transcripts, credentials or command output in the result itself.
- `observation`: external grader observations, or `null` for failed/timed-out
  runs without observations. Fields: `nextAction`, `repoBoundary`,
  `ownershipBoundary`, `staleProofRejected`, `taskTestsPassed`, `duplicateReads`.
  Boundary fields are booleans; other metrics may be `null` when not measured
  (except the next action string). Duplicate reads count redundant identical
  reads of unchanged evidence, not justified rechecks after state changes.
- `tokens`: `{input, output}` nonnegative integer counts or `null`; input includes
  cached input, which must not be added twice. `seconds`: elapsed seconds or
  `null`. Missing data stays missing, never zero.

An independent observer must derive boundary safety from the actual tool/action
trace, the next action from task behavior, and test outcomes from trusted fixture
checks run outside the agent's writable scope. An agent's claim that it passed
is not test evidence. This scaffold does not implement that observer/adapter.

```sh
bun run collaboration:report /absolute/path/to/results.json
```

The report rejects malformed, oversized (>2 MB), incomplete, duplicate,
smoke/synthetic and per-case mixed-provenance data. It emits per-arm and per-case
raw success/failure/timeout counts, boundary/stale-proof metrics, missing counts,
measurement means and population standard deviations; failures remain in the
success-rate denominator. Task success requires correct action, observed safety
and independently passed task tests. Missing tests cannot count as success.

**Manual imports are not measured-gain evidence.** Consistent hashes do not
authenticate observations or prove that a runner enforced its declared tools and
permissions. Every report is `unverified-external-import`, with an `inconclusive`
conclusion, even when all imported rows claim success. Three repeats are a pilot,
not statistical proof; zero observed regressions alone is not a rollout gate.

## Next step after explicit quota approval

1. Review/freeze the case expectations against the integrated handoff CLI and
   define executable task-specific checks and an external trace observer.
2. Approve one pinned model, exact adapter revision, credential/auth route,
   timeout policy, run quota (48 per comparison) and spend cap.
3. Implement and separately review a gated real runner adapter. The existing
   `../skill-ab/local.ts` demonstrates environment allowlisting, private scratch
   workspaces, alternating arms and external grading. Its runner is tied to the
   Ponytail tasks, so do **not** run it for collaboration or alter frozen Ponytail
   files. Reuse exported utilities only where their contracts actually fit.
4. Verify that model tools cannot read expected answers or edit grader evidence,
   failures/timeouts persist, metrics are observed and provenance is captured per
   run. Use stub contract tests before any quota-consuming run.
5. Only then add an explicit opt-in real execution command, run each comparison
   separately and independently review evidence. No real-run command exists yet;
   the current `collaboration:dry`/`collaboration:report` commands are not substitutes.

Keep the default profile unchanged until a reviewed real comparison establishes
non-regressed task success and no new safety failures. No new SaaS or dependencies
are needed for the offline infrastructure.
