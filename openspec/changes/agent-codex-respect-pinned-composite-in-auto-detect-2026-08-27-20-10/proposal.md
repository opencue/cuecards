## Why

- `cue auto-detect` can rank an older, repeatedly chosen partial stack above
  the repository's current `.cue.profile`. This makes a repo pinned to a full
  deployment stack appear to have lost companions such as `hostinger` and
  `coolify`.

## What Changes

- Treat the repository's explicit `.cue.profile` selector as authoritative
  repository-scoped feedback.
- Rank the pinned selector above historical choices and allow its known profile
  parts through repository-evidence support filtering.
- Add focused regression coverage for a pinned composite competing with an
  older, frequently selected partial stack.

## Impact

- Affects profile suggestion ordering wherever repository-scoped choice
  feedback is applied.
- Unknown profile names remain rejected by the existing known-profile guard.
- No profile files are rewritten unless the existing caller explicitly applies
  a suggestion.
