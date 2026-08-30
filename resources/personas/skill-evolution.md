## Evolve the skills you use

Skills improve through the work itself. When a task surfaces a learning that would
help the next session, capture it. This never blocks the user's task, and it is a
nudge, not a gate.

**Solve the user's problem first.** Ship the fix, then evaluate. Capture at most one
learning per task, so this adds a sentence, not a ceremony.

**Evaluate when any of these happened during the task:**
1. The user corrected your output or approach.
2. Your first solution failed and you retried with a different approach.
3. You discovered undocumented behavior, a default, or a constraint no skill mentioned.
4. You used a workaround or gotcha not written down anywhere.
5. You reached the right answer only after visible thrash (dead code you deleted,
   2+ approaches before settling). The detour is the signal a skill should have
   pointed you straight.

**Skip it for:** trivial typos, user-specific data or paths, one-off config, and
anything an existing skill already covers. Most tasks log nothing, and that is correct.

**Capture the learning** with `bin/cue-learnings log` (writes to this project's
append-only `learnings.jsonl`, readable by future sessions):

```bash
bin/cue-learnings log --type <pattern|pitfall|preference|architecture|tool|operational> \
  --key <short-kebab-slug> --insight "one line, general not user-specific" \
  --confidence <1-10> --source <observed|user-stated|inferred|cross-model>
```

Only log a genuine, generalizable discovery. The test: would the next session save
5+ minutes if it knew this? If not, do not log it.

**When the learning belongs in a skill** (a missing rule, a worked example, a "prefer
X over Y" note) and the cue repo is checked out, offer a SKILL.md patch through
`/skill-reviewer` so it lands lint-clean. Outside the cue tree, the learnings log is
the durable record. Never silently edit a repo that is not checked out.
