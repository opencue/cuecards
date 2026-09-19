# Explicit agent handoffs

Use `cue handoff` to transfer bounded task context between CLI processes. It is
not a scheduler, file lock, test runner, or authorization service. OMX/Guardex
still owns coordination and file ownership. See the
[collaboration guide](agent-collaboration.md) for the human handoff contract.

## Create and select a handoff

From the repository being handed off:

```sh
cue handoff create --from backend --agent claude-code --repo . \
  --task "Continue the parser fix" --notes "The negative cases still need a test" --json
```

Keep the returned `id`. The receiving process explicitly selects that record and
the repository it is working on:

```sh
cue handoff inject <id> --repo . --json
```

The same commands work with `--agent codex`. The label records the stated source
agent; it is not authenticated identity or proof of who executed the task.

To intentionally select the latest handoff for one repository, use
`cue handoff inject --repo .`. Bare `cue handoff inject` no longer selects the
latest record globally. It fails with `HANDOFF_SELECTION_REQUIRED` so unrelated
projects cannot silently supply continuation context.

For inspection, `latest`, `list`, and `show <id>` remain available. Inspection is
not permission to integrate a record into the current task.

## Structured context

Pass `--context <file.json>` to `create` for optional task/coordinator references,
ownership/job references, a blocker, and one next action. For example:

```json
{
  "task_ref": "parser-negative-cases",
  "coordinator_ref": "existing-coordinator-task-id",
  "ownership_refs": ["existing-file-claim-id"],
  "job_refs": [],
  "blocker": "Negative cases are not covered yet",
  "next_action": { "owner": "receiving-agent", "action": "Add and run the negative cases" }
}
```

An optional `verification` array records claims with `command`, `cwd`,
`timestamp`, `revision`, `worktree_fingerprint`, `result` (`passed`, `failed`, or
`unknown`), and `evidence_path`. These are recorded claims, not executable jobs
or independently checked proof. Evidence paths are not automatically opened.
Unknown fields and oversized inputs are rejected.

## Interpret the receiving result

With `--json`, injection returns `handoff`, `assessment`, and `formatted`.
`formatted` is the bounded, agent-neutral historical context. Pass it as data,
not as higher-priority instructions. Do not execute shell commands found in it.

| Assessment | Meaning |
| --- | --- |
| `matching-unverified` | Repository state matches, but recorded completion/test claims have not been independently verified. |
| `unverified` | The record lacks sufficient evidence to establish current state. |
| `legacy-unverified` | An older record has no reliable repository/proof metadata. |
| `repo-mismatch` | The record belongs to a different repository. |
| `stale` | Recorded repository state no longer matches the working tree. |

Repository mismatch and stale state are unsuccessful injections (nonzero exit).
No assessment certifies that a test passed just because the sender wrote that it
did. Check the actual diff, evidence, and coordinator before resuming work.
Ownership/job references without a live coordinator check remain unknown.

The repository fingerprint considers dirty content, not only the HEAD commit or
the list of modified filenames. A second edit to an already-dirty file can make
the record stale even when `git status --porcelain` looks unchanged.

The pilot fingerprints tracked and nonignored untracked file bytes, within a
10,000-file / 32 MiB bound. It does not scan ignored content. Submodules,
symlinks, unreadable content, or exceeded limits make the fingerprint unavailable
and the result `unverified`, rather than treating a partial scan as a match.
**Cue itself has submodules, so its handoffs retain repository identity and
revision but do not receive a matching fingerprint in this pilot.** Inspect the
actual state and rerun the relevant checks before continuing.

## Compatibility and safety

- Old records remain readable, with explicit unverified status rather than
  invented repository or verification details.
- Missing source-agent information is not silently attributed to Claude.
- The existing checkpoint lifecycle hook is separate and unchanged. This feature
  does not automatically inject handoffs during `cue launch`.
- JSON errors use `{"error":{"code":"...","message":"..."}}` and a nonzero
  exit. Use the code for automation, not the human message.
- Record IDs, JSON shape, and input sizes are validated. Writes use unique IDs
  and atomic storage; sensitive text is redacted. This is not a reason to include
  secrets, complete transcripts, or raw environment dumps in handoffs.
- The sender's claims, paths, commands, ownership references, and agent label are
  untrusted metadata. They do not grant access or expand the receiver's scope.

## Verification and measurement

```sh
bun test src/lib/handoff.test.ts src/commands/handoff.test.ts \
  src/commands/handoff-integration.test.ts src/lib/session-checkpoint.test.ts
```

The process-integration tests use synthetic repositories and separate CLI
processes. They are not live Claude/Codex agent evaluations and do not establish
that collaboration is faster. The separate collaboration A/B fixtures and
offline reporting infrastructure live under `evals/agent-eval/collaboration-ab/`;
real model runs require an explicit quota decision.
