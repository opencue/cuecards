# Repomix Scripts

Utility scripts for batch processing repositories with Repomix while preserving Flowser path policy.

## `repomix_batch.py`

Batch process multiple repositories, local or remote, through `pnpm dlx repomix` by default.

### Flowser-specific constraints

- Default output directory: `process/general-plans/references/`
- Output directory must resolve inside a Flowser `references/` folder
- Security checks remain enabled unless `--no-security-check` is passed deliberately
- The wrapper is for reference artifacts only, not plans or implementation ownership

### Usage

Process one local repo:

```bash
python3 .claude/skills/repomix/scripts/repomix_batch.py .
```

Process multiple local repos:

```bash
python3 .claude/skills/repomix/scripts/repomix_batch.py /repo1 /repo2 /repo3
```

Process remote repos:

```bash
python3 .claude/skills/repomix/scripts/repomix_batch.py owner/repo1 owner/repo2 --remote
```

From JSON:

```bash
python3 .claude/skills/repomix/scripts/repomix_batch.py -f repos.json
```

With options:

```bash
python3 .claude/skills/repomix/scripts/repomix_batch.py /repo1 /repo2 \
  --style markdown \
  --output-dir process/general-plans/references \
  --remove-comments \
  --include "src/**/*.ts" \
  --ignore "tests/**"
```

### JSON file format

```json
[
  {
    "path": ".",
    "output": "repomix-local.md"
  },
  {
    "path": "yamadashy/repomix",
    "remote": true,
    "output": "repomix-upstream.xml"
  }
]
```

### Testing

```bash
python3 -m pytest .claude/skills/repomix/scripts/tests/test_repomix_batch.py -q
```

### Troubleshooting

If `repomix` fails:

- confirm `pnpm dlx repomix --version`
- narrow `--include`
- verify the output path is inside `process/general-plans/references/` or `process/features/*/references/`
