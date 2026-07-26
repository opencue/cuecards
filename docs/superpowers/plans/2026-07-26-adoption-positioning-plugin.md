# Adoption: one pitch, one command, one install path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cue findable and installable — one canonical pitch on every surface, one install command, and a Claude Code marketplace entry that actually works.

**Architecture:** Three phases in a fixed order. Phase 1 establishes two canonical
strings in `docs/marketing/positioning.md` and a test that pins them into
`package.json` and the plugin manifest, then propagates them to the remaining
copy surfaces. Phase 2 adds a `setup` alias and moves the cost proof ahead of the
shim prompt inside the existing `cue init` flow. Phase 3 packages the existing
`plugins/cue/` plugin behind a repo-root `.claude-plugin/marketplace.json`.
Phase 1 gates the other two because the plugin description and the awesome-list
entry are both derived from the canonical strings.

**Tech Stack:** TypeScript on Bun (`bun test`), Biome for lint, `@clack/prompts`
for interactive CLI flows, JSON manifests for Claude Code plugin/marketplace.

**Spec:** `docs/superpowers/specs/2026-07-26-adoption-positioning-plugin-design.md`

## Global Constraints

- **All product copy is English.** No Hungarian in any tracked file this plan touches.
- **The repeatable claim**, used verbatim wherever the spec says "claim":
  `Your agent reads every skill you own, on every message. cue loads only the ones that project needs.`
- **The searchable descriptor**, used verbatim wherever the spec says "descriptor":
  `Per-project profile manager for Claude Code, Codex, and 8 other AI coding agents — scopes which skills and MCP servers load, per directory.`
- Both strings use a real em dash (`—`, U+2014), not `--`. Copy them byte for byte.
- **Profile count is 85** — the number of `profiles/*/profile.yaml` files. If
  `find profiles -maxdepth 2 -name profile.yaml | wc -l` reports something else at
  implementation time, use that number and keep it consistent across every file.
- **Canonical repo slug is `opencue/cuecards`.** `opencue/claude-code-skills` is
  stale and must not survive anywhere outside git history.
- **Canonical pin file is `.cue.profile`** (dot, not hyphen). `.cue-profile` is wrong.
- Neither canonical string contains the word "discover".
- Tests are colocated as `src/commands/<name>.test.ts` and start with
  `import { describe, expect, test } from "bun:test";`.
- Run `bun test` and `bun run lint` before each commit. Neither may regress.
- Node ≥ 20; no new runtime dependencies may be added by this plan.

---

## Phase 1 — Canonical copy (gates Phases 2 and 3)

### Task 1: Canonical positioning source + drift test

**Files:**
- Create: `docs/marketing/positioning.md`
- Create: `src/commands/positioning.test.ts`
- Modify: `package.json` (the `description` field)

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/marketing/positioning.md` as the single source of truth for both
  strings. Later tasks copy from it. `src/commands/positioning.test.ts` is extended
  by Task 2 — do not rename it.

- [ ] **Step 1: Write the failing test**

Create `src/commands/positioning.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

/**
 * The two canonical strings. These are duplicated here on purpose: the test's
 * job is to catch a surface drifting away from docs/marketing/positioning.md,
 * so reading the value from the same place the code reads it would prove
 * nothing.
 */
export const CLAIM =
  "Your agent reads every skill you own, on every message. cue loads only the ones that project needs.";
export const DESCRIPTOR =
  "Per-project profile manager for Claude Code, Codex, and 8 other AI coding agents — scopes which skills and MCP servers load, per directory.";

