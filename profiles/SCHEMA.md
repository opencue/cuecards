# Profile Schema

A profile is one `profile.yaml` file living under `profiles/<name>/`. The
directory name and the `name:` field MUST match.

```yaml
name: medusa-dev
description: Medusa v2 backend + storefront work
agents: [claude-code, codex]
inherits: core            # optional — exactly one parent
skills:
  local:
    - medusa/building-with-medusa
    - medusa/db-generate
  npx:
    - repo: anthropics/skills
      pin: tag@v0.4.1     # optional — see "Pin forms" below
      skills: [pdf, xlsx]
  plugins:
    - claude-mem
mcps:
  - medusadocs
  - claude-mem
env:
  MEDUSA_DEV: "1"
```

## Top-level fields

| Field         | Type                                                          | Required | Default | Notes                                                                                              |
|---------------|---------------------------------------------------------------|----------|---------|----------------------------------------------------------------------------------------------------|
| `name`        | string (kebab-case, `[a-z][a-z0-9-]{1,63}`)                   | yes      | —       | Must equal the dirname `profiles/<name>/`.                                                         |
| `description` | string (one-line, < 200 chars)                                | yes      | —       | Shown by `cue list` and embedded in the materialized `CLAUDE.md` stamp.                           |
| `agents`      | array of `"claude-code" \| "codex"`                           | no       | `[claude-code, codex]` | Restricts which agent runtimes this profile materializes for.                          |
| `inherits`    | string (name of another profile)                              | no       | —       | Single parent. Depth ≤ 3. Cycles are an error.                                                     |
| `skills`      | object (see below)                                            | no       | `{}`    | At least one of `local`, `npx`, `plugins` should appear in a useful profile.                       |
| `skills.local`| array of strings (paths relative to `cue/skills/`)           | no       | `[]`    | E.g. `medusa/building-with-medusa` → resolves to `cue/skills/skills/medusa/building-with-medusa/`. |
| `skills.npx`  | array of `NpxSkillRef`                                        | no       | `[]`    | See "NpxSkillRef" below.                                                                           |
| `skills.plugins` | array of strings (Claude Code plugin names)                | no       | `[]`    | Resolved from `~/.claude/plugins/<name>/skills/`. Targets are namespaced as `<plugin>:<skill>`.    |
| `mcps`        | array of strings or `{id, agents?, when?}` objects            | no       | `[]`    | Each id must match a key in `cue/mcps/configs/claude.sanitized.json` (or the codex counterpart). Object form adds optional `agents:` scoping and a `when:` activation gate — see "Conditional activation (`when:`)" below. |
| `env`         | map<string, string>                                           | no       | `{}`    | Plain string values. Placeholders like `"${HOSTINGER_API_TOKEN}"` are substituted at materialize-time. |
| `codex_config` | map<string, any>                                             | no       | `{}`    | Extra keys merged into the Codex runtime's `config.toml` next to this profile's MCP servers. cue repoints `CODEX_HOME` at the materialized runtime, so the user's own `~/.codex/config.toml` is **never read** — `sandbox_mode`, `sandbox_workspace_write`, `approval_policy`, `shell_environment_policy` and friends have to come through here. Emitted verbatim as TOML; ignored for non-Codex agents. See "codex_config example" below. |
| `rules`       | array of strings                                              | no       | `[]`    | Markdown rule files under `resources/rules/` (or absolute paths). Symlinked into `<runtime>/rules/` and indexed in CLAUDE.md — Claude reads on demand, no full-body inline. |
| `commands`    | array of strings                                              | no       | `[]`    | Slash-command markdown files under `resources/commands/`. Symlinked into `<runtime>/commands/` so the user can invoke `/<name>`. Listed in CLAUDE.md's "Available Commands" section. |
| `codex`       | map<string, string \| number \| bool> (+ `features` map<string, bool>) | no       | `{}`    | Codex-only `config.toml` overrides, written on top of the inherited `~/.codex/config.toml`. See "Codex config overrides" below. |
| `hooks`       | array of strings                                              | no       | `[]`    | Hook bundle JSON files under `resources/hooks/`. Each declares `{ "hooks": { "PreToolUse": [...], "Stop": [...], ... } }` — merged into `settings.json` so hooks run per Claude Code's lifecycle. Sibling `.sh`/`.py` scripts are symlinked into `<runtime>/hooks/` and invoked via `${CLAUDE_CONFIG_DIR}/hooks/...`. |

### rules / commands / hooks example

```yaml
# profiles/my-backend/profile.yaml
name: my-backend
inherits: core
rules:
  - common/security        # → resources/rules/common/security.md
  - typescript/patterns    # → resources/rules/typescript/patterns.md
commands:
  - code-review            # → resources/commands/code-review.md, invoked as /code-review
  - checkpoint
hooks:
  - secrets-guard.json     # → resources/hooks/secrets-guard.json (+ secrets-guard.sh)
```

Path resolution: refs starting with `/` are taken as absolute; otherwise resolved
relative to `resources/{rules,commands,hooks}/`. `.md` is auto-appended for
rules/commands if the ref doesn't already end in `.md`. Hooks are taken
verbatim (need the explicit `.json`). Missing refs are skipped at materialize
time and reported as `E3` by `cue validate`.

Inheritance merges all three with `concat + dedupe`; a child can't remove a
parent's entry — fork the parent if you need a smaller set.

## Codex config overrides (`codex:`)

cue points `CODEX_HOME` at the per-profile runtime, so `<runtime>/codex/config.toml`
is the only config a cue-launched Codex reads. That file is built from three
layers, last wins:

1. **base** — top-level keys and `[features]` from `~/.codex/config.toml`. This is
   what keeps a Codex session running at the reasoning effort, context window and
   auto-compact limit the user configured; without it the session silently falls
   back to model defaults and turns end much sooner.
