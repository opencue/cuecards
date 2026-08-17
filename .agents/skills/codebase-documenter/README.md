# codebase-documenter

A AI agent SKILL that generates developer-facing documentation for any codebase. It reads the actual code — not the README — and produces a single `docs/CODEBASE.md` with architecture diagrams, component descriptions, data flow, setup instructions, and an onboarding path for new developers.

## Why

Repository documentation goes stale. READMEs describe what the project *was*, not what it *is*. Setup instructions break, architecture diagrams drift, and version numbers lag behind. This skill derives everything from the code itself — imports, entry points, dependency files, build configs, and git history — so the output reflects reality.

## What it produces

A single markdown file (`docs/CODEBASE.md`) with eight sections:

| Section | What it covers |
|---------|---------------|
| **Project Overview** | Purpose, type, language, frameworks, status |
| **Architecture Overview** | High-level design, Mermaid diagram, patterns, key decisions |
| **Project Structure** | Annotated directory tree with entry points |
| **Key Components** | Major modules with file and function references, interaction diagrams |
| **Data Flow** | How data moves through the system, with flowcharts |
| **External Integrations** | Services, auth methods, configuration |
| **Development Guide** | Verified setup commands, testing, local config |
| **Critical Paths & Gotchas** | Sensitive areas, common mistakes, "Where to Start" reading path |

## Features

- **Code-first** — derives facts from source code, dependency files, and build system. Documentation is read last and verified against code before inclusion.
- **Three depth levels** — Quick (100-200 lines), Standard (200-400), Deep (400-700). Auto-detected from project size, user-overridable.
- **Incremental updates** — detects what changed since last generation and updates only stale sections. User notes are preserved across updates.
- **Mermaid diagrams** — architecture, sequence, and flow diagrams generated from actual code structure.
- **Evidence-based** — no hallucinated paths, no invented commands. All file references verified, all versions from dependency files.

## How to use

### Installation

Clone the repo into your Claude Code skills directory:

```bash
git clone https://github.com/juanje/codebase-documenter.git ~/.claude/skills/codebase-documenter
```

Claude Code will automatically discover the skill. To update:

```bash
cd ~/.claude/skills/codebase-documenter && git pull
```

### Usage

Invoke the skill by asking Claude Code to document a codebase:

```
document this codebase
explain this codebase (quick)
deep documentation please
update the codebase documentation
```

The skill will:
1. Run a fast extraction script to snapshot the project (languages, deps, structure, git stats)
2. Read source files in priority order (entry points first, docs last)
3. Optionally ask 1-2 clarifying questions
4. Generate `docs/CODEBASE.md`

On subsequent runs, it detects staleness and updates only what changed.

## Structure

```
codebase-documenter/
├── SKILL.md                  # Skill definition — workflow, phases, constraints
├── scripts/
│   ├── extract_project_facts.sh  # Fast project snapshot in one shell call
│   ├── detect_staleness.sh       # Compares docs against current project state
│   └── validate_output.sh        # Validates generated docs (paths, sections, commands)
├── references/
│   ├── output-format.md      # Section templates, good/bad examples, size targets
│   └── example-output.md     # Full Standard-depth example (~295 lines)
├── LICENSE
└── README.md
```

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
