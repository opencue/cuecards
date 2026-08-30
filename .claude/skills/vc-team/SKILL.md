---
name: vc:team
description: "Orchestrate Agent Teams for parallel multi-session collaboration. Use for research, implementation, review, and debug workflows requiring independent teammates."
argument-hint: "<template> <context> [--devs|--researchers|--reviewers N] [--delegate]"
metadata:
  author: claudekit
  version: "3.0.0"
---

# Agent Teams - Parallel Orchestration Utility

Coordinate multiple independent Claude Code sessions. Each teammate has own context window, loads project context (CLAUDE.md, skills, agents), communicates via shared task list and messaging.

**Requires:** Agent Teams enabled. Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings.json env.
**Requires:** CLI terminal — `TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList` and `TeamCreate`/`TeamDelete` are **disabled in VSCode extension** (`isTTY` check). Agent Teams CANNOT run in VSCode.
**Model requirement:** All teammates must run Opus 4.6 (Agent Teams constraint).

## Usage

```
/vc:team <template> <context> [flags]
```

**Templates:** `research`, `execute`, `review`, `debug`

**Flags:**
- `--devs N` | `--researchers N` | `--reviewers N` | `--debuggers N` -- team size
- `--plan-approval` / `--no-plan-approval` -- plan gate (default: on for execute)
- `--delegate` -- lead only coordinates, never touches code
- `--worktree` -- use git worktrees for implementation isolation (default: on for execute)

## Execution Protocol

**Pre-flight (MANDATORY -- merged into step 2 of every template):**
1. Step 2 of every template calls `TeamCreate(team_name: "...", ...)`. Do NOT check whether the tool exists first -- just call it.
2. If the call SUCCEEDS: continue with the template.
3. If the call returns an ERROR or is unrecognized: **STOP. Tell user:** "Agent Teams requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings.json. Team mode is not available."
4. Do NOT fall back to subagents. `/vc:team` MUST use Agent Teams or abort.
5. Ensure `TeamCreate` was called before spawning teammates -- team association happens via session context.

When activated, first confirm team creation if the user has not already explicitly approved using agent teams for this task.
Do not use this skill to bypass the repo's normal human approval gates.
Execute the tool calls in order only after team usage is approved. Report progress after each major step.

### --delegate Mode

When `--delegate` flag is passed:
- Lead enters delegate mode (`Shift+Tab` after TeamCreate)
- Lead ONLY: spawns teammates, manages tasks, sends messages, synthesizes reports
- Lead NEVER: edits files, runs tests, executes git commands directly
- For execute Step 7 MERGE: spawn a dedicated merge teammate instead of lead doing it
- For all templates: lead coordinates and reports, delegates ALL implementation work

---

## Tool Reference (Quick)

### Agent Tool (spawn teammates)

```
Agent(
  subagent_type: "research-agent" | "execute-agent" | "code-reviewer" | "debugger" | "tester" | ...,
  description: "short task summary",
  prompt: "full instructions + CK Context Block",
  model: "opus",                    # Required for Agent Teams teammates
  run_in_background: true,          # Non-blocking spawn
  isolation: "worktree"             # Git worktree isolation (execute devs)
)
```

**Note:** `Task` was renamed to `Agent` in v2.1.63. Both names work; prefer `Agent` for new code.

### Team Management Tools

| Tool | Purpose | Params |
|------|---------|--------|
| `TeamCreate` | Create team + task list | `team_name`, `description` |
| `TeamDelete` | Remove team resources | *none* -- just call it |
| `TaskCreate` | Create work item | `subject`, `description`, `priority`, `addBlockedBy`, `addBlocks` |
| `TaskUpdate` | Claim/complete task | `taskId`, `status`, `owner`, `metadata` |
| `TaskGet` | Full task details | `taskId` |
| `TaskList` | All tasks (minimal fields) | *none* |
| `SendMessage` | Inter-agent messaging | `type`, `to`/`recipient`, `message` |

### SendMessage Types

| Type | Purpose |
|------|---------|
| `message` | DM to one teammate (requires `recipient`) |
| `broadcast` | Send to ALL teammates (use sparingly) |
| `shutdown_request` | Ask teammate to gracefully exit |
| `shutdown_response` | Teammate approves/rejects shutdown (requires `request_id`) |
| `plan_approval_response` | Lead approves/rejects teammate plan (requires `request_id`) |

---

## CK Context Block

Every teammate spawn prompt MUST include this context at the end:

