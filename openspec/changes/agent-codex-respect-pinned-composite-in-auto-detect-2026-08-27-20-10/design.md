## Context

Profile-choice history is intentionally allowed to correct weak detection, but
the current pin is a stronger and more recent repository-level decision than
historical counts. The ranker currently has no way to distinguish those two
sources, and its support gate can discard explicitly pinned deployment parts.

## Decision

Augment repository-scoped feedback with the nearest `.cue.profile` selector.
Mark that usage entry as pinned, give it a fixed score above the maximum history
score, and exempt only pinned entries from repository-support filtering. The
known-profile validation remains mandatory.

## Alternatives Rejected

- Hard-code `hostinger` and `coolify` as Medusa companions: not every Medusa
  shop uses those providers.
- Change only the `auto-detect` command: other suggestion surfaces would still
  disagree with the repository pin.
- Ignore the current pin and tune history weights: historical partial choices
  could still suppress an explicitly configured composite.

## Verification

- Focused unit test for pinned-vs-history ranking and support-gate behavior.
- Existing profile-choice feedback test file.
- Typecheck and an end-to-end `cue auto-detect` check in the pinned repository.
