# cue SKILL.md Linter, GitHub Action

Lint every `SKILL.md` in your repo against the [Claude Code skill spec](https://github.com/opencue/claude-code-skills/blob/main/src/lib/skill-linter.ts#L1) on every push or pull request. Catches frontmatter spec violations, missing `Prerequisites`, malformed `allowed-tools`, missing trigger phrases, broken anchor links, voice-rule violations, large extractable shell blocks, missing examples, possible duplicate skills, and stale descriptions.

**Why:** Anthropic's skill discovery is unforgiving. Missing fields and malformed syntax cause your skill to silently fail in some contexts. This action runs locally on your repo with zero side effects.

## Quick start

Add `.github/workflows/lint-skill-md.yml` to your repo:

```yaml
name: Lint SKILL.md
on:
  pull_request:
    paths:
      - '**/SKILL.md'
      - '.github/workflows/lint-skill-md.yml'
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write  # only needed if comment-pr: true
    steps:
      - uses: actions/checkout@v4
      - uses: opencue/claude-code-skills/skill-md-lint-action@main
```

That's it. On every PR you'll get a comment with the lint report; on push to main the action will fail if any error-level issues are found.

## Options

| Input | Default | Description |
|---|---|---|
| `path` | `.` | What to lint. Single file or directory (recursive scan for SKILL.md). |
| `fix` | `false` | Auto-fix issues and commit back to the branch (PR only). |
| `fail-on` | `error` | Lowest severity to fail on: `error`, `warning`, or `info`. |
| `comment-pr` | `true` | Post the report as a PR comment. |
| `check-overlap` | `false` | Enable R012 cross-skill overlap detection across every SKILL.md under `path`. |
| `baseline` | _(unset)_ | Path to a baseline JSON file (from `cue lint-skill --baseline-write`). Issues listed there are suppressed. |

## Example: auto-fix on PR

```yaml
- uses: opencue/claude-code-skills/skill-md-lint-action@main
  with:
    fix: true              # apply fixes
    comment-pr: true       # also comment with anything that needed flagging
    fail-on: error         # only fail CI on real spec errors
```

## What it checks

| Rule | Severity | Auto-fix |
|---|---|---|
| R001 missing `name:` | error | yes, derives from first H1 |
| R002 missing `description:` | error | no, needs author judgment |
| R003 description >200 chars | warning | no |
| R004 description lacks trigger phrase or `triggers:` | warning | no |
| R005 malformed `allowed-tools` | error | yes, wraps in `Bash(name:*)` |
| R006 missing `Prerequisites` | warning | yes, adds section with real install commands |
| R007 missing `tags:`/`domain:` | info | no |
| R008 broken in-doc anchor links | warning | no |
| R009 voice-rule violation (em dash, AI vocab, banned phrases) | warning | yes for em dashes; vocab needs judgment |
| R010 large shell block | info | no, extraction to `scripts/` needs design |
| R011 missing example block | info | no |
| R012 possible duplicate skill (needs `check-overlap: true`) | warning | no |
| R013 description/body word-overlap mismatch | info | no |
| R015 security: dangerous markdown (`javascript:`/raw `<script>`) in prose, or invisible/bidi characters | error | yes for invisible chars (removed); dangerous URLs/HTML need judgment |

## Outputs

| Output | Type | Description |
|---|---|---|
| `diagnostics-json` | JSON | Full diagnostics array, per file scanned. |
| `error-count` | number | Number of error-severity diagnostics found. |

## Use locally instead

If you'd rather not run this in CI, install cue and run the linter directly:

```bash
git clone --depth 1 https://github.com/opencue/claude-code-skills ~/cue
cd ~/cue && bun install
bun ~/cue/src/index.ts lint-skill /path/to/your/skill
```

## License

MIT — same as [opencue/claude-code-skills](https://github.com/opencue/claude-code-skills).
