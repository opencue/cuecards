# Agent collaboration in Cue

Read when delegating, resuming, or handing off repository work. This is a
task guide, not another always-injected instruction file. The repository
[AGENTS.md](../AGENTS.md) remains authoritative for local workflow; Claude's
[CLAUDE.md](../CLAUDE.md) points to that same source. Higher-priority session
instructions and user permissions still apply.

## Read the relevant docs, not the whole repository

| Work | Start here | Smallest initial check |
| --- | --- | --- |
| Launch or profile resolution | [Launch flow](launch.md) | The touched resolver/launch test file |
| Bootstrap or prompt footprint | [Context budget](agent-context-budget.md) | The touched default-profile or token-budget test file |
| First installation | [Lean setup](../setup/lean-cue.md), or the OS-specific setup named in AGENTS.md | One setup phase, then its documented check |
| Profile definition | The affected `profiles/<name>/profile.yaml` | `cue validate <name>` and its targeted tests |
| This collaboration contract | This guide and the root instruction pointer | `bun test src/lib/agent-collaboration.test.ts` |

These are starting checks, not substitutes for required CI or release gates.
Use the repository's package manager and existing skills. Do not install another
tool just because an upstream workflow uses it. For user-visible changes, keep
the relevant docs and release-note context with the implementation.

## One owner per change

1. Start with the requested outcome, exclusions, owned paths, and a runnable
   acceptance check. Use the current checkout and ownership evidence, not an old
   transcript, to decide whether work is already done.
2. Stay solo for a small sequential task. For worthwhile independent work, use
   the available coordination surface under the session's OMX and Guardex rules.
   Name one integration owner; each writer gets an isolated lane and claimed
   paths. Read-only investigation must not silently become implementation.
3. A bounded assignment includes the outcome, branch/worktree, allowed files,
   dependencies, verification command, and stop condition. Workers report scope
   conflicts or missing authority instead of taking over another lane.
4. If B needs A's output, hand off A's verified result before B starts dependent
   work. A message saying "done" does not establish that a commit was integrated.
5. The integration owner reads the actual diff and proof, reconciles overlapping
   assumptions, and runs the relevant checks on the combined result. Only the
   designated owner performs shared merge/release gates.

## Keep long-running work observable

Use harness-managed jobs or the active coordinator, not detached shell `&`
jobs with no tracking. Record the purpose, owner, task/session ID, log location,
and running/completed/failed state. If that facility is unavailable, keep the
command in the foreground or return an explicit blocker rather than hiding it.
Poll one job with bounded waits; stop polling after exit. Reuse an already
captured CI log until a new run changes the evidence.

Before ending or handing off, report any live process and who owns it. Stop only
task-owned jobs that are no longer needed; never kill unrelated user processes.

## Handoff template

Use the coordinator's existing task state or a short message; do not create a
second tracker or copy full agent transcripts. Fill unknown fields explicitly.

```text
Outcome: requested result, completed part, and exclusions
Branch/worktree: branch and checkout path
Owned paths: files claimed by this lane
Commit/PR: exact revision and URL/state, or not committed/not opened
Verification: command, tested revision, result; skipped checks and reason
Live jobs: owner + task/session ID + log + status, or none
Blocker: missing input/authority, failing check, or none
Next action: one concrete action and its owner
```

On receipt, inspect the current status, referenced revision/diff, and ownership.
Check that proof applies to the revision being integrated; rerun affected checks
after changes. A handoff carries neither new permissions nor authority to bypass
production, credential, publication, or file-ownership boundaries.

## Publication and evidence boundaries

Distinguish local edits, tested changes, committed changes, an open PR, a merge,
and a published release. Do not describe one as another. Implementation does not
authorize deployment or package publication; follow the explicit task and the
repository's existing delivery gates. Before an authorized GitHub write, verify
the Git author/committer and authenticated writer match the repository context.
Use `gh` with narrow JSON fields for current GitHub metadata and `--body-file`
for shell-sensitive prose; inspect the body and redact secrets before sending.

Contract tests prove pointers, local links, template fields, and the bootstrap
line budget. They do not prove agents cooperate better. Effectiveness claims
need repeated A/B runs with the same tasks and model and only the guidance
changed, comparing success/regressions before tokens and elapsed time.

## Source and adaptation

Inspired by [NagyVikt/agent-scripts AGENTS.MD at 2784a389](https://github.com/NagyVikt/agent-scripts/blob/2784a3898df4b057bf0cea225b3357561b4f1658/AGENTS.MD)
and its [README](https://github.com/NagyVikt/agent-scripts/blob/2784a3898df4b057bf0cea225b3357561b4f1658/README.md),
inspected using `opensrc path NagyVikt/agent-scripts` on 2026-09-19.
Upstream is MIT-licensed, copyright 2026 Peter Steinberger. This guide restates
selected ideas for Cue rather than vendoring its rules or scripts.

Retained: one shared instruction source, task-triggered docs, skill-owned tool
workflows, observable jobs, protected user work, and evidence-backed delivery.
Not imported: personal paths/accounts, machine-specific permissions, forced
model routing, mandatory external review, opportunistic unrelated cleanup,
automatic push/publication permissions, or global symlink/config changes.
No upstream checkout or network access is needed to use this guide.
