# Configuration Reference

Detailed configuration options for Repomix, adapted for Flowser path and safety rules.

## Configuration File

Repomix supports a `repomix.config.json` file in the target repository root.

Flowser guidance:

- prefer CLI flags for one-off research packs
- use config files only when the same scope will be packed repeatedly
- still route final outputs to a Flowser `references/` destination

Example:

```json
{
  "output": {
    "filePath": "process/general-plans/references/repomix-example.xml",
    "style": "xml",
    "removeComments": false,
    "showLineNumbers": true,
    "copyToClipboard": false
  },
  "include": ["packages/api/src/**", "packages/validators/src/**", "*.md"],
  "ignore": {
    "useGitignore": true,
    "useDefaultPatterns": true,
    "customPatterns": ["**/*.test.ts", "coverage/**", "dist/**"]
  },
  "security": {
    "enableSecurityCheck": true
  }
}
```

### Output Options

- `filePath`: Output file path. In Flowser, point it to a `references/` folder.
- `style`: Format. `xml`, `markdown`, `json`, or `plain`.
- `removeComments`: Strip comments for smaller output.
- `showLineNumbers`: Keep line numbers for traceability.
- `copyToClipboard`: Available upstream, but not the default Flowser workflow.

### Include And Ignore

- `include`: Glob patterns for files to include.
- `useGitignore`: Respect `.gitignore`.
- `useDefaultPatterns`: Use Repomix default ignore patterns.
- `customPatterns`: Additional ignore patterns in `.gitignore` style.

### Security

- `enableSecurityCheck`: Scan for sensitive data with Secretlint.
- Keep this enabled unless you have a documented false positive.

## Glob Patterns

Common wildcard rules:

- `*` matches any characters except `/`
- `**` matches across directories
- `?` matches one character
- `[abc]` matches a character set
- `{js,ts}` matches either extension

Examples:

- `**/*.ts`
- `src/**`
- `**/*.{js,jsx,ts,tsx}`
- `!**/*.test.ts`

## CLI Options

```bash
pnpm dlx repomix . --include "src/**/*.ts,*.md"
pnpm dlx repomix . -i "tests/**,*.test.js"
pnpm dlx repomix . --no-gitignore
pnpm dlx repomix . --no-default-patterns
```

## `.repomixignore`

Create `.repomixignore` in the target repository if you need repo-local packing rules that should not live in every command.

Example:

```text
# Build artifacts
dist/
build/
out/

# Tests and coverage
**/*.test.ts
**/*.spec.ts
coverage/
__tests__/

# Dependencies
node_modules/
vendor/
packages/*/node_modules/

# Large binary assets
*.mp4
*.zip
*.tar.gz

# Sensitive files
.env*
secrets/
*.key
*.pem

# Logs
logs/
**/*.log
```

## Pattern Precedence

Higher priority wins:

1. CLI ignore patterns such as `-i`
2. `.repomixignore`
3. Custom patterns in config
4. `.gitignore` when enabled
5. Repomix default patterns when enabled

## Pattern Examples

### TypeScript

```json
{
  "include": ["**/*.ts", "**/*.tsx"],
  "ignore": {
    "customPatterns": ["**/*.test.ts", "dist/"]
  }
}
```

### React

```json
{
  "include": ["src/**/*.{js,jsx,ts,tsx}", "*.md"],
  "ignore": {
    "customPatterns": ["build/"]
  }
}
```

### Monorepo

```json
{
  "include": ["packages/*/src/**", "apps/*/src/**"],
  "ignore": {
    "customPatterns": ["packages/*/dist/", "apps/*/.next/"]
  }
}
```

## Output Formats

### XML

```bash
pnpm dlx repomix . --style xml
```

Best for structured AI analysis and programmatic parsing.

### Markdown

```bash
pnpm dlx repomix . --style markdown
```

Best for human review, docs, and diff-friendly inspection.

### JSON

```bash
pnpm dlx repomix . --style json
```

Best for custom tooling or downstream parsing.

### Plain Text

```bash
pnpm dlx repomix . --style plain
```

Best when minimal formatting matters more than structure.

## Advanced Options

```bash
pnpm dlx repomix . --verbose
pnpm dlx repomix . -c /path/to/custom-config.json
pnpm dlx repomix . --init
pnpm dlx repomix . --no-line-numbers
```

## Token Management

Current Repomix releases are substantially faster than older builds, but Flowser still treats token count as a review gate rather than a success signal.

Use `--token-count-tree` to understand where size is coming from:

```bash
pnpm dlx repomix . --token-count-tree
pnpm dlx repomix . --token-count-tree 1000
```

Use this to:

- identify token-heavy paths
- refine `--include` and `--ignore`
- choose between a whole-package pack and a narrower module pack
- decide when `--remove-comments` or `--no-line-numbers` is worth the tradeoff

## Performance

For large repositories:

```bash
pnpm dlx repomix . \
  --include "packages/api/src/**" \
  -i "node_modules/**,dist/**,vendor/**" \
  --remove-comments \
  --no-line-numbers
```

Start with the smallest slice that answers the actual question.
