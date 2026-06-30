# Contributing to cue

Thanks for your interest in contributing! cue is an open-source CLI that manages agent profiles for Claude Code and Codex.

## Quick Start

```bash
# Clone with submodules — the skill library and MCP configs live in git submodules
git clone --recurse-submodules https://github.com/opencue/cuecards.git ~/Documents/cue
cd ~/Documents/cue
# Already cloned without --recurse-submodules? Pull them in:
git submodule update --init --recursive

# Install deps (requires bun >= 1.0)
bun install

# Run tests
bun test

# Run cue locally
bun src/index.ts status
bun src/index.ts list
```

## Prerequisites

- **Bun** >= 1.0 — [bun.sh](https://bun.sh)
- **Git** — for cloning and version control
- **Node.js** >= 20 (optional, for npm-based MCPs)

## Project Structure

```
cue/
├── src/                    # CLI source (TypeScript, runs via Bun)
│   ├── index.ts            # Entry point + arg routing
│   ├── commands/           # One file per subcommand
│   └── lib/                # Shared libraries (resolver, materializer, etc.)
├── profiles/               # Profile definitions (YAML)
├── resources/
│   ├── skills/             # Skill library — git submodule (SKILL.md per skill)
│   ├── mcps/               # MCP server configs — git submodule
│   └── icons/              # Brand icons for TUI (64x64 PNG)
├── plugins/cue/            # Claude Code plugin (/cue slash commands)
├── bin/cue                 # Shell launcher (resolves bun + runs src/index.ts)
├── install.sh              # Interactive installer
├── get.sh                  # One-line curl installer
└── docs/                   # Architecture docs
```

## Development Workflow

### Running locally

```bash
# Run any cue command directly
bun src/index.ts <command> [args...]

# Examples
bun src/index.ts status
bun src/index.ts list
bun src/index.ts validate --all
bun src/index.ts doctor
```

### Testing

```bash
# Run all tests
bun test

# Run a specific test file
bun test src/lib/kitty-image.test.ts

# Run tests matching a pattern
bun test --filter "loadProfile"
```

Tests live alongside their source files (`foo.ts` → `foo.test.ts`). We use Bun's built-in test runner.

Some suites read the `resources/skills` / `resources/mcps` submodules (skill resolution, the CLI/MCP catalogs, launch e2e). They **skip automatically** when those submodules aren't checked out, so a fresh clone stays green — run `git submodule update --init --recursive` to enable full coverage.

### Adding a new command

1. Create `src/commands/my-command.ts` exporting `run(args: string[]): Promise<number>`
2. Register it in `src/commands/_index.ts`
3. Add tests in `src/commands/my-command.test.ts`

### Adding a skill

1. Create `resources/skills/skills/<category>/<slug>/SKILL.md`
2. Use frontmatter for metadata:
   ```yaml
   ---
   description: "When user asks X, do Y"
   requires_mcps: []
   allowed-tools: []
   ---
   ```
3. Add reference files alongside SKILL.md if needed
4. The skill is auto-discovered by the resolver

### Adding a brand icon

```bash
# Add entry to resources/icons/generate-icons.py BRANDS dict, then:
uv run --with Pillow --with cairosvg python3 resources/icons/generate-icons.py <name>
```

Icons are 64x64 RGBA PNGs rendered from Simple Icons SVGs.

## Code Style

- TypeScript, ESM modules (`import`/`export`)
- No semicolons in the codebase? Check existing files and match
- Prefer `node:fs/promises` for async, `node:fs` sync only in hot paths
- Error classes for typed failures (see `resolver-npx.ts` for examples)
- Lazy imports in commands to keep cold start fast

## Pull Request Guidelines

1. **One concern per PR** — don't mix features with refactors
2. **Tests required** for new commands and library functions
3. **Run `bun test`** before submitting — the full suite must pass (1,300+ tests)
4. **Keep the README updated** if you add user-facing features
5. **Profile changes** — if you modify `profiles/`, run `cue validate --all`

## Architecture Notes

### Launch hot path

```
claude (shim) → cue launch claude
  → resolveProfileForCwd()     # .cue.profile lookup
  → loadProfile()              # YAML parse + inheritance
  → materializeRuntime()       # hash check → symlink skills + write settings
  → exec(real claude binary)   # hand off to the real agent
```

The materializer uses content-addressed hashing — if the profile hasn't changed, launch is a stat + sha256 compare (< 5ms overhead).

### Profile resolution order

1. `--cue-profile X` flag (explicit)
2. `.cue.profile` file in cwd (walk up to $HOME)
3. Repo-level default (`.cue.profile` at git root)
4. Global default (`~/.config/cue/default-profile`)
5. TUI picker (interactive fallback)

### Key modules

| Module | Purpose |
|--------|---------|
| `cwd-resolver.ts` | Find which profile applies to the current directory |
| `profile-loader.ts` | Parse YAML, resolve inheritance chains |
| `runtime-materializer.ts` | Build isolated config dirs with symlinked skills |
| `resolver-local.ts` | Find skills on disk by slug |
| `resolver-npx.ts` | Fetch + cache skills from GitHub repos |
| `brand-icons.ts` | Map skills/MCPs to terminal icons |
| `manifest-cache.ts` | Cache resolved profiles for fast repeat launches |

## Reporting Issues

- Include `cue --version` and `bun --version`
- Include `cue doctor` output if relevant
- For launch issues, include `cue launch claude --dry-run` output

## License

MIT — see [LICENSE](./LICENSE).