```
CK Context:
- Work dir: {CK_PROJECT_ROOT or CWD}
- Feature: {CK_FEATURE or "none"}
- Reports: {CK_REPORTS_PATH or "process/general-plans/reports/"}
- Plans: {CK_PLANS_PATH or "process/general-plans/active/"}
- Branch: {CK_GIT_BRANCH or current branch}
- Naming: {CK_NAME_PATTERN or "YYMMDD-HHMM"}
- Active plan: {CK_ACTIVE_PLAN or "none"}
- Commits: conventional (feat:, fix:, docs:, refactor:, test:, chore:)
- Refer to teammates by NAME, not agent ID
```

---

## ON `/vc:team research <topic>` [--researchers N]:

*Coordinates parallel `research-agent` teammates plus shared helper skills where useful.*

IMMEDIATELY execute in order:

1. **Derive N angles** from `<topic>` (default N=3):
   - Angle 1: Architecture, patterns, proven approaches
   - Angle 2: Alternatives, competing solutions, trade-offs
   - Angle 3: Risks, edge cases, failure modes, security
   - (If N>3, derive additional angles from topic context)

2. **CALL** `TeamCreate(team_name: "<topic-slug>")` after user approval to use agent teams

3. **CALL** `TaskCreate` x N -- one per angle:
   - Subject: `Research: <angle-title>`
   - Description: `Investigate <angle> for topic: <topic>. Save report to: {CK_REPORTS_PATH}/research-agent-{N}-{CK_NAME_PATTERN}-{topic-slug}.md. Format: Executive summary, key findings, evidence, contradictions, unresolved questions. Do not recommend implementations. Mark task completed when done. Send findings summary to lead.`

4. **SPAWN** teammates x N via `Agent` tool:
   - `subagent_type: "research-agent"`, `model: "opus"`
   - `run_in_background: true` (non-blocking -- spawn all N concurrently)
   - `name: "research-agent-{N}"`
   - Prompt: task description + CK Context Block

5. **MONITOR** via TaskCompleted hook events + TaskList fallback:
   - TaskCompleted events auto-notify when `research-agent` subagents finish
   - Fallback: Check TaskList if no event received in 60s
   - If stuck >5 min, message teammate directly

6. **READ** all `research-agent` reports from `{CK_REPORTS_PATH}/`

7. **SYNTHESIZE** into: `{CK_REPORTS_PATH}/research-summary-{CK_NAME_PATTERN}-{topic-slug}.md`
   Format: exec summary, key findings, comparative analysis, trade-off evidence, unresolved questions, decision inputs for the orchestrator.

8. **SHUTDOWN**: `SendMessage(type: "shutdown_request")` to each teammate

9. **CLEANUP**: `TeamDelete` (no parameters -- just call it)

10. **REPORT**: Tell user `Research complete. Summary: {path}. N reports generated.`
11. **FOLLOW-UP**: If durable process/context learnings surfaced, suggest `ENTER UPDATE PROCESS MODE`.

---

## ON `/vc:team execute <plan-path>` [--devs N]:

*Coordinates approved-plan execution with parallel `execute-agent` teammates, testing, review, and final reporting without introducing a separate execution owner.*

Do not use this template to flatten an entire multi-phase program into one execution wave. If the
selected work is really a phase program, the lead must first pick one current phase plan and execute
that phase only. See `process/development-protocols/phase-programs.md`.

IMMEDIATELY execute in order:

1. **PRE-FLIGHT APPROVAL CHECK**:
   - Require one explicit approved plan file path under `process/general-plans/active/` or `process/features/*/active/`
   - If the user supplied only a description or an unapproved draft, STOP and tell the user to create/select a plan first, then return with `ENTER EXECUTE MODE`
   - Do not use `vc:team execute` to bypass the repo's explicit execute approval gate
   - If the selected plan is an umbrella/orchestration plan for a large program, STOP and require
     one explicit current phase plan instead of executing the whole program at once

2. **READ** the selected plan and parse it into N independent task groups with file ownership boundaries

3. **CALL** `TeamCreate(team_name: "<feature-slug>")` after user approval to use agent teams

4. **CALL** `TaskCreate` x (N + 1) -- N dev tasks + 1 tester task:
   - Dev tasks: include `File ownership: <glob patterns>` -- NO overlap between devs
   - Tester task: `addBlockedBy` all dev task IDs
   - Each task description includes: implementation scope, file ownership, acceptance criteria

5. **SPAWN** developer teammates x N via `Agent` tool:
   - `subagent_type: "execute-agent"`, `model: "opus"`
   - `isolation: "worktree"` -- each dev gets isolated git worktree (no file conflicts)
   - `run_in_background: true`
   - `name: "dev-{N}"`
   - Prompt: task description + exact plan path + CK Context Block
   - If `--plan-approval`: require a short task-level implementation outline before coding, but do not reopen the top-level execute approval gate
   - REVIEW and APPROVE each developer's task outline via `plan_approval_response` before code changes

