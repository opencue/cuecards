# Output Format Specification

Read this file before writing any documentation output. It defines the exact format,
quality criteria, and provides good vs bad examples for each section.

## The Inclusion Test

Before writing any line, ask: **"Would a new developer need to know this to become
productive?"**

- If yes → include it
- If no → cut it

This test is the single most important quality criterion. Apply it ruthlessly.

## What to Include vs Exclude

**Include (directly helps a new developer):**
- What the project does and who it's for
- How the major pieces fit together (architecture)
- Where to find things (structure, entry points)
- How data flows through the system
- How to set up, run, and test locally
- Non-obvious patterns and conventions
- Areas that are fragile or require caution
- Recommended reading order for onboarding

**Exclude (doesn't help onboarding):**
- Generic best practices everyone knows
- Detailed explanations of well-known frameworks ("FastAPI is a web framework")
- Complete API endpoint documentation (belongs in API docs)
- Changelog or history of changes
- Every file and function — only the important ones
- Deployment procedures (belongs in ops docs)
- Anything a developer can infer from reading a single file
- Claims from README or docs that can't be verified against the code

**Source of truth:** Always derive facts from the code, dependency files, and build
system — not from README or wiki pages. Repository documentation is frequently outdated.
When docs and code conflict, document what the code actually does.

---

## Section Templates

### Section 1: Project Overview

**Size target:** 5–10 lines. All depths.

```markdown
# [Project Name]

> [One-sentence purpose — what it does and for whom]

- **Type:** [CLI tool | Web service | Library | API | Mobile app | etc.]
- **Primary language:** [Language] [version]
- **Key frameworks:** [framework1] [version], [framework2] [version]
- **Status:** [Active development | Maintenance mode | Legacy] — [N] contributors, [age]
```

BAD (generic, says nothing):
> A web application for managing data and providing user interfaces for various
> business operations across the organization.

GOOD (specific, distinguishes this project):
> REST API that processes insurance claims, validates coverage against policy rules,
> and triggers automated payouts via PaymentCo's payment gateway.

The purpose line must be specific enough that someone reading it knows exactly what
this project does and doesn't do.

---

### Table of Contents (Standard/Deep only)

**Size target:** 8–12 lines. Skip for Quick depth.

Place immediately after the Project Overview metadata block.

```markdown
## Contents

- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Key Components](#key-components)
- [Data Flow](#data-flow)
- [External Integrations](#external-integrations)
- [Development Guide](#development-guide)
- [Critical Paths & Gotchas](#critical-paths--gotchas)
```

**Rules:**
- Only include sections that are actually present in the document.
- Use standard Markdown anchor links (lowercase, spaces → hyphens, strip special chars).
- No nested entries — keep it flat. The ToC is a quick navigation aid, not an outline.
- Quick depth: skip entirely. The document is short enough to scroll.

---

### Section 2: Architecture Overview

**Size target:** Quick 15–30, Standard 30–50, Deep 50–80 lines.

```markdown
## Architecture Overview

[2-3 sentence description of the high-level architecture — what pattern it follows and why]

### System Diagram

\`\`\`mermaid
graph TD
    A[Component A] --> B[Component B]
    B --> C[Component C]
    A --> D[Component D]
\`\`\`

### Design Patterns
- **[Pattern name]**: [Where and how it's used] — `relevant/file.py` → `ClassName`/`function_name()`

### Key Architectural Decisions
- **[Decision]**: [What was chosen and why] — inferred from [source]
```

**Rules:**
- The diagram must reflect the actual architecture, not a generic template. Show real
  component names from the codebase. Every arrow must correspond to a real relationship
  in the code (import, call, exec) — verify before including.
- Design patterns: only non-obvious ones. "Uses classes" is obvious. "All handlers use
  Chain of Responsibility via middleware stack defined in `middleware/pipeline.py`" is useful.
- Decisions: only include if the WHY is non-obvious. Source from git history, code
  comments, or structural evidence.
- Max 4 design patterns, max 4 decisions.
- Quick depth: diagram + 1-2 sentence description only. Skip patterns and decisions.

BAD (generic, no real information):
> The project uses a modular architecture with separation of concerns. Components
> communicate through well-defined interfaces.

GOOD (specific, actionable):
> Three-layer architecture: thin API routes delegate to service classes, which
> orchestrate repository calls and external integrations. Services own business logic
> — routes handle only request/response mapping. This split was adopted after route
> handlers grew past 200 lines (visible in the `split-services` commits from 2024-08).

---

### Section 3: Project Structure

**Size target:** Quick 10–15, Standard 15–25, Deep 20–30 lines.

```markdown
## Project Structure

\`\`\`
project-root/
├── src/app/
│   ├── main.py              → entry point, app factory
│   ├── api/routes/           — one file per API version
│   ├── services/             — business logic layer
│   ├── models/               — ORM models + Pydantic schemas
│   └── integrations/         — external service clients
├── tests/                    — mirrors src/ structure
└── migrations/               — Alembic database migrations
\`\`\`
```

**Rules:**
- Only paths a developer would need to navigate. Skip boilerplate (`__init__.py`,
  lockfiles, build artifacts).
- Annotate with PURPOSE, not file type. Not "Python file" but "claim state machine".
- Mark entry points with `→`. Mark directories with `—`.
- Group related files when possible ("routes/ — one file per API version").
- Max depth: 3 levels unless deeper structure is architecturally significant.
- Quick depth: top 2 levels only with brief annotations.

BAD (over-documented boilerplate):
> ```
> src/
> ├── __init__.py          # Package initializer
> ├── main.py              # Main entry point for the application
> ├── utils/
> │   ├── __init__.py      # Utils package initializer
> │   ├── helpers.py       # Helper functions
> │   └── constants.py     # Constant values
> ```

GOOD (purposeful, navigable):
> ```
> src/claims_api/
> ├── main.py              → FastAPI app factory + middleware setup
> ├── api/v1/routes/       — thin route handlers, delegate to services
> ├── services/            — business logic (one service per domain)
> │   ├── claims.py        — claim lifecycle: create → validate → pay
> │   └── coverage.py      — coverage verification against policy rules
> ├── models/
> │   ├── db/              — SQLAlchemy ORM models
> │   └── schemas/         — Pydantic request/response schemas
> └── integrations/        — external API clients (PaymentCo, PolicyService)
> ```

---

### Section 4: Key Components

**Size target:** Quick 20–40, Standard 40–80, Deep 70–120 lines.

```markdown
## Key Components

### [Component/Module Name]
**Location:** `path/to/module/`
**Purpose:** [What it does — one sentence]
**Key files:**
- `file.py` — `ClassName`, [what this class does]
- `other.py` — `function_name()`, [what this function does]

[For Standard/Deep: how this component interacts with others]
```

For Deep depth, include a sequence diagram for the primary flow:

```markdown
### Component Interaction — [Primary Flow Name]

\`\`\`mermaid
sequenceDiagram
    participant A as Component A
    participant B as Component B
    participant C as Component C
    A->>B: action
    B->>C: delegate
    C-->>B: result
    B-->>A: response
\`\`\`
```

**Rules:**
- Order components by importance: entry point → core logic → supporting modules.
- Reference key functions/classes by name (`ClassName`, `function_name()`) so developers
  can find them with search/grep. This is more durable than line numbers, which shift
  with every edit.
- When a component has a corresponding test file or example config, reference it
  (e.g., "See `tests/test_claims.py` for usage examples" or "Example manifest:
  `examples/basic.yml`"). This helps developers understand behavior through concrete examples.
- Quick depth: list components with one-line descriptions, no code references.
- Standard: include key files and brief interaction notes.
- Deep: include sequence diagrams for the top 2-3 interaction flows.
- Max 8 components for Standard, 12 for Deep.

BAD (vague, no references):
> ### Utils Module
> Contains various utility functions used throughout the application for
> common operations.

GOOD (specific, navigable):
> ### Claim Processing Service
> **Location:** `src/services/claims.py`
> **Purpose:** Manages the full claim lifecycle from submission to payout
> **Key files:**
> - `claims.py` — `ClaimService` class, orchestrates all claim operations
> - `claims.py` — `transition_state()` — enforces the claim state machine
>   (DRAFT → SUBMITTED → VALIDATING → APPROVED/DENIED → PAID)
> - `claims.py` — `adjudicate()` — core business logic, evaluates claim
>   against policy rules
>
> All state changes must go through `transition_state()` — direct status
> assignment bypasses validation and audit logging.

---

### Section 5: Data Flow

**Size target:** Quick: skip (fold into Architecture), Standard 15–30, Deep 30–50 lines.

```markdown
## Data Flow

[1-2 sentence overview of how data moves through the system]

### [Primary Flow Name]

\`\`\`mermaid
flowchart LR
    A[Input] --> B[Process]
    B --> C[Transform]
    C --> D[Output]
\`\`\`

### Key Data Transformations
- [Input] → `processor` → [Output]: [what happens and why]
```

**Rules:**
- Show the primary/happy path first.
- For Deep depth: add a second diagram for an important secondary flow (error path,
  async processing, webhook handling, etc.).
- Include state management patterns if the project uses them (Redux, context,
  state machines, etc.).
- Quick depth: skip this section entirely. Mention key data flow in Architecture Overview.

---

### Section 6: External Integrations

**Size target:** 10–30 lines. Only include if the project has meaningful external deps.

```markdown
## External Integrations

| Service | Purpose | Client Location | Auth Method |
|---------|---------|----------------|-------------|
| [name]  | [role]  | `file.py`      | [API key/OAuth/etc.] |

### Configuration
[How external services are configured — env vars, config files, priority order]
```

**Rules:**
- Don't describe what well-known services do ("PostgreSQL is a database").
- Focus on HOW the project uses them and WHERE the integration code lives.
- Include auth method — developers need this for local setup.
- Quick depth: merge into Architecture Overview as a bullet list.

---

### Section 7: Development Guide

**Size target:** Quick 15–25, Standard 25–40, Deep 30–50 lines.

```markdown
## Development Guide

### Prerequisites
- [Language] [version]
- [Tool] [version]

### Getting Started
\`\`\`bash
[actual commands — clone, install deps, configure, run]
\`\`\`

### Key Commands
| Command | Purpose |
|---------|---------|
| `make test` | Run test suite |
| `make lint` | Run linter |

### Testing
[Framework, how to run, coverage requirements, test organization]

### Configuration
[How to configure for local dev — which env vars, config files, defaults]
```

**Rules:**
- Commands must be REAL — extracted from Makefile, package.json scripts, or CI config.
  Never copy commands from README without verifying they actually exist in the build
  system. READMEs are frequently outdated and list commands that no longer work.
- Prerequisites must list actual version requirements from dependency files, not from
  what the README claims.
- Include the minimum setup to get the project running locally.
- If the project has a CLAUDE.md, README.md, or CONTRIBUTING.md with relevant
  complementary information (detailed setup, workflows, domain context), add a
  "See also" reference: e.g., "See `CLAUDE.md` for project-specific workflows and
  build examples." Don't duplicate their content — just point to it.
- Quick depth: just Prerequisites + Getting Started + Key Commands table.

BAD (invented commands):
> ```bash
> npm run setup
> npm run start:dev
> ```
> (when these scripts don't exist in package.json)

GOOD (verified from actual project files):
> ```bash
> python -m venv .venv && source .venv/bin/activate
> pip install -e ".[dev]"           # from pyproject.toml
> cp .env.example .env              # configure local settings
> alembic upgrade head              # run migrations
> uvicorn src.main:app --reload     # from Makefile 'run' target
> ```

---

### Section 8: Critical Paths & Gotchas

**Size target:** Quick 10–15 (only "Where to Start"), Standard 15–25, Deep 20–30 lines.

```markdown
## Critical Paths & Gotchas

### Areas Requiring Extra Caution
- **[area]** (`file`): [why it's sensitive]

### Common Mistakes
- [Mistake]: [what goes wrong] — [evidence: commit ref or code comment]

### Where to Start
Recommended reading order for a new developer:
1. `file1` — [why read this first — gives the big picture]
2. `file2` — [why this next — core abstraction]
3. `file3` — [why next — main business logic]
4. `file4` — [connects the pieces — how components interact]
5. `file5` — [practical — how to run and test]
```

**Rules:**
- "Common Mistakes" must be evidence-based: from git reverts, fix commits, or code
  comments that warn about gotchas. Don't invent hypothetical pitfalls.
- "Where to Start" is the most valuable part for onboarding. Sequence 3-5 files from
  "big picture" to "details". Every file must exist.
- Quick depth: only "Where to Start" (skip caution areas and mistakes).

---

### User Notes Section

Always include at the bottom:

```markdown
---
<!-- USER NOTES - content below this line is preserved on updates -->

## Additional Notes

[Space for team members to add domain context, corrections, or supplementary notes.
This section is never overwritten by automated updates.]
```

This marker is critical for update mode — everything below it is preserved.

---

## Size Calibration

| Depth | Total | ToC | Architecture | Components | Data Flow | Dev Guide | Other |
|-------|-------|----|-------------|-----------|-----------|-----------|-------|
| Quick | 100–200 | 0 | 15–30 | 20–40 | 0 (merged) | 15–25 | 10–20 |
| Standard | 200–400 | 8–12 | 30–50 | 40–80 | 15–30 | 25–40 | 20–40 |
| Deep | 400–700 | 8–12 | 50–80 | 70–120 | 30–50 | 30–50 | 30–50 |

These are maximums. Fewer lines at the same quality is always better.

## Formatting Conventions

- Use bullet points over prose
- Inline code for file paths: `src/config.py`
- Inline code for function/class names: `ClaimService`, `transition_state()`
- Bold for component names and key terms
- Mermaid for all diagrams (graph, sequenceDiagram, flowchart)
- Tables for structured data (commands, integrations)
- `→` for entry points in directory trees
- `—` for directory annotations in trees