describe("canonical positioning", () => {
  test("positioning.md carries both strings verbatim", () => {
    const md = readFileSync(join(REPO_ROOT, "docs/marketing/positioning.md"), "utf8");
    expect(md).toContain(CLAIM);
    expect(md).toContain(DESCRIPTOR);
  });

  test("package.json description is the descriptor", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    expect(pkg.description).toBe(DESCRIPTOR);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/commands/positioning.test.ts`
Expected: FAIL — `docs/marketing/positioning.md` does not exist (ENOENT), and
`package.json` description is still the old "Agent Profile Manager for Claude
Code & Codex. Pick a profile, launch with the right skills, MCPs, and plugins."

- [ ] **Step 3: Create the canonical source**

Create `docs/marketing/positioning.md`:

```markdown
# Positioning — the two canonical strings

cue is positioned as a **scoper**: it loads less. Discovery (`cue discover`) is a
real feature and the SEO engine, but it is never the headline. Neither string
below contains the word "discover".

These two strings do different jobs. Do not merge them, do not paraphrase them,
and do not let a surface invent its own variant. `src/commands/positioning.test.ts`
enforces the machine-readable surfaces; the prose surfaces are on you.

## The repeatable claim

For the README H1, Show HN title, social posts, and the OG card. Optimized for a
human repeating it to another human.

> Your agent reads every skill you own, on every message. cue loads only the ones that project needs.

## The searchable descriptor

For npm, awesome-list entries, the GitHub About field, and `/plugin search`.
Optimized for keyword match, not for wit.

> Per-project profile manager for Claude Code, Codex, and 8 other AI coding agents — scopes which skills and MCP servers load, per directory.

## Surfaces

| Surface | String |
|---|---|
| `package.json` `description` | descriptor |
| `plugins/cue/.claude-plugin/plugin.json` `description` | descriptor |
| `.claude-plugin/marketplace.json` `metadata.description` | descriptor |
| `README.md` H1 subtitle | claim |
| `docs/index.md` front matter + H1 | claim |
| `llms.txt`, `docs/llms.txt` | both |
| `docs/marketing/awesome-lists.md` canonical entry | descriptor |
| GitHub About + topics | descriptor |
| `docs/assets/og-card.png` | claim |
```

- [ ] **Step 4: Apply the descriptor to package.json**

In `package.json`, replace the `description` value with exactly:

```json
  "description": "Per-project profile manager for Claude Code, Codex, and 8 other AI coding agents — scopes which skills and MCP servers load, per directory.",
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test src/commands/positioning.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add docs/marketing/positioning.md src/commands/positioning.test.ts package.json
git commit -m "docs(positioning): canonical claim + descriptor, pinned by test"
```

---

### Task 2: Move the plugin manifest and apply the descriptor

The manifest currently sits at `plugins/cue/plugin.json`. Every working plugin
installed on this machine (superpowers, claude-seo) keeps it at
`<plugin-root>/.claude-plugin/plugin.json`, which is the path Claude Code reads.
The explicit `commands[]` array is dropped: no working plugin on disk declares
it, and commands are discovered from `commands/`.

**Files:**
- Create: `plugins/cue/.claude-plugin/plugin.json`
- Delete: `plugins/cue/plugin.json`
- Modify: `src/commands/positioning.test.ts`

**Interfaces:**
- Consumes: `DESCRIPTOR` from `src/commands/positioning.test.ts` (Task 1).
- Produces: `plugins/cue/.claude-plugin/plugin.json` — Task 3's
  `marketplace.json` points `source` at `./plugins/cue`, which requires the
  manifest to be at this exact path.

- [ ] **Step 1: Write the failing test**

Append to `src/commands/positioning.test.ts`, inside the existing
`describe("canonical positioning", …)` block:

```typescript
  test("plugin manifest is at the path Claude Code reads, with the descriptor", () => {
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, "plugins/cue/.claude-plugin/plugin.json"), "utf8"),
    );
    expect(manifest.description).toBe(DESCRIPTOR);
    expect(manifest.name).toBe("cue");
    // Discovery metadata — these feed `/plugin search`, which is the entire
    // point of packaging the plugin.
    expect(manifest.homepage).toBe("https://github.com/opencue/cuecards");
    expect(manifest.repository).toBe("https://github.com/opencue/cuecards");
    expect(manifest.license).toBe("MIT");
    expect(Array.isArray(manifest.keywords)).toBe(true);
    expect(manifest.keywords.length).toBeGreaterThan(0);
    // No working plugin on disk declares commands[]; they come from commands/.
    expect(manifest.commands).toBeUndefined();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/commands/positioning.test.ts`
Expected: FAIL — ENOENT on `plugins/cue/.claude-plugin/plugin.json`.

- [ ] **Step 3: Create the manifest at the new path**

Create `plugins/cue/.claude-plugin/plugin.json`:

```json
{
  "$schema": "https://anthropic.com/claude-code/plugin.schema.json",
  "name": "cue",
  "description": "Per-project profile manager for Claude Code, Codex, and 8 other AI coding agents — scopes which skills and MCP servers load, per directory.",
  "version": "0.3.0",
  "author": { "name": "NagyVikt" },
  "homepage": "https://github.com/opencue/cuecards",
  "repository": "https://github.com/opencue/cuecards",
  "license": "MIT",
  "keywords": [
    "profile-manager",
    "skills",
    "mcp",
    "context",
    "token-budget",
    "codex",
    "claude-code"
  ]
}
```

- [ ] **Step 4: Delete the old manifest**

```bash
git rm plugins/cue/plugin.json
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test src/commands/positioning.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add plugins/cue/.claude-plugin/plugin.json src/commands/positioning.test.ts
git commit -m "fix(plugin): move manifest to .claude-plugin/, add discovery metadata"
```

---

### Task 3: Repo-root marketplace entry point

Without this file `/plugin marketplace add opencue/cuecards` fails outright, so
the plugin exists but nobody can install it.

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `src/commands/marketplace-manifest.test.ts`

**Interfaces:**
- Consumes: `plugins/cue/.claude-plugin/plugin.json` from Task 2.
- Produces: `.claude-plugin/marketplace.json` declaring marketplace `cuecards`
  with one plugin, `cue`. Task 12's manual check installs via `cue@cuecards` —
  that name pair comes from this file.

- [ ] **Step 1: Write the failing test**

Create `src/commands/marketplace-manifest.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

describe("repo-root marketplace manifest", () => {
  test("parses and declares the cuecards marketplace", () => {
    const mkt = JSON.parse(
      readFileSync(join(REPO_ROOT, ".claude-plugin/marketplace.json"), "utf8"),
    );
    expect(mkt.name).toBe("cuecards");
    expect(mkt.owner?.name).toBe("NagyVikt");
    expect(typeof mkt.metadata?.description).toBe("string");
    expect(Array.isArray(mkt.plugins)).toBe(true);
  });

  test("declares exactly one plugin, and its source resolves to a real manifest", () => {
    const mkt = JSON.parse(
      readFileSync(join(REPO_ROOT, ".claude-plugin/marketplace.json"), "utf8"),
    );
    // One plugin on purpose: the 85 profiles are meaningless without the CLI,
    // and 85 dead entries are worse for discovery than one live one.
    expect(mkt.plugins.length).toBe(1);
    const entry = mkt.plugins[0];
    expect(entry.name).toBe("cue");
    // The typo class this catches: `source` pointing at a directory with no
    // manifest, which fails only at install time in a real session.
    const manifest = join(REPO_ROOT, entry.source, ".claude-plugin", "plugin.json");
    expect(existsSync(manifest)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/commands/marketplace-manifest.test.ts`
Expected: FAIL — ENOENT on `.claude-plugin/marketplace.json`.

- [ ] **Step 3: Create the marketplace manifest**

Create `.claude-plugin/marketplace.json`:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "cuecards",
  "owner": {
    "name": "NagyVikt"
  },
  "metadata": {
    "description": "Per-project profile manager for Claude Code, Codex, and 8 other AI coding agents — scopes which skills and MCP servers load, per directory."
  },
  "plugins": [
    {
      "name": "cue",
      "source": "./plugins/cue",
      "description": "Per-project profile manager for Claude Code, Codex, and 8 other AI coding agents — scopes which skills and MCP servers load, per directory.",
      "author": {
        "name": "NagyVikt",
        "url": "https://github.com/NagyVikt"
      },
      "category": "productivity",
      "homepage": "https://github.com/opencue/cuecards",
      "license": "MIT",
      "keywords": [
        "profile-manager",
        "skills",
        "mcp",
        "context",
        "token-budget",
        "codex",
        "claude-code"
      ]
    }
  ]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/commands/marketplace-manifest.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin/marketplace.json src/commands/marketplace-manifest.test.ts
git commit -m "feat(plugin): repo-root marketplace.json so /plugin marketplace add works"
```

---

### Task 4: Fix the factual drift in the LLM-facing files

Three wrong facts live in the root `llms.txt`, and a fourth in a script. They are
the same failure class as the split pitch: nothing pinned them.

**Files:**
- Modify: `llms.txt`
- Modify: `docs/llms.txt`
- Modify: `scripts/update-repo-topics.sh:15`
- Create: `src/commands/docs-facts.test.ts`

**Interfaces:**
- Consumes: nothing. This test checks facts, not copy — it does not import
  `CLAIM`/`DESCRIPTOR`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Create `src/commands/docs-facts.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

/** Tracked text surfaces that make factual claims about cue. */
const FACT_FILES = ["llms.txt", "docs/llms.txt", "README.md", "docs/index.md"];

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

describe("documented facts match reality", () => {
  test("the pin file is spelled .cue.profile everywhere", () => {
    for (const f of FACT_FILES) {
      expect(read(f)).not.toContain(".cue-profile");
    }
  });

  test("the repo slug is opencue/cuecards everywhere", () => {
    for (const f of [...FACT_FILES, "scripts/update-repo-topics.sh"]) {
      expect(read(f)).not.toContain("opencue/claude-code-skills");
    }
  });

  test("the stated profile count matches profiles/*/profile.yaml", () => {
    const actual = readdirSync(join(REPO_ROOT, "profiles"), { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith("_"))
      .filter(d => {
        try {
          readFileSync(join(REPO_ROOT, "profiles", d.name, "profile.yaml"));
          return true;
        } catch {
          return false;
        }
      }).length;
    // Guards against the drift that produced "16" in llms.txt and "69" in the
    // README while the real number was 85.
    for (const f of FACT_FILES) {
      const text = read(f);
      for (const stale of ["16 profiles", "69 ready-made", "see all 69"]) {
        expect(text).not.toContain(stale);
      }
      if (/\bprofiles ship by default\b/.test(text)) {
        expect(text).toContain(`${actual} profiles ship by default`);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/commands/docs-facts.test.ts`
Expected: FAIL on all three tests — `llms.txt` contains `.cue-profile`,
`opencue/claude-code-skills`, and `16 profiles`; `README.md` contains
`69 ready-made` and `see all 69`.

- [ ] **Step 3: Fix `llms.txt`**

In `llms.txt`:
- Replace the H1 line with: `# cue — Per-project profile manager for Claude Code, Codex & 8 more`
- Replace `.cue-profile` with `.cue.profile`.
- Replace `https://github.com/opencue/claude-code-skills` with `https://github.com/opencue/cuecards`.
- Replace `16 profiles ship by default` with `85 profiles ship by default`.
- Add the claim as the first line of the blockquote summary, before the existing
  "cue is a thin CLI…" sentence:

```
> Your agent reads every skill you own, on every message. cue loads only the ones that project needs.
```

- [ ] **Step 4: Fix `docs/llms.txt`**

In `docs/llms.txt`, replace the blockquote line under `# cue` with the claim
followed by the descriptor:

```
> Your agent reads every skill you own, on every message. cue loads only the ones that project needs.

Per-project profile manager for Claude Code, Codex, and 8 other AI coding agents — scopes which skills and MCP servers load, per directory.
```

Leave the paragraph that follows ("cue is a thin shim that sits between…") and
the install line unchanged.

- [ ] **Step 5: Fix the stale repo default in the topics script**

In `scripts/update-repo-topics.sh`, line 15:

```bash
REPO="${REPO:-opencue/cuecards}"
```

Also update the two usage comments above it that name `opencue/claude-code-skills`.

- [ ] **Step 6: Fix the README counts (partial — full restructure is Task 10)**

In `README.md`:
- Line 165: `## 69 ready-made cuecards` → `## 85 ready-made cuecards`
- Line 184: `cue list           # see all 69` → `cue list           # see all 85`

- [ ] **Step 7: Run the test to verify it passes**

Run: `bun test src/commands/docs-facts.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 8: Commit**

```bash
git add llms.txt docs/llms.txt scripts/update-repo-topics.sh README.md src/commands/docs-facts.test.ts
git commit -m "fix(docs): correct pin-file spelling, repo slug, and profile count"
```

---

### Task 5: Reframe the landing page as the scoper pitch

`docs/index.md` currently leads with "Discover skills your AI agent is missing" —
a different product from the README's. The Top-10 gems table and every
nightly-generated discover page stay: they are already indexed and are the
acquisition channel. They move below the fold.

**Files:**
- Modify: `docs/index.md:1-16`

**Interfaces:**
- Consumes: `CLAIM` from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Rewrite the front matter and hero**

Replace `docs/index.md` lines 1 through 16 (front matter through the install
fence, up to and including the `---` separator that precedes
`## 🏆 Top 10 Hidden Gems`) with:

```markdown
---
layout: default
title: "cue — Per-project profile manager for Claude Code & Codex"
description: "Your agent reads every skill you own, on every message. cue loads only the ones that project needs. Install: npm install -g cue-ai"
image: https://opencue.github.io/cuecards/assets/og-card.png
---

# Your agent reads every skill you own, on every message

**cue loads only the ones that project needs.** Per-project profiles scope which
skills, MCP servers, and persona load — automatically, before Claude Code or
Codex launches. Ten agents supported from one profile.

```bash
npm install -g cue-ai && cue setup
```

---
```

- [ ] **Step 2: Verify the gems table survived**

Run: `rg -n "Top 10 Hidden Gems" docs/index.md`
Expected: exactly one hit. The table below it must be untouched — it is the
programmatic-SEO asset, demoted rather than deleted.

- [ ] **Step 3: Verify the retired pitch is gone**

Run: `rg -n "Discover skills your AI agent is missing" docs/ README.md llms.txt`
Expected: no hits.

- [ ] **Step 4: Run the full suite**

Run: `bun test`
Expected: PASS. `docs-facts.test.ts` covers `docs/index.md`, so a typo in the
front matter surfaces here.

- [ ] **Step 5: Commit**

```bash
git add docs/index.md
git commit -m "docs(landing): lead with the scoper claim, demote the gems table"
```

---

### Task 6: Collapse the awesome-list entry to one canonical variant

`docs/marketing/awesome-lists.md` offers three competing entries. Three variants
is how the pitch split in the first place.

**Files:**
- Modify: `docs/marketing/awesome-lists.md` — the "The canonical entry to paste" section

**Interfaces:**
- Consumes: `DESCRIPTOR` from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Replace the three variants with one**

In `docs/marketing/awesome-lists.md`, replace the whole
"## The canonical entry to paste" section — the intro line and all three
fenced variants — with:

````markdown
## The canonical entry to paste

One variant, everywhere. Three variants is how the pitch split in the first
place. The wording is the searchable descriptor from
[`positioning.md`](./positioning.md) — do not improvise a per-list rewrite.

```markdown
- [cue](https://github.com/opencue/cuecards) — Per-project profile manager for Claude Code, Codex, and 8 other AI coding agents — scopes which skills and MCP servers load, per directory. [![Stars](https://img.shields.io/github/stars/opencue/cuecards?style=social)](https://github.com/opencue/cuecards)
```

If a list caps entry length below what this fits, trim from the right (drop the
badge first, then `— scopes which…`). Never swap in a different pitch.
````

- [ ] **Step 2: Verify no stale variants remain**

Run: `rg -n "Discover MCP servers|Profile manager \+ skill discovery" docs/marketing/awesome-lists.md`
Expected: no hits.

- [ ] **Step 3: Commit**

```bash
git add docs/marketing/awesome-lists.md
git commit -m "docs(marketing): one canonical awesome-list entry"
```

---

## Phase 2 — One install command

### Task 7: `cue setup` alias

The spec described `cue setup` as a new orchestrating command. It is not needed:
`cue init` (`src/commands/init.ts:228`) already runs global onboarding, scans the
project, suggests and pins a profile, and calls `ensureShim()`
(`src/commands/init.ts:201`), which delegates to `runInstall()`. `runInstall()`
already handles all three failure modes the spec named — no agent binary on PATH
(refuses, exit 1), shim dir absent from PATH (offers to write the rc line, prints
the exact line on decline), and shim dir shadowed by the real binary (warns with
the fix). Reimplementing any of that would be duplication.

So `setup` is a registry alias to the same module. What it buys is the name:
`init` is overloaded by `git init` / `npm init`, which mean "initialize a
project", not "finish installing this tool".

The spec asked for unit coverage of the three failure modes. **It already
exists** in `src/commands/shell.test.ts` — do not write it again:

| Failure mode | Existing test |
|---|---|
| No agent binary on PATH | `shell.test.ts:107` "refuses, and writes nothing, when no real agent binary exists" |
| Shim dir absent from PATH | `shell.test.ts:123` "warns instead of failing when the shim dir is not on PATH" |
| Real binary shadows the shim | `shell.test.ts:140` "warns when the real binary's dir shadows the shim dir" |
| Re-run idempotency | `shell.test.ts:171` "running install twice does not duplicate the fish line" |

Confirm these still pass at Step 5 rather than adding duplicates.

**Files:**
- Modify: `src/commands/_index.ts` (add a `setup` entry to `COMMANDS`)
- Modify: `package.json` (the `postinstall` script)
- Create: `src/commands/setup.test.ts`

**Interfaces:**
- Consumes: `COMMANDS` from `src/commands/_index.ts`, whose entries have shape
  `{ summary: string; load: () => Promise<{ run: (args: string[]) => Promise<number> }> }`.
- Produces: the `setup` command name, referenced by Task 9's `/cue-setup` slash
  command and by Task 10's README.

- [ ] **Step 1: Write the failing test**

Create `src/commands/setup.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { COMMANDS } from "./_index";

const REPO_ROOT = join(import.meta.dir, "..", "..");

describe("cue setup", () => {
  test("is registered", () => {
    expect(COMMANDS).toHaveProperty("setup");
    expect(typeof COMMANDS.setup.summary).toBe("string");
  });

  test("resolves to the same module as init — one flow, not two", async () => {
    const setupMod = await COMMANDS.setup.load();
    const initMod = await COMMANDS.init.load();
    expect(setupMod.run).toBe(initMod.run);
  });

  test("postinstall points at the single setup command", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    expect(pkg.scripts.postinstall).toContain("cue setup");
    // The two-step instruction is what this replaces.
    expect(pkg.scripts.postinstall).not.toContain("cue shell install");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/commands/setup.test.ts`
Expected: FAIL — `COMMANDS` has no `setup` key.

- [ ] **Step 3: Register the alias**

In `src/commands/_index.ts`, directly after the existing `init:` entry (around
line 226), add:

```typescript
  setup: {
    summary: "One-command install: shim, project scan, and profile pin (alias of init)",
    load: () => import("./init"),
  },
```

- [ ] **Step 4: Rewrite the postinstall message**

In `package.json`, replace the `postinstall` script with:

```json
    "postinstall": "echo '' && echo '  ✅ cue installed.' && echo '  Next: run `cue setup`  — installs the shim, scans this project, pins a profile' && echo '  Docs: https://github.com/opencue/cuecards' && echo ''"
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test src/commands/setup.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Verify the help output lists it**

Run: `bun src/index.ts --help | rg setup`
Expected: one line showing `setup` with the summary above.

- [ ] **Step 7: Commit**

```bash
git add src/commands/_index.ts src/commands/setup.test.ts package.json
git commit -m "feat(cli): cue setup as the single install command"
```

---

### Task 8: Show the cost proof before asking for the shim

`ensureShim()` is called at `src/commands/init.ts:322` and `:330`, after the
profile is pinned, with no evidence shown first. The shim is the largest
permission the flow asks for — it intercepts the user's `claude` command. This
is the one place where the product's central claim can be proven before that ask.

**Files:**
- Modify: `src/commands/init.ts:201-226` (the `ensureShim` function)
- Create: `src/commands/init-cost-proof.test.ts`

**Interfaces:**
- Consumes: `run` from `src/commands/cost.ts`, signature
  `run(args: string[]): Promise<number>`.
- Produces: exported function
  `showCostProof(profile: string, deps?: { costRun?: (args: string[]) => Promise<number> }): Promise<void>`
  from `src/commands/init.ts`. It never throws and never returns a value — a
  failure to render the proof must not block the install.

- [ ] **Step 1: Write the failing test**

Create `src/commands/init-cost-proof.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";

import { showCostProof } from "./init";

describe("cost proof before the shim ask", () => {
  test("invokes cost --compare for the pinned profile", async () => {
    const calls: string[][] = [];
    await showCostProof("backend", {
      costRun: async (args: string[]) => {
        calls.push(args);
        return 0;
      },
    });
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("--compare");
    expect(calls[0]).toContain("backend");
  });

  test("a failing cost run does not block the install", async () => {
    // The proof is a nice-to-have; the shim install is the point. A thrown
    // error here would abort `cue setup` after the profile was already pinned.
    await showCostProof("backend", {
      costRun: async () => {
        throw new Error("boom");
      },
    });
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/commands/init-cost-proof.test.ts`
Expected: FAIL — `showCostProof` is not exported from `./init`.

- [ ] **Step 3: Implement `showCostProof`**

In `src/commands/init.ts`, immediately above the existing `ensureShim()`
declaration (line 201), add:

```typescript
/**
 * Print the token budget for the freshly pinned profile against the `full`
 * baseline, right before `ensureShim()` asks to intercept the user's `claude`
 * command. The whole pitch is "your agent loads less" — this is the only point
 * in the flow where that is demonstrable with the user's own numbers, and it
 * has to land before the biggest permission ask, not after.
 *
 * Never throws: a broken cost run must not abort an install whose profile is
 * already pinned.
 */
export async function showCostProof(
  profile: string,
  deps: { costRun?: (args: string[]) => Promise<number> } = {},
): Promise<void> {
  try {
    const costRun = deps.costRun ?? (await import("./cost")).run;
    p.log.info(`Token budget for "${profile}" vs loading everything:`);
    await costRun([profile, "--compare"]);
  } catch {
    // Non-fatal by design — see the docstring.
  }
}
```

- [ ] **Step 4: Call it before each `ensureShim()`**

In `src/commands/init.ts`, at line 322 (the `__new` branch) replace:

```typescript
    await ensureShim();
```

with:

```typescript
    await showCostProof(name as string);
    await ensureShim();
```

At line 330 (the normal pin path) replace:

```typescript
  await ensureShim();
```

with:

```typescript
  await showCostProof(choice as string);
  await ensureShim();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test src/commands/init-cost-proof.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Run the full suite and lint**

Run: `bun test && bun run lint`
Expected: PASS. `src/commands/init.ts` has existing tests — confirm none regress.

- [ ] **Step 7: Commit**

```bash
git add src/commands/init.ts src/commands/init-cost-proof.test.ts
git commit -m "feat(setup): show cost proof before the shim permission ask"
```

---

## Phase 3 — Plugin behaviour and README

### Task 9: `/cue-setup` and CLI preconditions on the other commands

The six slash commands shell out to the `cue` binary (`plugins/cue/commands/cue.md`
runs `cue list --json`). A user arriving from the marketplace has no `cue`, so
today the install ends in `command not found`. A dead marketplace entry is worse
for discovery than no entry — it is the first impression.

**Files:**
- Create: `plugins/cue/commands/cue-setup.md`
- Modify: `plugins/cue/commands/cue.md`
- Modify: `plugins/cue/commands/cue-switch.md`
- Modify: `plugins/cue/commands/cue-reload.md`
- Modify: `plugins/cue/commands/cue-current.md`
- Modify: `plugins/cue/commands/cue-skills.md`
- Modify: `plugins/cue/commands/cue-mcps.md`
- Create: `src/commands/plugin-commands.test.ts`

**Interfaces:**
- Consumes: the `cue setup` command name from Task 7.
- Produces: nothing later tasks depend on in code. Task 12 checks `/cue-setup`
  appears in a live session.

- [ ] **Step 1: Write the failing test**

Create `src/commands/plugin-commands.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CMD_DIR = join(import.meta.dir, "..", "..", "plugins", "cue", "commands");

describe("plugin slash commands", () => {
  test("cue-setup exists and delegates to the CLI rather than reimplementing", () => {
    const md = readFileSync(join(CMD_DIR, "cue-setup.md"), "utf8");
    expect(md).toContain("npm install -g cue-ai");
    expect(md).toContain("cue setup");
  });

  test("every other command tells the user how to recover when cue is absent", () => {
    const others = readdirSync(CMD_DIR).filter(f => f.endsWith(".md") && f !== "cue-setup.md");
    expect(others.length).toBe(6);
    for (const f of others) {
      const md = readFileSync(join(CMD_DIR, f), "utf8");
      // Without this, a marketplace install ends in a raw `command not found`.
      expect(md).toContain("/cue-setup");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/commands/plugin-commands.test.ts`
Expected: FAIL — `cue-setup.md` does not exist.

- [ ] **Step 3: Create `/cue-setup`**

Create `plugins/cue/commands/cue-setup.md`:

```markdown
---
description: Install cue and pin a profile to this project — the one-command setup
---

Set up cue for this machine and this directory. Work through these steps in
order, and stop to report if any step fails.

1. Check whether the CLI is present: run `command -v cue` via Bash. If it exits
   non-zero, tell the user cue is not installed yet and ask permission to run
   `npm install -g cue-ai`. Do not install without an explicit yes.

2. Once `cue` resolves, run `cue setup` via Bash. It is interactive: it scans the
   project, suggests a profile, shows the token budget for that profile against
   loading everything, then asks before installing the `~/.local/bin` shim that
   makes `claude` load profiles. Relay its prompts to the user and pass their
   answers back.

3. `cue setup` prints its own PATH guidance when the shim directory is not on
   PATH, including the exact line to add. Surface that verbatim — the shims do
   nothing until it is fixed.

4. Finish by reporting which profile was pinned and whether the shim is active.
   Mention that the shim is undone with `install.sh --uninstall`.

Do not reimplement any of this flow yourself — `cue setup` is the single source
of truth for it, and the same flow runs for users who install from npm.
```

- [ ] **Step 4: Add the precondition line to the other six commands**

For each of `cue.md`, `cue-switch.md`, `cue-reload.md`, `cue-current.md`,
`cue-skills.md`, `cue-mcps.md`, append this paragraph at the end of the body,
below the existing instructions:

```markdown

Before running any `cue` command, check `command -v cue`. If it exits non-zero,
stop and tell the user: "cue isn't installed yet — run `/cue-setup` first." Do
not surface a raw `command not found`.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test src/commands/plugin-commands.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add plugins/cue/commands/ src/commands/plugin-commands.test.ts
git commit -m "feat(plugin): /cue-setup entry point + CLI preconditions"
```

---

### Task 10: README restructure

The problem is order, not length: roughly 80 lines of argument precede the first
command, Install offers four paths in a table, and the marketplace API section —
a power-user topic — sits above the shell setup.

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: `CLAIM` from Task 1, the `cue setup` command from Task 7.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Replace the hero block**

Replace `README.md` lines 3-5 (the `# cuecards` heading and the bold subtitle)
with:

```markdown
# cuecards

**Your agent reads every skill you own, on every message. cue loads only the ones that project needs.**
```

- [ ] **Step 2: Move the install command above the argument**

Immediately after the badge block and the nav line — before `## Why this exists` —
insert:

```markdown
## Install

```bash
npm install -g cue-ai && cue setup
```

`cue setup` installs the `claude`/`codex` shim, scans this project, shows what
the matching profile costs against loading everything, and pins it. Requires
Node ≥ 20 and an existing [Claude Code](https://github.com/anthropics/claude-code)
or [Codex](https://github.com/openai/codex) install — cue is a thin shim that
hands off to your real agent, not a replacement for it.

Three things happen when you type `claude` afterwards:

1. The shim resolves this directory's `.cue.profile`.
2. cue materializes only that profile's skills, MCPs, and persona into a runtime.
3. The real Claude Code binary starts against it.

<details>
<summary>Other install paths (script, clone, guided)</summary>

| Path | Command |
|---|---|
| One-line script | `curl -fsSL https://raw.githubusercontent.com/opencue/cuecards/main/get.sh \| bash` |
| Manual clone | `git clone https://github.com/opencue/cuecards.git && ./cuecards/install.sh` |
| Guided (paste into Claude Code) | [setup/macos.md](https://github.com/opencue/cuecards/blob/main/setup/macos.md) · [setup/linux.md](https://github.com/opencue/cuecards/blob/main/setup/linux.md) · [setup/windows.md](https://github.com/opencue/cuecards/blob/main/setup/windows.md) |

All paths are idempotent — safe to re-run. `install.sh --help` lists `--yes`,
`--codex`, `--uninstall`.

</details>

---
```

- [ ] **Step 3: Delete the old Install and Quickstart sections**

Remove the original `## Install` section (its four-path table and the paragraph
under it) and the `### Quickstart` section (the five-command block and the two
paragraphs following it) from their old position further down the file. The
content that survives from Quickstart is the profile-pinning example, which
moves up directly under the new Install section:

```markdown
Pin a different project to a different profile:

```bash
cd ~/projects/my-shop
cue use medusa-dev      # writes .cue.profile in this directory
claude                  # launches with the medusa-dev loadout
```

Not sure which fits? `cue auto-detect` reads your project (package.json,
pyproject.toml, Cargo.toml, …) and suggests one.
```

- [ ] **Step 4: Verify order and that nothing else was lost**

Run: `rg -n "^#{2} " README.md`
Expected order of `##` headings: `Install`, `Why this exists`, `What is a
cuecard?`, `How it works`, `85 ready-made cuecards`, `One cuecard, ten agents`,
`Built-in rigor`, `Everyday commands`, `API`, `Shell setup`, `FAQ`, `How it
compares`, `Deep dives`, `Contributing`.
Confirm exactly one `## Install` and no `### Quickstart`.

- [ ] **Step 5: Run the fact test**

Run: `bun test src/commands/docs-facts.test.ts`
Expected: PASS — the README is one of the surfaces it guards.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs(readme): one install command above the fold"
```

---

### Task 11: Move power-user sections out of the README

**Files:**
- Create: `docs/marketplace-api.md`
- Create: `docs/shell-setup.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the README structure from Task 10.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Move the API section**

Cut the entire `## API` section from `README.md` (from the `## API` heading
through to just before `## Shell setup`) and paste it into a new
`docs/marketplace-api.md` under this header:

```markdown
# Marketplace API

Publishing profiles, skills, and MCPs to cuecards.cc from your own machine.
Not needed to use cue — see the [README](../README.md) to get started.

```

- [ ] **Step 2: Move the Shell setup section**

Cut the entire `## Shell setup` section from `README.md` (from the heading
through to just before `## FAQ`) and paste it into a new `docs/shell-setup.md`
under this header:

```markdown
# Shell setup internals

How the `claude`/`codex` shims work, per shell. `cue setup` does all of this for
you — this page is for debugging or doing it by hand.

```

- [ ] **Step 3: Add the links back**

In `README.md`, in the `## Deep dives` section, add these two bullets:

```markdown
- [Marketplace API](https://github.com/opencue/cuecards/blob/main/docs/marketplace-api.md) — publish profiles, skills, and MCPs with an API token
- [Shell setup internals](https://github.com/opencue/cuecards/blob/main/docs/shell-setup.md) — how the shims work, per shell
```

- [ ] **Step 4: Verify the sections moved, not vanished**

Run: `rg -c "cue marketplace login" docs/marketplace-api.md && rg -n "^## (API|Shell setup)$" README.md`
Expected: a non-zero count from the first command, and no hits from the second.

- [ ] **Step 5: Run the full suite and lint**

Run: `bun test && bun run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/marketplace-api.md docs/shell-setup.md
git commit -m "docs(readme): move API and shell internals to docs/"
```

---

### Task 12: Manual verification and the two out-of-band surfaces

Two things in this plan cannot be verified by a test: whether Claude Code
actually accepts the marketplace manifest, and the two surfaces that live
outside the repo. The manifest-location and dropped-`commands[]` decisions were
inferred from plugins installed on this machine, not from published schema docs —
this task is where that inference gets confirmed, cheaply, before anything is
announced.

**Files:**
- No repo files. This task produces a verification report and two external changes.

**Interfaces:**
- Consumes: `.claude-plugin/marketplace.json` (Task 3),
  `plugins/cue/.claude-plugin/plugin.json` (Task 2),
  `plugins/cue/commands/cue-setup.md` (Task 9).
- Produces: confirmation, or a defect report against Tasks 2/3.

- [ ] **Step 1: Add the local repo as a marketplace**

In a live Claude Code session, run:

```
/plugin marketplace add /home/deadpool/Documents/cue
```

Expected: the `cuecards` marketplace registers without error. If it rejects the
file, the manifest shape is wrong — stop and fix Task 3 before continuing.

- [ ] **Step 2: Install the plugin**

```
/plugin install cue@cuecards
```

Expected: installs without error.

- [ ] **Step 3: Confirm all six commands are present**

Run `/help` (or open the slash-command list) and confirm these appear:
`/cue-setup`, `/cue`, `/cue-switch`, `/cue-reload`, `/cue-current`, `/cue-skills`,
`/cue-mcps`.

If the commands are missing, the dropped `commands[]` array was load-bearing
after all — restore it in `plugins/cue/.claude-plugin/plugin.json` and update
the assertion in `src/commands/positioning.test.ts` that requires
`manifest.commands` to be undefined.

- [ ] **Step 4: Update the GitHub About and topics**

Set the repo About field to the descriptor:

```
Per-project profile manager for Claude Code, Codex, and 8 other AI coding agents — scopes which skills and MCP servers load, per directory.
```

Then run the topics script, which Task 4 repointed at the correct repo:

```bash
DRY_RUN=1 bash scripts/update-repo-topics.sh   # review first
bash scripts/update-repo-topics.sh
```

- [ ] **Step 5: Regenerate the OG card**

`docs/assets/og-card.png` is a binary asset with no generator script in
`scripts/`, so this step needs an image tool. The card must carry the claim:

```
Your agent reads every skill you own, on every message.
cue loads only the ones that project needs.
```

Keep the filename `og-card.png` — `docs/index.md` front matter references it by
that exact name.

- [ ] **Step 6: Report**

Write a short summary of what passed, what failed, and any defect filed against
Tasks 2 or 3. Nothing is announced on any channel until Steps 1-3 pass.

---

## What this plan deliberately does not do

- **It does not measure whether discovery improved.** That is npm downloads and
  star delta over weeks. This removes three blockers; measuring the effect is
  separate work.
- **No Show HN, no Reddit, no awesome-list PRs are filed.** The playbook in
  `docs/marketing/` stays unexecuted until the positioning it depends on has
  shipped. Show HN fires once.
- **The discover engine is untouched.** Nightly scan, `docs/discovered.md`, and
  the per-profile pages keep running exactly as they do.
- **The plugin ships no skill.** Having the agent proactively suggest cue was
  considered and cut — it is the nagging pattern users resent.