6. **MONITOR** dev completion via TaskCompleted events:
   - TaskCompleted hook notifies when each dev task finishes
   - When all N dev tasks show completed, spawn tester immediately
   - TeammateIdle events confirm devs are available for shutdown
   - Fallback: Check TaskList if no events received in 60s
   - Spawn tester: `Agent(subagent_type: "tester", model: "opus", name: "tester")`
   - Tester runs full test suite, reports pass/fail

7. **MERGE** worktree branches (if `isolation: "worktree"` was used):
   - Discover branches: check Agent result for branch names, or `git worktree list`
   - In `--delegate` mode, spawn a dedicated merge teammate for this step
   - Otherwise, for each dev branch: `git merge <dev-branch> --no-ff`
   - If conflict: resolve manually (lead owns shared files), then `git add . && git merge --continue`
   - Cleanup: `git worktree remove <path>` for each worktree
   - Verify: `git log --oneline --graph` to confirm merge topology

8. **DOCS SYNC EVAL**:
   ```
   Docs impact: [none|minor|major]
   Action: [no update needed -- <reason>] | [updated <page>] | [needs separate PR]
   ```

9. **SHUTDOWN** all teammates via `SendMessage(type: "shutdown_request")`
10. **CLEANUP**: `TeamDelete` (no parameters -- just call it)

11. **REPORT**: Tell user what was implemented, test results, docs impact, and any remaining concerns.
12. **FOLLOW-UP**: If durable process/context learnings surfaced, suggest `ENTER UPDATE PROCESS MODE`.

---

## ON `/vc:team review <scope>` [--reviewers N]:

*Coordinates parallel `code-reviewer` teammates using the absorbed review methodology now owned by the agent path.*

IMMEDIATELY execute in order:

1. **DERIVE** N review focuses from `<scope>` (default N=3):
   - Focus 1: Security -- vulnerabilities, auth, input validation, OWASP
   - Focus 2: Performance -- bottlenecks, memory, complexity, scaling
   - Focus 3: Test coverage -- gaps, edge cases, error paths
   - (If N>3, derive from scope: architecture, DX, accessibility, etc.)

2. **CALL** `TeamCreate(team_name: "review-<scope-slug>")` after user approval to use agent teams

3. **CALL** `TaskCreate` x N -- one per focus:
   - Subject: `Review: <focus-title>`
   - Description: `Review <scope> for <focus>. Output severity-rated findings only. Format: [CRITICAL|IMPORTANT|MODERATE] <finding> -- <evidence> -- <recommendation>. No "seems" or "probably" -- concrete evidence only. Save to: {CK_REPORTS_PATH}/reviewer-{N}-{CK_NAME_PATTERN}-{scope-slug}.md. Mark task completed when done.`

4. **SPAWN** reviewers x N via `Agent` tool:
   - `subagent_type: "code-reviewer"`, `model: "opus"`
   - `run_in_background: true`
   - `name: "reviewer-{N}"`
   - Prompt: task description + CK Context Block

5. **MONITOR** via TaskCompleted hook events + TaskList fallback:
   - TaskCompleted events auto-notify when reviewers finish
   - Fallback: Check TaskList if no event received in 60s

6. **SYNTHESIZE** into: `{CK_REPORTS_PATH}/review-{scope-slug}.md`
   - Deduplicate findings across reviewers
   - Prioritize by severity: CRITICAL > IMPORTANT > MODERATE
   - Create action items list with owners

7. **SHUTDOWN** all teammates via `SendMessage(type: "shutdown_request")`
8. **CLEANUP**: `TeamDelete` (no parameters -- just call it)

9. **REPORT**: Tell user `Review complete. {X} findings ({Y} critical). Report: {path}.`
10. **FOLLOW-UP**: If the review changes durable process/context guidance, suggest `ENTER UPDATE PROCESS MODE`.

---

## ON `/vc:team debug <issue>` [--debuggers N]:

*Coordinates parallel `debugger` teammates using the absorbed root-cause-first debug workflow now owned by the debugger path.*

IMMEDIATELY execute in order:

1. **GENERATE** N competing hypotheses from `<issue>` (default N=3):
   - Each hypothesis must be independently testable
   - Each must predict different observable symptoms
   - Frame as: "If <cause>, then we should see <evidence>"

2. **CALL** `TeamCreate(team_name: "debug-<issue-slug>")`

