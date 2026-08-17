# PR Review: #128 — lint: stop --fix from destroying inline code and allowed-tools lists

**Reviewed**: 2026-08-07
**Author**: NagyVikt
**Branch**: fix/skill-linter-fixer-data-loss → main
**Decision**: APPROVE (after two defects found here were fixed in f73481d4)

> **Reviewer independence caveat.** This is a self-review: the same session
> authored the PR. Shared blind spots are not excluded. Both findings below
> were confirmed by running code, not by reading it, which is the part of the
> review that does not depend on the reviewer's priors.

## Summary

Repairs two content-destroying defects in `cue lint-skill --fix`, both
confirmed against the 453-skill corpus. The first review pass of this PR found
two further defects in its own change; both are fixed and covered by tests.

## Findings

### CRITICAL
None.

### HIGH

**H1 — space-separated bare names regressed** (`src/lib/skill-linter.ts`, `readAllowedTools`) — FIXED in f73481d4

The original split on `/[,\s]+/`. The new `readAllowedTools` split on commas
only, so a space-separated value collapsed into one bogus entry:

```
allowed-tools: nmap curl   ->   Bash(nmap curl:*)      # regressed
                           ->   Bash(nmap:*), Bash(curl:*)   # expected
```

Verified by executing `applyFixes` on both shapes. Fixed with `splitToolNames`,
which restores the old behaviour but keeps a part containing `(` whole so
`Bash(git diff:*)` is not torn in half — a case the original only survived by
early-returning on any wrapped value, which also meant it fixed nothing in a
mixed list. Corpus impact: none — zero skills carry a bare multi-word value.

### MEDIUM

**M1 — `fixedNames` computed and never read** (`src/lib/skill-linter.ts`) — FIXED in f73481d4

The `fix` closure recomputes the same map from a fresh parse, so the outer
binding was dead. `bun run lint` flags it ("This variable fixedNames is
unused"); CI passed only because unused variables are a warning, not an error.
Removed. The wrap predicate had been written out three times, which is how the
dead copy went unnoticed; it is now `isWellFormedTool` + `wrapTool`.

### LOW

**L1 — `readAllowedTools` stops at the first non-item line.** A comment
interleaved in a block sequence would truncate the parse. No occurrence in the
corpus; noting it rather than speculatively handling it.

## Validation Results

| Check | Result |
|---|---|
| Type check (`bun run typecheck`) | Pass |
| Lint (`bun run lint`) | Pass, and the warning this PR had added is gone |
| Tests (`bun test`) | Pass — 3091 pass / 1 skip / 0 fail |
| Unit (`skill-linter.test.ts`) | Pass — 94 tests |
| CI on GitHub | test, lint, Profiles e2e ×2, configured — all pass |

## Behavioural verification (beyond the test suite)

| Property | Result |
|---|---|
| inline code spans lost over 453 skills | 0 (was 723 across 178 files) |
| `allowed-tools` list → scalar degradations | 0 |
| frontmatter unparseable / `name:` / `description:` / fences altered | 0 / 0 / 0 / 0 |
| new `Bash(Bash:*)` introduced | 0 (47 pre-existing, unchanged) |
| reproduces opencue/skills#21 on its own base | byte-identical |

## Files Reviewed

- `src/lib/skill-linter.ts` — Modified
- `src/lib/skill-linter.test.ts` — Modified