2. **the profile's `codex:` block** — merged key by key, so a profile overrides
   one knob without dropping the rest.
3. **`[mcp_servers.*]`** — always cue-owned. Base-config MCP servers are never
   inherited; other base tables (`[projects.*]`, `[model_providers.*]`, …) are
   dropped as machine-local state.

```yaml
# profiles/careful-codex/profile.yaml
name: careful-codex
inherits: core
codex:
  model_reasoning_effort: xhigh
  sandbox_mode: workspace-write     # tighten what the base config allows
  model_auto_compact_token_limit: 320000
  features:
    goals: true
```

Keys are passed through verbatim, so cue needs no allowlist tracking Codex's
config surface — run `codex --strict-config` to catch a typo. Inheritance merges
key by key (leaf wins); across a composite `a+b`, later parts win, like `env`.
The base config's content is part of the runtime hash, so editing
`~/.codex/config.toml` rebuilds the runtime on the next launch.

## Conditional activation (`when:`)

Both `skills.local` entries and `mcps` entries accept an object form with a
`when:` gate, so an entry only materializes when its condition holds in the
launch cwd/env. This keeps an MCP server's tool schema (and a skill's router
rows) off the startup budget until the integration is actually in play — the
whole point of cue being per-directory.

```yaml
mcps:
  - coolify                      # string form — always active
  - id: postgres                 # object form — only when a DB is configured
    when:
      env: DATABASE_URL
  - id: obsidian-vault           # only inside an Obsidian vault
    when:
      has_dir: .obsidian
skills:
  local:
    - review/security-review     # always
    - id: pdf/fill-forms         # only when a PDF is in cwd
      when:
        has_file: "*.pdf"
```

`when:` keys (at least one required):

| Key        | Meaning                                                                 |
|------------|-------------------------------------------------------------------------|
| `has_file` | string or list; passes if **at least one** exists in cwd. A leading `*.ext` matches by extension. |
| `has_dir`  | string or list; passes if **at least one** directory exists in cwd.     |
| `env`      | string or list; passes if **all** named env vars are set.               |

Keys within one `when:` are AND-ed (all must pass). Prefer a single
unambiguous signal — for a credential-dependent server, gate on the token
(`env:`) since the server is inert without it.

Evaluation happens at materialize time against the launch cwd, mirroring the
conditional-skill path. A condition that newly *passes* activates the entry on
the next launch; like conditional skills, a condition that newly *fails* takes
full effect on the next rebuild.

## NpxSkillRef

```yaml
- repo: anthropics/skills
  pin: tag@v0.4.1
  skills: [pdf, xlsx]
```

| Field    | Type             | Required | Notes                                                                          |
|----------|------------------|----------|--------------------------------------------------------------------------------|
| `repo`   | string (`org/repo`) | yes   | Passed verbatim to `npx skills add <repo>`.                                    |
| `pin`    | string           | no       | Two forms — see below. Omitted = HEAD of default branch.                       |
| `skills` | array of strings | yes      | At least one skill name. Must exist at the resolved ref.                       |

### Pin forms

| Form           | Example          | Meaning                                                          |
|----------------|------------------|------------------------------------------------------------------|
| `git@<sha>`    | `git@a1b2c3d`    | Fetches at that exact commit (full or abbreviated SHA).          |
| `tag@<version>`| `tag@v0.4.1`     | Fetches at the named git tag.                                    |

The cache key is `sha256(repo + (pin || "HEAD"))`, so changing the pin always
forces a fresh fetch.

## Inheritance

```yaml
# profiles/core/profile.yaml
name: core
description: Always-on baseline
skills:
  local: [meta/caveman-commit, meta/find-skills]
mcps: [claude-mem]
```

```yaml
# profiles/medusa-dev/profile.yaml
name: medusa-dev
description: Medusa v2 work
inherits: core
skills:
  local: [medusa/building-with-medusa]
mcps: [medusadocs]
```

Resolves to:

```yaml
name: medusa-dev
description: Medusa v2 work
skills:
  local:
    - meta/caveman-commit       # from core
    - meta/find-skills          # from core
    - medusa/building-with-medusa  # from medusa-dev
mcps:
  - claude-mem                  # from core
  - medusadocs                  # from medusa-dev
```

**Merge rules:**

- **arrays** (`skills.local`, `skills.npx`, `skills.plugins`, `mcps`, `agents`) — concat parent then child, dedupe by identity (string for plain arrays; `repo` for `NpxSkillRef`)
- **objects** (`skills`, `env`) — child keys override parent keys; nested arrays merge per the rule above
- **`codex_config`** — same, but one level deeper: a child that sets only
  `sandbox_workspace_write.network_access` keeps the parent's sibling keys in
  that table instead of replacing it
- **scalars** (`name`, `description`) — child overrides parent

**Constraints:**

- `inherits` is a single string, never a list. Deep chains are discouraged; depth > 3 is a validation warning, cycles are a validation error.

## Name uniqueness rule

The `name:` field must equal the directory name. Two profiles with the same
`name:` is a validation error even if they live in different dirs. Linter rule
`E1` enforces this.

## Defaults summary

| Field           | If omitted, becomes                |
|-----------------|------------------------------------|
| `agents`        | `[claude-code, codex]`             |
| `inherits`      | (no parent)                        |
| `skills.local`  | `[]`                               |
| `skills.npx`    | `[]`                               |
| `skills.plugins`| `[]`                               |
| `mcps`          | `[]`                               |
| `env`           | `{}`                               |
| `codex`         | `{}` (base `~/.codex/config.toml` still inherited) |

A profile with only `name` and `description` is legal but useless — it
materializes an empty workspace. The linter flags this as `W5` (vacuous
profile).