3. **CALL** `TaskCreate` x N -- one per hypothesis:
   - Subject: `Debug: Test hypothesis -- <theory>`
   - Description: `Investigate hypothesis: <theory>. For issue: <issue>. ADVERSARIAL: actively try to disprove other theories. Message other debuggers to challenge findings. Report evidence FOR and AGAINST your theory. Save findings to: {CK_REPORTS_PATH}/debugger-{N}-{CK_NAME_PATTERN}-{issue-slug}.md. Mark task completed when done.`

4. **SPAWN** debugger teammates x N via `Agent` tool:
   - `subagent_type: "debugger"`, `model: "opus"`
   - `run_in_background: true`
   - `name: "debugger-{N}"`
   - Prompt: task description + CK Context Block

5. **MONITOR** via TaskCompleted events. Debuggers should message each other -- let them converge.
   - TaskCompleted events notify as each hypothesis is tested
   - TeammateIdle events indicate debugger awaiting peer input
   - Fallback: Check TaskList if no events in 60s

6. **READ** all debugger reports. Identify surviving theory as root cause.

7. **WRITE** root cause report: `{CK_REPORTS_PATH}/debug-{issue-slug}.md`
   Format: Root cause, evidence chain, disproven hypotheses, recommended fix.

8. **SHUTDOWN** all teammates via `SendMessage(type: "shutdown_request")`
9. **CLEANUP**: `TeamDelete` (no parameters -- just call it)

10. **REPORT**: Tell user `Debug complete. Root cause: <summary>. Report: {path}.`
11. **FOLLOW-UP**: If the debug session produced durable process/context learnings, suggest `ENTER UPDATE PROCESS MODE`.

---

## When to Use Agent Teams vs Subagents

| Scenario | Subagents (Agent tool) | Agent Teams |
|----------|----------------------|-------------|
| Focused task (test, lint, single review) | **Yes** | Overkill |
| Sequential chain (plan -> code -> test) | **Yes** | No |
| 3+ independent parallel workstreams | Maybe | **Yes** |
| Competing debug hypotheses | No | **Yes** |
| Cross-layer work (FE + BE + tests) | Maybe | **Yes** |
| Workers need to discuss/challenge findings | No | **Yes** |
| Token budget is tight | **Yes** | No (high cost) |

## Token Budget

| Template | Estimated Tokens | Notes |
|----------|-----------------|-------|
| Research (3) | ~150K-300K | Read-only, moderate cost |
| Execute (4) | ~400K-800K | Highest cost -- code generation |
| Review (3) | ~100K-200K | Read-only, moderate cost |
| Debug (3) | ~200K-400K | Mixed read/execute |

## Agent Memory

Teammates with `memory: project` in their agent definition retain learnings across team sessions. Memory persists in `.claude/agent-memory/<name>/` (gitignored). Useful for:
- Code reviewer remembering project conventions
- Debugger recalling past failure patterns
- Tester tracking flaky tests and coverage gaps
- Researcher accumulating domain knowledge

Memory persists after team cleanup -- it's in `.claude/agent-memory/`, not `~/.claude/teams/`.

## Worktree Isolation (Execute Template)

For implementation teams, `isolation: "worktree"` on the Agent tool gives each dev:
- **Own git worktree** -- isolated working directory, staging area, HEAD
- **Own branch** -- auto-created, returned in agent result
- **No file conflicts** -- devs can edit same files independently
- **Safe parallel editing** -- `.git` dir shared, everything else isolated

After all devs complete, lead merges branches sequentially. This is the safest pattern for parallel code changes.

## Error Recovery

1. **Check status**: `Shift+Up/Down` (in-process) or click pane (split)
2. **Redirect**: Send direct message with corrective instructions
3. **Replace**: Shut down failed teammate, spawn replacement for same task
4. **Reassign**: `TaskUpdate` stuck task to unblock dependents

## Abort Team

```
Shut down all teammates. Then call TeamDelete (no parameters).
```

If unresponsive: close terminal or kill session. Clean orphaned configs at `~/.claude/teams/` manually.

## Display Modes

- **auto** (default): split panes if in tmux, otherwise in-process
- **in-process**: all in one terminal. `Shift+Up/Down` navigate. `Ctrl+T` task list.
- **tmux/split**: each teammate own pane. Requires tmux or iTerm2.

## Rules Reference

See `process/development-protocols/orchestration.md` for teammate coordination, status handling, and context-isolation rules.

> v3.0.0: Agent tool migration, worktree isolation for execute devs, run_in_background spawning, updated model requirements.
