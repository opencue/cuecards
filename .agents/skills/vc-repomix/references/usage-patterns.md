# Usage Patterns

Practical Repomix workflows adapted to Flowser's references-only artifact rules.

## AI Analysis Workflows

### Full repository slice

```bash
pnpm dlx repomix . \
  --include "apps/flowser/src/**,packages/api/src/**,packages/validators/src/**,*.md" \
  --remove-comments \
  --style markdown \
  -o process/general-plans/references/repomix-full-repo-slice-27-05-26.md
```

Use for new codebase orientation, architecture review, or broad context sharing.

Tips:

- remove comments for large repos
- check token limits before handing the artifact to another model
- prefer a slice over the entire monorepo unless the whole repo is truly needed

### Focused module analysis

```bash
pnpm dlx repomix . \
  --include "packages/api/src/router/**,packages/api/src/routes/**" \
  --style xml \
  -o process/general-plans/references/repomix-api-surface-27-05-26.xml
```

Use for feature analysis, bug investigation, or targeted refactoring prep.

### Incremental comparison

```bash
git checkout feature-branch
pnpm dlx repomix . --include "packages/api/src/**" -o process/general-plans/references/repomix-feature-branch-api-27-05-26.xml

git checkout main
pnpm dlx repomix . --include "packages/api/src/**" -o process/general-plans/references/repomix-main-api-27-05-26.xml
```

Use for before-and-after comparisons or migration planning.

### Cross-repository comparison

```bash
pnpm dlx repomix --remote org/repo1 -o process/general-plans/references/repomix-org-repo1-27-05-26.xml
pnpm dlx repomix --remote org/repo2 -o process/general-plans/references/repomix-org-repo2-27-05-26.xml
```

Use for library comparison, upstream parity review, or adapter design.

## Security Audit

### Third-party library audit

```bash
pnpm dlx repomix \
  --remote vendor/library \
  --include "src/**,package.json,README.md" \
  --style xml \
  -o process/general-plans/references/repomix-vendor-library-audit-27-05-26.xml
```

Workflow:

1. Pack the library.
2. Review the security warnings.
3. Check for credentials, suspicious network behavior, or obfuscation.
4. Use the artifact as read-only analysis input.

### Pre-deployment review

```bash
pnpm dlx repomix . \
  --include "packages/api/src/**,packages/db/**,apps/flowser/src/**" \
  --style xml \
  -o process/general-plans/references/repomix-predeploy-review-27-05-26.xml
```

Checklist:

- no sensitive data
- no test credentials
- config surface looks intentional
- no obvious debug leftovers

### Dependency-focused review

```bash
pnpm dlx repomix . \
  --include "**/package.json,pnpm-lock.yaml" \
  --style markdown \
  -o process/general-plans/references/repomix-deps-27-05-26.md
```

Use when comparing dependency surfaces or preparing a license/security review.

## Documentation

### Documentation context pack

```bash
pnpm dlx repomix . \
  --include "process/context/**/*.md,packages/api/src/**/*.ts,packages/validators/src/**/*.ts,README.md" \
  --style markdown \
  -o process/general-plans/references/repomix-doc-context-27-05-26.md
```

Use for API docs, architecture docs, onboarding, or internal documentation refreshes.

### Architecture pack

```bash
pnpm dlx repomix . \
  --include "packages/*/src/**/*.ts,apps/flowser/src/**/*.tsx,*.md" \
  -i "**/*.test.ts,**/*.spec.ts,coverage/**" \
  --style markdown \
  -o process/general-plans/references/repomix-architecture-27-05-26.md
```

Focus on module structure, dependencies, and data flow rather than exhaustive coverage.

## Library Evaluation

### Quick assessment

```bash
pnpm dlx repomix \
  --remote owner/library \
  --style markdown \
  -o process/general-plans/references/repomix-library-eval-27-05-26.md
```

Evaluate:

- code quality
- architecture
- dependency shape
- docs and tests
- maintenance signals

### Integration feasibility

```bash
pnpm dlx repomix \
  --remote vendor/library \
  --include "src/**,*.md" \
  -o process/general-plans/references/repomix-vendor-library-27-05-26.xml

pnpm dlx repomix . \
  --include "packages/**/src/integrations/**,packages/api/src/**" \
  -o process/general-plans/references/repomix-local-integrations-27-05-26.xml
```

Use the pair to inspect compatibility between the target library and local integration points.

## Workflow Integration

### Batch processing

```bash
python3 .claude/skills/repomix/scripts/repomix_batch.py \
  . \
  yamadashy/repomix \
  --style markdown \
  --output-dir process/general-plans/references \
  --remove-comments \
  --remote
```

Use the JSON config mode if you want mixed local and remote repositories with custom filenames.

### Git hooks and CI

Repomix can be useful in release or audit workflows, but Flowser does not treat it as a default workflow-owner tool. If you automate it:

- keep outputs under a `references/` folder
- keep security checks enabled
- avoid broad always-on packs that produce noisy artifacts

## Language-Specific Patterns

### TypeScript

```bash
pnpm dlx repomix . \
  --include "**/*.ts,**/*.tsx" \
  --remove-comments \
  --no-line-numbers
```

Typical exclusions:

- `**/*.test.ts`
- `dist/`
- `coverage/`

### React

```bash
pnpm dlx repomix . \
  --include "apps/flowser/src/**/*.{js,jsx,ts,tsx},packages/ui/src/**/*.{ts,tsx}" \
  -i "build/,*.test.*,coverage/**"
```

### Node and Bun backend

```bash
pnpm dlx repomix . \
  --include "packages/api/src/**/*.ts,packages/db/**/*.ts" \
  -i "node_modules/,logs/,tmp/"
```

### Monorepo

```bash
pnpm dlx repomix . \
  --include "packages/*/src/**,apps/*/src/**" \
  -i "packages/*/node_modules/,packages/*/dist/,apps/*/.next/"
```

Use package-scoped packs when only one workspace matters.

## Troubleshooting

### Output too large

```bash
pnpm dlx repomix . \
  -i "node_modules/**,dist/**,coverage/**" \
  --include "src/core/**" \
  --remove-comments \
  --no-line-numbers
```

### Missing files

```bash
cat .gitignore .repomixignore
pnpm dlx repomix . --no-gitignore --no-default-patterns --verbose
```

### Sensitive data warnings

Review the flagged files first. If the warning is a false positive, note that explicitly before using `--no-security-check`.

### Remote access failures

```bash
pnpm dlx repomix --remote https://github.com/owner/repo
pnpm dlx repomix --remote https://github.com/owner/repo/commit/abc123
```

For private repos, clone locally and pack the local checkout instead.
