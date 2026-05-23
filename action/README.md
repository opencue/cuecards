# cue-ci GitHub Action

Validate `.cue-profile` and `profile.yaml` on PRs. Reports token budget, efficiency score, and blocks merges that exceed a cost threshold.

## Usage

```yaml
# .github/workflows/cue-ci.yml
name: cue-ci
on: [pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: recodeee/cue/action@main
        with:
          token-threshold: '30000'  # fail if profile exceeds 30k tokens
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `token-threshold` | Max tokens allowed (fails if exceeded) | `50000` |
| `profile` | Profile to validate (reads `.cue-profile` if not set) | — |
| `comment` | Post a PR comment with the report | `true` |

## Outputs

| Output | Description |
|--------|-------------|
| `score` | Efficiency score (0-100) |
| `grade` | Letter grade (A+ to F) |
| `tokens` | Total token budget |
| `passed` | Whether threshold check passed |

## PR Comment

The action posts (and updates) a comment on the PR:

> ## ✅ cue-ci: Profile Validation
>
> | Metric | Value |
> |--------|-------|
> | Profile | `backend` |
> | Score | **B** (79/100) |
> | Token Budget | 26,769 |
> | Threshold | 30,000 |
> | Status | Passed ✅ |

## Team governance

Use `cue-ci` to enforce token budgets across your team:

```yaml
- uses: recodeee/cue/action@main
  with:
    token-threshold: '20000'  # strict: lean profiles only
    comment: 'true'
```

PRs that add heavy skills or switch to expensive profiles will be blocked until the budget is reduced.
