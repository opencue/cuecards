# Challenge Framework

Use these prompts to stress-test an adaptation decision before it becomes implementation work.

`xia` uses this framework to challenge assumptions, not to authorize planning or coding.

## Universal Challenges

1. Necessity: do we need this feature, or only the idea behind it?
2. Simpler alternative: can the local codebase get most of the value with less complexity?
3. Existing overlap: do we already have part of this behavior?
4. Maintenance burden: who owns the imported behavior after adaptation?
5. Dependency chain: what new dependencies, services, runtime behavior, or operational costs would this introduce?

## Flowser-Specific Challenges

| Question | Red Flag | Green Flag |
| --- | --- | --- |
| Architecture match? | Different paradigm, lifecycle, or state model | Same or very similar patterns |
| Coupling? | Spans many unrelated modules | Mostly self-contained |
| New patterns? | Requires a new ORM, state system, auth stack, or workflow owner | Reuses local patterns |
| Blast radius? | Touches auth, billing, or core data flows without clear boundaries | Failure is isolated |
| Runtime model? | Source assumptions conflict with local tenancy, container, or provider boundaries | Operationally compatible |
| Ownership drift? | Makes `xia` look like a planner or executor | Keeps `xia` as a helper-only research surface |

## Decision Matrix Template

```markdown
| # | Decision | Source's Way | Local Way | Hybrid Option | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Auth | source auth stack | existing local auth | wrapper | low | local |
| 2 | Persistence | 5 source tables | current schema | partial reuse | medium | hybrid |
```

## Risk Scoring

| Critical Count | Risk | Action |
| --- | --- | --- |
| 0-2 | Low | Proceed with adaptation-prep |
| 3-4 | Medium | Resolve the critical assumptions first |
| 5+ | High | Start with `--compare` or stop |

Treat a risk as critical when being wrong could cause data loss, a security issue, workflow ownership drift, or more than two days of rework.
