# cue — agent profile manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the existing `soul` CLI into `cue`: an agent profile manager that owns the launch boundary for both Claude Code and Codex. Bare `claude` / `codex` opens a profile picker (first use per cwd), and the chosen profile materializes a fully isolated `CLAUDE_CONFIG_DIR` / `CODEX_HOME` before exec.

**Architecture:** Bun CLI with four internal modules — `cwd-resolver` (cwd → profile name), `picker` (TUI), `runtime-materializer` (write per-profile config dir with content-hash short-circuit + atomic swap), and `launch` (the hot-path orchestrator). Shim binaries in `~/.local/bin/{claude,codex}` exec `cue launch <agent>`. A `plugins/cue/` Claude Code plugin provides in-session `/cue`, `/cue switch`, `/cue reload`, `/cue current` slash commands. Existing libs (`profile-loader`, `mcp-materializer`, `profile-generator`, `profile-linter`) plug in unchanged.

**Tech Stack:** Bun + TypeScript, `yaml`, `ajv`, `@clack/prompts` (TUI), Node `fs/promises`, `node:crypto` for sha256. Tests via `bun test`.

**Source spec:** `docs/superpowers/specs/2026-05-22-cue-agent-profile-manager-design.md`

---

## Pre-flight: this repo is not a git repo

`/home/deadpool/Documents/soul/.git` is an empty directory. We need a real repo before any of this is safe to land. **Task 1 inits git.** If you (the human reviewer) want to skip git tracking entirely, replace Task 1 with `touch .nogit` and skip every `git commit` step in subsequent tasks — but the plan assumes git is in place.

## Task ordering

The rename `soul/ → cue/` is the final cosmetic step (Task 11), not the first. All implementation work happens under the current `soul/` name; only after the materializer, launch flow, shims, and `migrate-symlinks` tool are proven do we flip the project name. This avoids two-phase rewrites and gives `migrate-symlinks` a clean cwd to operate against.

The internal reorg `bin/cli/ → src/` and `skills/+mcps/+claude-plugins-official/ → resources/` is Task 10, immediately before the rename. New modules in Tasks 3–9 land under `bin/cli/lib/` and `bin/cli/commands/` (the existing paths). Task 10 moves them along with everything else.

---

## Task 1: Initialize git, baseline commit, tag `pre-cue`

**Files:**
- Modify: `/home/deadpool/Documents/soul/.git/` (replace empty dir with real repo)
- Create: `.gitignore` (extend existing if present)
- Create: tag `pre-cue` (annotated)

- [ ] **Step 1: Remove the empty .git stub and verify**

```bash
cd /home/deadpool/Documents/soul
rmdir .git 2>/dev/null || true
ls -la .git 2>&1
```

Expected: `ls: cannot access '.git': No such file or directory`. If something other than an empty dir is there, stop and investigate.

- [ ] **Step 2: Init git and configure**

```bash
cd /home/deadpool/Documents/soul
git init -b main
git config user.name "$(git config --global user.name)"
git config user.email "$(git config --global user.email)"
```

Expected: `Initialized empty Git repository in /home/deadpool/Documents/soul/.git/`.

- [ ] **Step 3: Write .gitignore**

```bash
cd /home/deadpool/Documents/soul
cat > .gitignore <<'EOF'
# Dependencies
node_modules/
bun.lock.bak

# Profile runtime / cache
profiles/_active
profiles/_cache/

# Editor / OS
.DS_Store
*.swp
.idea/
.vscode/

# Cloned marketplace (not part of this repo)
claude-plugins-official/

# Generated runtime (lives at ~/.config/cue/ but excluded if symlinked in for inspection)
.cue-hash
EOF
```

- [ ] **Step 4: Initial commit**

```bash
cd /home/deadpool/Documents/soul
git add -A
git status --short | head -20
```

Inspect the status output. You should see hundreds of files staged. If `node_modules/` or `claude-plugins-official/` appear, the gitignore is wrong — stop and fix.

```bash
cd /home/deadpool/Documents/soul
git commit -m "chore: initialize git baseline (soul pre-cue rename)"
```

Expected: a commit hash printed.

- [ ] **Step 5: Tag the baseline**

```bash
cd /home/deadpool/Documents/soul
git tag -a pre-cue -m "Baseline before cue rename + profile manager launch flow"
git tag --list
```

Expected output includes `pre-cue`.

- [ ] **Step 6: Verify clean state**

```bash
cd /home/deadpool/Documents/soul
git status
```

Expected: `nothing to commit, working tree clean`.

---

## Task 2: Schema delta — promote `plugins:` to top-level, add per-resource `agents:` override

**Files:**
- Modify: `profiles/schema.json`
- Modify: `profiles/_types.ts`
- Modify: `bin/cli/lib/profile-loader.ts`
- Create: `bin/cli/lib/profile-loader.schema-delta.test.ts`

- [ ] **Step 1: Write failing tests for new schema**

Create `bin/cli/lib/profile-loader.schema-delta.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadProfile } from "./profile-loader";

async function fixture(yaml: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cue-schema-"));
  await mkdir(join(dir, "frontend"), { recursive: true });
  await writeFile(join(dir, "frontend", "profile.yaml"), yaml);
  process.env.SOUL_PROFILES_DIR = dir;
  return dir;
}

describe("schema delta", () => {
  test("accepts top-level plugins with marketplace qualifier", async () => {
    await fixture(`
name: frontend
description: Frontend work
plugins:
  - frontend-design@claude-plugins-official
  - superpowers@claude-plugins-official
`);
    const p = await loadProfile("frontend");
    expect(p.plugins).toEqual([
      "frontend-design@claude-plugins-official",
      "superpowers@claude-plugins-official",
    ]);
  });

  test("rejects top-level plugins entry without @marketplace", async () => {
    await fixture(`
name: frontend
description: Frontend work
plugins:
  - frontend-design
`);
    expect(loadProfile("frontend")).rejects.toThrow(/marketplace/i);
  });

  test("accepts per-resource agents override (object form)", async () => {
    await fixture(`
name: frontend
description: Frontend work
mcps:
  - id: medusadocs
    agents: [claude-code]
  - claude-mem
`);
    const p = await loadProfile("frontend");
    expect(p.mcps).toEqual([
      { id: "medusadocs", agents: ["claude-code"] },
      { id: "claude-mem" },
    ]);
  });

  test("normalizes plain-string mcps to object form internally", async () => {
    await fixture(`
name: frontend
description: Frontend work
mcps:
  - claude-mem
`);
    const p = await loadProfile("frontend");
    expect(p.mcps[0]).toEqual({ id: "claude-mem" });
  });
});
```

- [ ] **Step 2: Run tests, expect 4 failures**

```bash
cd /home/deadpool/Documents/soul
bun test bin/cli/lib/profile-loader.schema-delta.test.ts
```

Expected: 4 fail (validator hasn't been updated yet).

- [ ] **Step 3: Update profiles/schema.json**

Open `profiles/schema.json`. Add to the top-level `properties`:

```json
    "plugins": {
      "type": "array",
      "description": "Claude Code plugin enablements as <plugin>@<marketplace>.",
      "items": {
        "type": "string",
        "pattern": "^[a-z0-9][a-z0-9-]*@[a-z0-9][a-z0-9_-]*$"
      },
      "default": []
    },
```

Change the `mcps` definition from `array of string` to a union allowing object form:

```json
    "mcps": {
      "type": "array",
      "items": {
        "oneOf": [
          { "type": "string" },
          {
            "type": "object",
            "required": ["id"],
            "additionalProperties": false,
            "properties": {
              "id": { "type": "string" },
              "agents": {
                "type": "array",
                "items": { "enum": ["claude-code", "codex"] }
              }
            }
          }
        ]
      },
      "default": []
    },
```

Apply the same `oneOf` shape to `skills.local`, `skills.npx` (where the object form extends the existing `NpxSkillRef`), and the new `plugins` array.

- [ ] **Step 4: Update profiles/_types.ts**

Replace the `MCPRef`, `SkillRef`, `Profile`, `ResolvedProfile` declarations:

```typescript
export type AgentKind = "claude-code" | "codex";

export interface AgentScoped {
  agents?: AgentKind[];
}

// String form is sugar for { id: string }.
export type MCPRef = string | (AgentScoped & { id: string });

export type SkillRef = string | (AgentScoped & { id: string });

export interface NpxSkillRef extends AgentScoped {
  repo: string;
  pin?: string;
  skills: string[];
}

// Top-level plugin enablement. "<plugin>@<marketplace>".
export type PluginRef = string | (AgentScoped & { id: string });

export interface ProfileSkills {
  local?: SkillRef[];
  npx?: NpxSkillRef[];
  // NOTE: `plugins` was retired here in favor of top-level `plugins:`.
}

export interface Profile {
  name: string;
  description: string;
  agents?: AgentKind[];
  inherits?: string;
  skills?: ProfileSkills;
  mcps?: MCPRef[];
  plugins?: PluginRef[];
  env?: Record<string, string>;
}

// In the resolved (post-inherit) form every ref is normalized to its object shape.
export interface ResolvedMCP { id: string; agents?: AgentKind[]; }
export interface ResolvedSkill { id: string; agents?: AgentKind[]; }
export interface ResolvedPlugin { id: string; agents?: AgentKind[]; }

export interface ResolvedProfile extends Omit<Profile, "skills" | "mcps" | "plugins"> {
  agents: AgentKind[];
  skills: {
    local: ResolvedSkill[];
    npx: NpxSkillRef[];
  };
  mcps: ResolvedMCP[];
  plugins: ResolvedPlugin[];
  env: Record<string, string>;
  inheritanceChain: string[];
}
```

Keep all `ProfileError` subclasses unchanged.

- [ ] **Step 5: Update profile-loader.ts**

Find the merge function that consolidates inherited fields. Add normalization that converts string refs to `{ id }` objects, then dedupes by `id`. Add `plugins` to the merge surface alongside `mcps`. Reject `skills.plugins` with a clear error pointing at the new top-level `plugins:` field. The exact diff depends on the existing implementation — read `profile-loader.ts` first, find the inheritance merge block, and add the `plugins` array with the same dedup-by-id logic as `mcps`.

For consumers that previously read `profile.skills.plugins`, change to `profile.plugins`. Run `grep -rn "skills.plugins\|skills\.plugins" bin/ profiles/ docs/` and fix every hit — there should be ≤ 5.

- [ ] **Step 6: Run tests, expect pass**

```bash
cd /home/deadpool/Documents/soul
bun test bin/cli/lib/profile-loader.schema-delta.test.ts
bun test bin/cli/lib/profile-loader.test.ts
```

Expected: all pass. If `profile-loader.test.ts` regresses, fix the test where the old `skills.plugins` form is used — update it to the new top-level shape.

- [ ] **Step 7: Update existing profiles that used skills.plugins**

```bash
cd /home/deadpool/Documents/soul
grep -rln "^\s*plugins:" profiles/*/profile.yaml
```

For each file, move plugin entries from `skills.plugins:` to a top-level `plugins:` and add the `@<marketplace>` qualifier. The default marketplace is `claude-plugins-official`. Commit each profile edit individually if there are many.

- [ ] **Step 8: Commit**

```bash
cd /home/deadpool/Documents/soul
git add profiles/schema.json profiles/_types.ts bin/cli/lib/profile-loader.ts bin/cli/lib/profile-loader.schema-delta.test.ts profiles/*/profile.yaml
git commit -m "feat(schema): top-level plugins + per-resource agents override

Promotes skills.plugins to a top-level plugins: field with <plugin>@<marketplace>
qualifier so the runtime materializer can write Claude Code enabledPlugins
verbatim. Adds object form { id, agents } for mcps/skills/plugins entries so a
single profile can scope a resource to claude-code only or codex only."
```

---

## Task 3: `cwd-resolver` — cwd → profile name

**Files:**
- Create: `bin/cli/lib/cwd-resolver.ts`
- Create: `bin/cli/lib/cwd-resolver.test.ts`

- [ ] **Step 1: Write failing test**

Create `bin/cli/lib/cwd-resolver.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveProfileForCwd } from "./cwd-resolver";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cue-resolver-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("resolveProfileForCwd", () => {
  test("returns null when nothing pinned and no defaults set", async () => {
    const out = await resolveProfileForCwd({
      cwd: root,
      homeDir: root,
      configDir: join(root, ".config", "cue"),
    });
    expect(out).toEqual({ source: "none" });
  });

  test("reads .cue.profile in cwd", async () => {
    await writeFile(join(root, ".cue.profile"), "frontend\n");
    const out = await resolveProfileForCwd({
      cwd: root,
      homeDir: root,
      configDir: join(root, ".config", "cue"),
    });
    expect(out).toEqual({ source: "pin-file", profile: "frontend", pinPath: join(root, ".cue.profile") });
  });

  test("walks up to find .cue.profile", async () => {
    await writeFile(join(root, ".cue.profile"), "backend\n");
    const child = join(root, "a", "b", "c");
    await mkdir(child, { recursive: true });
    const out = await resolveProfileForCwd({
      cwd: child,
      homeDir: root,
      configDir: join(root, ".config", "cue"),
    });
    expect(out).toEqual({ source: "pin-file", profile: "backend", pinPath: join(root, ".cue.profile") });
  });

  test("stops walking at homeDir", async () => {
    await writeFile(join(root, ".cue.profile"), "should-not-find");
    const home = join(root, "home");
    const child = join(home, "user");
    await mkdir(child, { recursive: true });
    const out = await resolveProfileForCwd({
      cwd: child,
      homeDir: home,
      configDir: join(home, ".config", "cue"),
    });
    expect(out.source).toBe("none");
  });

  test("falls back to repo-defaults.json keyed by git repo root", async () => {
    const repo = join(root, "repo");
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(join(root, ".config", "cue"), { recursive: true });
    await writeFile(
      join(root, ".config", "cue", "repo-defaults.json"),
      JSON.stringify({ [repo]: "research" }),
    );
    const out = await resolveProfileForCwd({
      cwd: repo,
      homeDir: root,
      configDir: join(root, ".config", "cue"),
    });
    expect(out).toEqual({ source: "repo-default", profile: "research" });
  });

  test("falls back to default-profile file", async () => {
    await mkdir(join(root, ".config", "cue"), { recursive: true });
    await writeFile(join(root, ".config", "cue", "default-profile"), "core\n");
    const out = await resolveProfileForCwd({
      cwd: root,
      homeDir: root,
      configDir: join(root, ".config", "cue"),
    });
    expect(out).toEqual({ source: "global-default", profile: "core" });
  });

  test("--cue-profile flag (passed via override) wins over everything", async () => {
    await writeFile(join(root, ".cue.profile"), "frontend");
    const out = await resolveProfileForCwd({
      cwd: root,
      homeDir: root,
      configDir: join(root, ".config", "cue"),
      override: "backend",
    });
    expect(out).toEqual({ source: "flag", profile: "backend" });
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd /home/deadpool/Documents/soul
bun test bin/cli/lib/cwd-resolver.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement cwd-resolver.ts**

```typescript
/**
 * cwd-resolver — given a working directory, find the profile cue should use.
 *
 * Resolution precedence (stop at first hit):
 *   1. `opts.override` (matches the --cue-profile CLI flag)
 *   2. `.cue.profile` file walking up from cwd; stops at git repo root or homeDir
 *   3. `<configDir>/repo-defaults.json` keyed by git repo root absolute path
 *   4. `<configDir>/default-profile` (single-line file)
 *   5. none — caller should open the picker
 *
 * Pure: only reads files under cwd and configDir. Never writes.
 */

import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type ResolveResult =
  | { source: "flag"; profile: string }
  | { source: "pin-file"; profile: string; pinPath: string }
  | { source: "repo-default"; profile: string }
  | { source: "global-default"; profile: string }
  | { source: "none" };

export interface ResolveOptions {
  cwd: string;
  homeDir: string;
  configDir: string;
  override?: string | null;
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

async function findUpward(startDir: string, fileName: string, stopAt: string): Promise<string | null> {
  let dir = resolve(startDir);
  const stop = resolve(stopAt);
  while (true) {
    const candidate = join(dir, fileName);
    if (await exists(candidate)) return candidate;
    if (dir === stop) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function findGitRoot(startDir: string, stopAt: string): Promise<string | null> {
  let dir = resolve(startDir);
  const stop = resolve(stopAt);
  while (true) {
    if (await exists(join(dir, ".git"))) return dir;
    if (dir === stop) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function resolveProfileForCwd(opts: ResolveOptions): Promise<ResolveResult> {
  if (opts.override) return { source: "flag", profile: opts.override };

  const pinPath = await findUpward(opts.cwd, ".cue.profile", opts.homeDir);
  if (pinPath) {
    const profile = (await readFile(pinPath, "utf8")).trim();
    if (profile) return { source: "pin-file", profile, pinPath };
  }

  const repoRoot = await findGitRoot(opts.cwd, opts.homeDir);
  if (repoRoot) {
    const repoDefaultsPath = join(opts.configDir, "repo-defaults.json");
    if (await exists(repoDefaultsPath)) {
      const map = JSON.parse(await readFile(repoDefaultsPath, "utf8")) as Record<string, string>;
      const profile = map[repoRoot];
      if (profile) return { source: "repo-default", profile };
    }
  }

  const defaultPath = join(opts.configDir, "default-profile");
  if (await exists(defaultPath)) {
    const profile = (await readFile(defaultPath, "utf8")).trim();
    if (profile) return { source: "global-default", profile };
  }

  return { source: "none" };
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd /home/deadpool/Documents/soul
bun test bin/cli/lib/cwd-resolver.test.ts
```

Expected: 7 pass.

- [ ] **Step 5: Commit**

```bash
cd /home/deadpool/Documents/soul
git add bin/cli/lib/cwd-resolver.ts bin/cli/lib/cwd-resolver.test.ts
git commit -m "feat(cwd-resolver): walk-up .cue.profile + repo/global defaults"
```

---

## Task 4: `picker` — TUI for first-launch profile selection

**Files:**
- Modify: `package.json` (add @clack/prompts)
- Create: `bin/cli/lib/picker.ts`
- Create: `bin/cli/lib/picker.test.ts`

- [ ] **Step 1: Add the dep**

```bash
cd /home/deadpool/Documents/soul
bun add @clack/prompts
```

Expected: `package.json` updated, lockfile changed.

- [ ] **Step 2: Write failing test**

Create `bin/cli/lib/picker.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";

import { renderProfileList, type PickerOption } from "./picker";

describe("renderProfileList", () => {
  test("formats option label and description", () => {
    const opts: PickerOption[] = [
      { value: "frontend", label: "frontend", hint: "Frontend UI work" },
      { value: "backend", label: "backend", hint: "API/server work" },
    ];
    const rendered = renderProfileList(opts, { cwd: "/tmp/proj" });
    expect(rendered).toContain("cue · pick a profile");
    expect(rendered).toContain("/tmp/proj");
    expect(rendered).toContain("frontend");
    expect(rendered).toContain("Frontend UI work");
    expect(rendered).toContain("backend");
  });

  test("includes special entries for new profile and details", () => {
    const opts: PickerOption[] = [
      { value: "frontend", label: "frontend", hint: "Frontend UI work" },
    ];
    const rendered = renderProfileList(opts, { cwd: "/tmp/proj", includeFooter: true });
    expect(rendered).toMatch(/new profile from this cwd/);
    expect(rendered).toMatch(/details \(d\)/);
    expect(rendered).toMatch(/pick once, no pin \(n\)/);
  });
});
```

`renderProfileList` is a pure function returning the rendered string so we can test layout without spawning a terminal. The interactive flow lives in `runPicker()` which we'll smoke manually.

- [ ] **Step 3: Run test, expect fail**

```bash
cd /home/deadpool/Documents/soul
bun test bin/cli/lib/picker.test.ts
```

Expected: module not found.

- [ ] **Step 4: Implement picker.ts**

```typescript
/**
 * picker — interactive profile chooser.
 *
 * Two surfaces:
 *   - renderProfileList(): pure formatter (testable)
 *   - runPicker(): interactive TUI driven by @clack/prompts; opens stdin/stdout
 *
 * Picker writes the chosen profile to ./.cue.profile unless --no-pin is passed.
 * Cancel (esc / Ctrl-C) → exit code 130 (caller handles).
 */

import * as p from "@clack/prompts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface PickerOption {
  value: string;
  label: string;
  hint: string;
}

export interface RenderOptions {
  cwd: string;
  includeFooter?: boolean;
}

export function renderProfileList(opts: PickerOption[], render: RenderOptions): string {
  const lines: string[] = [];
  lines.push(`▍cue · pick a profile for ${render.cwd}`);
  lines.push("");
  for (const opt of opts) {
    lines.push(`  ${opt.label.padEnd(14)} ${opt.hint}`);
  }
  if (render.includeFooter !== false) {
    lines.push("  ─────");
    lines.push("  + new profile from this cwd...");
    lines.push("  ⓘ details (d) · pick once, no pin (n) · cancel (esc)");
  }
  return lines.join("\n");
}

export interface PickerInput {
  cwd: string;
  options: PickerOption[];
  /** Skip writing .cue.profile if true. */
  noPin?: boolean;
}

export interface PickerOutput {
  profile: string;
  pinned: boolean;
}

export async function runPicker(input: PickerInput): Promise<PickerOutput> {
  p.intro(`cue · pick a profile for ${input.cwd}`);

  const choice = await p.select({
    message: "Profile",
    options: input.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
  });

  if (p.isCancel(choice)) {
    p.cancel("cancelled");
    process.exit(130);
  }

  let pinned = false;
  if (!input.noPin) {
    const pinChoice = await p.confirm({ message: "Pin to this directory?", initialValue: true });
    if (p.isCancel(pinChoice)) {
      p.cancel("cancelled");
      process.exit(130);
    }
    if (pinChoice === true) {
      await writeFile(join(input.cwd, ".cue.profile"), `${choice}\n`);
      pinned = true;
    }
  }

  p.outro(`profile: ${choice}${pinned ? " (pinned)" : ""}`);
  return { profile: choice as string, pinned };
}
```

- [ ] **Step 5: Run tests, expect pass**

```bash
cd /home/deadpool/Documents/soul
bun test bin/cli/lib/picker.test.ts
```

Expected: 2 pass.

- [ ] **Step 6: Commit**

```bash
cd /home/deadpool/Documents/soul
git add package.json bun.lock bin/cli/lib/picker.ts bin/cli/lib/picker.test.ts
git commit -m "feat(picker): @clack/prompts-driven TUI for profile selection"
```

---

## Task 5: `runtime-materializer` — write per-profile CLAUDE_CONFIG_DIR / CODEX_HOME

**Files:**
- Create: `bin/cli/lib/runtime-materializer.ts`
- Create: `bin/cli/lib/runtime-materializer.test.ts`

This is the heaviest module. It consumes a `ResolvedProfile`, produces a directory under `~/.config/cue/runtime/<profile>/<agent>/`, with content-hash short-circuit and atomic swap. It composes the existing `mcp-materializer` and skill resolvers.

- [ ] **Step 1: Write failing tests**

Create `bin/cli/lib/runtime-materializer.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, stat, rm, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { materializeRuntime } from "./runtime-materializer";
import type { ResolvedProfile } from "../../../profiles/_types";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "cue-runtime-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const sampleProfile: ResolvedProfile = {
  name: "test-frontend",
  description: "test",
  agents: ["claude-code"],
  skills: {
    local: [{ id: "design/ui-ux-pro-max" }],
    npx: [],
  },
  mcps: [{ id: "claude-mem" }],
  plugins: [{ id: "frontend-design@claude-plugins-official" }],
  env: {},
  inheritanceChain: ["test-frontend"],
};

describe("materializeRuntime", () => {
  test("creates runtime dir with hash and settings.json", async () => {
    const out = await materializeRuntime({
      profile: sampleProfile,
      agent: "claude-code",
      runtimeRoot: join(root, "runtime"),
      // tests stub these so we don't need real skills/mcps on disk
      skillSourceLookup: async (id) => `/fake/skills/${id}`,
      mcpRegistry: { "claude-mem": { command: "claude-mem", args: [] } },
      userClaudeMd: "# user CLAUDE.md\n",
    });

    expect(out.runtimeDir).toBe(join(root, "runtime", "test-frontend", "claude"));
    expect(out.rebuilt).toBe(true);

    const settings = JSON.parse(await readFile(join(out.runtimeDir, "settings.json"), "utf8"));
    expect(settings.enabledPlugins).toEqual({ "frontend-design@claude-plugins-official": true });
    expect(settings.mcpServers).toEqual({ "claude-mem": { command: "claude-mem", args: [] } });

    const claudemd = await readFile(join(out.runtimeDir, "CLAUDE.md"), "utf8");
    expect(claudemd).toMatch(/^# cue profile: test-frontend/);
    expect(claudemd).toContain("# user CLAUDE.md");

    const hash = await readFile(join(out.runtimeDir, ".cue-hash"), "utf8");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("second call with same profile is a no-op (rebuilt=false)", async () => {
    const args = {
      profile: sampleProfile,
      agent: "claude-code" as const,
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id: string) => `/fake/skills/${id}`,
      mcpRegistry: { "claude-mem": { command: "claude-mem", args: [] } },
      userClaudeMd: "# user CLAUDE.md\n",
    };
    const first = await materializeRuntime(args);
    expect(first.rebuilt).toBe(true);
    const second = await materializeRuntime(args);
    expect(second.rebuilt).toBe(false);
  });

  test("re-materializes when profile content changes", async () => {
    const args = {
      profile: sampleProfile,
      agent: "claude-code" as const,
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id: string) => `/fake/skills/${id}`,
      mcpRegistry: { "claude-mem": { command: "claude-mem", args: [] } },
      userClaudeMd: "# user CLAUDE.md\n",
    };
    await materializeRuntime(args);

    const changed: ResolvedProfile = {
      ...sampleProfile,
      plugins: [{ id: "vercel@claude-plugins-official" }],
    };
    const second = await materializeRuntime({ ...args, profile: changed });
    expect(second.rebuilt).toBe(true);
  });

  test("symlinks every local skill into <runtime>/skills/", async () => {
    const out = await materializeRuntime({
      profile: sampleProfile,
      agent: "claude-code",
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id) => `/fake/source/${id}`,
      mcpRegistry: {},
      userClaudeMd: "",
    });
    const link = await readlink(join(out.runtimeDir, "skills", "design", "ui-ux-pro-max"));
    expect(link).toBe("/fake/source/design/ui-ux-pro-max");
  });

  test("excludes resources whose agents list does not include current agent", async () => {
    const filtered: ResolvedProfile = {
      ...sampleProfile,
      mcps: [
        { id: "codex-only", agents: ["codex"] },
        { id: "claude-mem" },
      ],
    };
    const out = await materializeRuntime({
      profile: filtered,
      agent: "claude-code",
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id) => `/fake/source/${id}`,
      mcpRegistry: { "codex-only": {}, "claude-mem": { command: "claude-mem" } },
      userClaudeMd: "",
    });
    const settings = JSON.parse(await readFile(join(out.runtimeDir, "settings.json"), "utf8"));
    expect(Object.keys(settings.mcpServers)).toEqual(["claude-mem"]);
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

```bash
cd /home/deadpool/Documents/soul
bun test bin/cli/lib/runtime-materializer.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement runtime-materializer.ts**

```typescript
/**
 * runtime-materializer — produce a per-profile config dir under
 *   ~/.config/cue/runtime/<profile>/{claude,codex}/
 * with content-hash short-circuit and atomic swap.
 *
 * Pure surface; callers inject filesystem and registry dependencies so this
 * module can be tested without touching ~/.claude or ~/.codex.
 */

import { createHash } from "node:crypto";
import { mkdir, rename, rm, symlink, writeFile, readFile, mkdtemp } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { AgentKind, ResolvedProfile } from "../../../profiles/_types";

export interface MaterializeInput {
  profile: ResolvedProfile;
  agent: AgentKind;
  runtimeRoot: string;
  /** Map skill id → source dir on disk (caller resolves local/npx/plugin paths). */
  skillSourceLookup: (id: string) => Promise<string>;
  /** Pre-resolved sanitized MCP registry for this agent. */
  mcpRegistry: Record<string, unknown>;
  /** Content of ~/.claude/CLAUDE.md (or ~/.codex/AGENTS.md) to append. */
  userClaudeMd: string;
}

export interface MaterializeOutput {
  runtimeDir: string;
  rebuilt: boolean;
  hash: string;
}

function agentSubdir(agent: AgentKind): string {
  return agent === "claude-code" ? "claude" : "codex";
}

function appliesToAgent(scoped: { agents?: AgentKind[] }, agent: AgentKind): boolean {
  if (!scoped.agents || scoped.agents.length === 0) return true;
  return scoped.agents.includes(agent);
}

function computeHash(profile: ResolvedProfile, agent: AgentKind): string {
  const canonical = JSON.stringify({ profile, agent }, Object.keys({ profile, agent }).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

export async function materializeRuntime(input: MaterializeInput): Promise<MaterializeOutput> {
  const { profile, agent, runtimeRoot } = input;
  const runtimeDir = join(runtimeRoot, profile.name, agentSubdir(agent));
  const hash = computeHash(profile, agent);

  // Short-circuit if hash matches.
  try {
    const existing = (await readFile(join(runtimeDir, ".cue-hash"), "utf8")).trim();
    if (existing === hash) return { runtimeDir, rebuilt: false, hash };
  } catch {/* not present — fall through to build */}

  // Build in a sibling tmp dir, atomic-swap at the end.
  await mkdir(dirname(runtimeDir), { recursive: true });
  const tmpDir = await mkdtemp(`${runtimeDir}.tmp.`);

  // 1. Skills
  const skillsDir = join(tmpDir, "skills");
  await mkdir(skillsDir, { recursive: true });
  for (const skill of profile.skills.local) {
    if (!appliesToAgent(skill, agent)) continue;
    const src = await input.skillSourceLookup(skill.id);
    const target = join(skillsDir, skill.id);
    await mkdir(dirname(target), { recursive: true });
    await symlink(src, target);
  }

  // 2. settings.json (Claude) or config.toml (Codex) — Claude-only first cut.
  const enabledPlugins: Record<string, true> = {};
  for (const plugin of profile.plugins) {
    if (!appliesToAgent(plugin, agent)) continue;
    enabledPlugins[plugin.id] = true;
  }
  const mcpServers: Record<string, unknown> = {};
  for (const m of profile.mcps) {
    if (!appliesToAgent(m, agent)) continue;
    const reg = input.mcpRegistry[m.id];
    if (reg !== undefined) mcpServers[m.id] = reg;
  }
  if (agent === "claude-code") {
    const settings = { enabledPlugins, mcpServers };
    await writeFile(join(tmpDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n");
  } else {
    // Codex equivalent — write config.toml from registry. Caller pre-renders to TOML.
    await writeFile(join(tmpDir, "config.toml"), tomlRender({ mcp_servers: mcpServers }));
  }

  // 3. CLAUDE.md with stamp
  const stamp = `# cue profile: ${profile.name}\n` +
                `> ${profile.description}\n` +
                `> generated $(date) — do not hand-edit\n\n`;
  await writeFile(join(tmpDir, agent === "claude-code" ? "CLAUDE.md" : "AGENTS.md"), stamp + input.userClaudeMd);

  // 4. hash
  await writeFile(join(tmpDir, ".cue-hash"), hash + "\n");

  // 5. Atomic swap: rm -rf old, rename tmp.
  await rm(runtimeDir, { recursive: true, force: true });
  await rename(tmpDir, runtimeDir);

  return { runtimeDir, rebuilt: true, hash };
}

// Minimal TOML emitter for the MCP config block. Replace with `@iarna/toml` if
// we need broader coverage. Codex only reads a flat-ish [mcp_servers.<id>] table.
function tomlRender(obj: { mcp_servers: Record<string, unknown> }): string {
  const out: string[] = [];
  for (const [id, val] of Object.entries(obj.mcp_servers)) {
    out.push(`[mcp_servers.${id}]`);
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out.push(`${k} = ${JSON.stringify(v)}`);
    }
    out.push("");
  }
  return out.join("\n");
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd /home/deadpool/Documents/soul
bun test bin/cli/lib/runtime-materializer.test.ts
```

Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
cd /home/deadpool/Documents/soul
git add bin/cli/lib/runtime-materializer.ts bin/cli/lib/runtime-materializer.test.ts
git commit -m "feat(runtime-materializer): per-profile CLAUDE_CONFIG_DIR with hash + swap"
```

---

## Task 6: `soul launch` command — wire resolve → picker → materialize → exec

**Files:**
- Create: `bin/cli/commands/launch.ts`
- Create: `bin/cli/commands/launch.test.ts`
- Modify: `bin/cli/commands/_index.ts` (register `launch`)

- [ ] **Step 1: Write failing test for `--dry-run` path**

Create `bin/cli/commands/launch.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "./launch";

let home: string;
let saveCwd: string;
beforeEach(async () => {
  saveCwd = process.cwd();
  home = await mkdtemp(join(tmpdir(), "cue-launch-"));
  process.env.HOME = home;
  process.env.SOUL_REPO_ROOT = saveCwd; // pretend cwd is the soul repo
  process.env.XDG_CONFIG_HOME = join(home, ".config");
});
afterEach(async () => {
  process.chdir(saveCwd);
  await rm(home, { recursive: true, force: true });
});

describe("soul launch --dry-run", () => {
  test("exits 1 when called with unknown agent", async () => {
    const rc = await run(["unknown-agent", "--dry-run"]);
    expect(rc).toBe(1);
  });

  test("exits 1 when no profile resolved and stdin is non-tty (no picker)", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cue-launch-cwd-"));
    process.chdir(cwd);
    const rc = await run(["claude", "--dry-run"]);
    expect(rc).toBe(1);
  });

  test("dry-run with pinned profile prints resolved env and exits 0", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cue-launch-cwd-"));
    await writeFile(join(cwd, ".cue.profile"), "core\n");
    process.chdir(cwd);
    // Note: the 'core' profile must exist under profiles/core/profile.yaml in the
    // repo root pointed to by SOUL_REPO_ROOT. The repo's existing core profile fits.
    const rc = await run(["claude", "--dry-run"]);
    expect(rc).toBe(0);
  });

  test("--cue-profile flag overrides any pin", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cue-launch-cwd-"));
    await writeFile(join(cwd, ".cue.profile"), "core");
    process.chdir(cwd);
    const rc = await run(["claude", "--cue-profile", "frontend", "--dry-run"]);
    expect(rc).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd /home/deadpool/Documents/soul
bun test bin/cli/commands/launch.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement launch.ts**

```typescript
/**
 * `soul launch <agent>` — the hot path.
 *
 * Flow: resolve(cwd) → if none, runPicker() → materializeRuntime() → exec.
 *
 * Bypass paths:
 *   --cue-profile <name>   force this profile
 *   --cue-pick             always open picker (ignore pins)
 *   --dry-run              everything except the final exec; prints env
 *
 * Recursion guard via CUE_LAUNCHING=1 in child env.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

import { loadProfile } from "../lib/profile-loader";
import { resolveProfileForCwd } from "../lib/cwd-resolver";
import { runPicker, type PickerOption } from "../lib/picker";
import { materializeRuntime } from "../lib/runtime-materializer";
import { resolveLocalSkill } from "../lib/resolver-local";

const exec = promisify(execFile);

interface ParsedArgs {
  agent: "claude" | "codex" | null;
  override: string | null;
  forcePick: boolean;
  dryRun: boolean;
  passthrough: string[];
}

function parse(args: string[]): ParsedArgs {
  let agent: ParsedArgs["agent"] = null;
  let override: string | null = null;
  let forcePick = false;
  let dryRun = false;
  const passthrough: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (i === 0 && (a === "claude" || a === "codex")) {
      agent = a;
    } else if (a === "--cue-profile") {
      override = args[++i] ?? null;
    } else if (a === "--cue-pick") {
      forcePick = true;
    } else if (a === "--dry-run") {
      dryRun = true;
    } else {
      passthrough.push(a);
    }
  }
  return { agent, override, forcePick, dryRun, passthrough };
}

function configDir(): string {
  return process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, "cue") : join(homedir(), ".config", "cue");
}

export async function run(args: string[]): Promise<number> {
  // Recursion guard
  if (process.env.CUE_LAUNCHING === "1") {
    process.stderr.write("cue: shim recursion detected — check PATH ordering (~/.local/bin must precede the real claude/codex location)\n");
    return 2;
  }

  const parsed = parse(args);
  if (!parsed.agent) {
    process.stderr.write("cue launch: missing agent (use 'claude' or 'codex')\n");
    return 1;
  }
  const agentKind = parsed.agent === "claude" ? "claude-code" : "codex";

  // Resolve profile.
  const cwd = process.cwd();
  const resolved = parsed.forcePick
    ? { source: "none" as const }
    : await resolveProfileForCwd({
        cwd,
        homeDir: homedir(),
        configDir: configDir(),
        override: parsed.override,
      });

  let profileName: string;
  if (resolved.source === "none") {
    if (!process.stdin.isTTY) {
      process.stderr.write("cue launch: no profile resolved and stdin is not a TTY; pass --cue-profile <name>\n");
      return 1;
    }
    const options = await listProfileOptions();
    const picked = await runPicker({ cwd, options });
    profileName = picked.profile;
  } else {
    profileName = resolved.profile;
  }

  // Load + materialize.
  let profile;
  try {
    profile = await loadProfile(profileName);
  } catch (err) {
    process.stderr.write(`cue launch: ${(err as Error).message}\n`);
    return 1;
  }

  const runtime = await materializeRuntime({
    profile,
    agent: agentKind,
    runtimeRoot: join(configDir(), "runtime"),
    skillSourceLookup: (id) => resolveLocalSkill(id),
    mcpRegistry: await loadMcpRegistry(agentKind),
    userClaudeMd: await readUserClaudeMd(agentKind),
  });

  const envKey = agentKind === "claude-code" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
  const childEnv = { ...process.env, [envKey]: runtime.runtimeDir, CUE_LAUNCHING: "1" };

  if (parsed.dryRun) {
    process.stdout.write(JSON.stringify({
      profile: profileName,
      agent: agentKind,
      runtimeDir: runtime.runtimeDir,
      rebuilt: runtime.rebuilt,
      hash: runtime.hash,
      env: { [envKey]: childEnv[envKey] },
      command: [parsed.agent, ...parsed.passthrough],
    }, null, 2) + "\n");
    return 0;
  }

  // Exec the real agent binary.
  const realBin = await findRealBinary(parsed.agent);
  if (!realBin) {
    process.stderr.write(`cue launch: couldn't find the real '${parsed.agent}' binary on PATH=${process.env.PATH}\n`);
    return 127;
  }

  const child = await exec(realBin, parsed.passthrough, { env: childEnv });
  return child as unknown as number; // Bun's execFile returns child stdio; for true exec semantics, use spawn with stdio:inherit and propagate exit code.
}

// Helpers — implementations below or in lib/.
async function listProfileOptions(): Promise<PickerOption[]> {
  // Reuse `soul list` logic.
  const { listProfiles } = await import("../lib/profile-loader");
  const all = await listProfiles();
  return all.map((p) => ({ value: p.name, label: p.name, hint: p.description }));
}

async function loadMcpRegistry(agent: "claude-code" | "codex"): Promise<Record<string, unknown>> {
  const file = agent === "claude-code" ? "claude.sanitized.json" : "codex.sanitized.json";
  const path = join(process.env.SOUL_REPO_ROOT!, "mcps", "configs", file);
  const raw = JSON.parse(await Bun.file(path).text()) as { servers: Record<string, unknown> };
  return raw.servers;
}

async function readUserClaudeMd(agent: "claude-code" | "codex"): Promise<string> {
  const path = agent === "claude-code"
    ? join(homedir(), ".claude", "CLAUDE.md")
    : join(homedir(), ".codex", "AGENTS.md");
  try { return await Bun.file(path).text(); } catch { return ""; }
}

async function findRealBinary(name: string): Promise<string | null> {
  const path = process.env.PATH ?? "";
  const shimDir = join(homedir(), ".local", "bin");
  for (const dir of path.split(":")) {
    if (resolve(dir) === resolve(shimDir)) continue;
    const candidate = join(dir, name);
    if (await Bun.file(candidate).exists()) return candidate;
  }
  return null;
}
```

The `exec` block at the end above uses promisified `execFile` which buffers stdio — not what a real launcher wants. Replace with `spawn` + `stdio: "inherit"` for the production path:

```typescript
import { spawn } from "node:child_process";

function execAgent(bin: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env, stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 0));
    child.on("error", () => resolve(127));
  });
}
```

Wire `execAgent(realBin, parsed.passthrough, childEnv)` and `return` its result instead of the `execFile` block.

If `loadProfile` / `listProfiles` / `resolveLocalSkill` don't yet export the surface assumed above, surface them as thin shims at the top of their respective lib files (an export reshuffle, not new logic).

- [ ] **Step 4: Register `launch` in the command registry**

Edit `bin/cli/commands/_index.ts` and add inside the `COMMANDS` object:

```typescript
  launch: {
    summary: "Resolve+materialize a profile then exec claude/codex (hot path)",
    load: () => import("./launch"),
  },
```

- [ ] **Step 5: Run tests, expect pass**

```bash
cd /home/deadpool/Documents/soul
bun test bin/cli/commands/launch.test.ts
```

Expected: 4 pass. The third and fourth tests depend on `profiles/core` and `profiles/frontend` actually existing in the repo — they do, but make sure their YAML doesn't reference unavailable MCPs (loadProfile should still pass even if mcps aren't resolvable; resolution happens in materializer).

- [ ] **Step 6: Manual smoke**

```bash
cd /home/deadpool/Documents/soul
bun bin/cli/index.ts launch claude --cue-profile core --dry-run
```

Expected: JSON payload with `profile: "core"`, `runtimeDir: ~/.config/cue/runtime/core/claude`, `hash: <64 hex chars>`, `rebuilt: true`.

Run the same command again:

```bash
cd /home/deadpool/Documents/soul
bun bin/cli/index.ts launch claude --cue-profile core --dry-run
```

Expected: `rebuilt: false` this time.

- [ ] **Step 7: Commit**

```bash
cd /home/deadpool/Documents/soul
git add bin/cli/commands/launch.ts bin/cli/commands/launch.test.ts bin/cli/commands/_index.ts
git commit -m "feat(launch): resolve→picker→materialize→exec orchestrator"
```

---

## Task 7: `soul shell install/uninstall` — write shim binaries

**Files:**
- Replace stub: `bin/cli/commands/init-shell.ts` → `bin/cli/commands/shell.ts`
- Create: `bin/cli/commands/shell.test.ts`
- Modify: `bin/cli/commands/_index.ts` (rename `init-shell` → `shell`)

- [ ] **Step 1: Write failing test**

Create `bin/cli/commands/shell.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runInstall, runUninstall } from "./shell";

let fakeHome: string;
beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "cue-shell-"));
  await mkdir(join(fakeHome, ".local", "bin"), { recursive: true });
});
afterEach(async () => { await rm(fakeHome, { recursive: true, force: true }); });

describe("shell install", () => {
  test("writes claude and codex shims with correct content", async () => {
    const rc = await runInstall({
      homeDir: fakeHome,
      pathDirs: [join(fakeHome, ".local", "bin"), "/usr/bin"],
      realClaude: "/usr/bin/claude",
      realCodex: "/usr/bin/codex",
    });
    expect(rc).toBe(0);

    const claudeShim = await readFile(join(fakeHome, ".local", "bin", "claude"), "utf8");
    expect(claudeShim).toContain("exec cue launch claude");
    const codexShim = await readFile(join(fakeHome, ".local", "bin", "codex"), "utf8");
    expect(codexShim).toContain("exec cue launch codex");

    const st = await stat(join(fakeHome, ".local", "bin", "claude"));
    expect((st.mode & 0o111) !== 0).toBe(true); // executable
  });

  test("refuses to install when ~/.local/bin is not before real binary on PATH", async () => {
    const rc = await runInstall({
      homeDir: fakeHome,
      pathDirs: ["/usr/bin", join(fakeHome, ".local", "bin")], // wrong order
      realClaude: "/usr/bin/claude",
      realCodex: "/usr/bin/codex",
    });
    expect(rc).toBe(1);
  });

  test("uninstall removes shims, leaves bin dir", async () => {
    await runInstall({
      homeDir: fakeHome,
      pathDirs: [join(fakeHome, ".local", "bin"), "/usr/bin"],
      realClaude: "/usr/bin/claude",
      realCodex: "/usr/bin/codex",
    });
    const rc = await runUninstall({ homeDir: fakeHome });
    expect(rc).toBe(0);
    await expect(stat(join(fakeHome, ".local", "bin", "claude"))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd /home/deadpool/Documents/soul
bun test bin/cli/commands/shell.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement shell.ts**

```typescript
/**
 * `soul shell install` — drop ~/.local/bin/{claude,codex} shims and verify PATH.
 * `soul shell uninstall` — remove the shims.
 *
 * The shim is 3 lines of bash: header, exec, EOF. No logic, no version-pinning;
 * if we ever change the shim format we expect users to rerun install.
 */

import { chmod, mkdir, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface InstallOptions {
  homeDir: string;
  /** PATH split into directories, in order. */
  pathDirs: string[];
  /** Absolute path to the real claude binary (if any). */
  realClaude: string | null;
  /** Absolute path to the real codex binary (if any). */
  realCodex: string | null;
}

const SHIM = (agent: string) => `#!/usr/bin/env bash
exec cue launch ${agent} "$@"
`;

function shimDir(homeDir: string): string { return join(homeDir, ".local", "bin"); }

function isShimDirFirst(opts: InstallOptions, realBin: string | null): boolean {
  if (!realBin) return true; // no real binary, no conflict.
  const sd = shimDir(opts.homeDir);
  const sdIdx = opts.pathDirs.findIndex((d) => d === sd);
  if (sdIdx < 0) return false;
  for (let i = 0; i < sdIdx; i++) {
    if (realBin.startsWith(opts.pathDirs[i] + "/")) return false;
  }
  return true;
}

export async function runInstall(opts: InstallOptions): Promise<number> {
  if (!isShimDirFirst(opts, opts.realClaude) || !isShimDirFirst(opts, opts.realCodex)) {
    process.stderr.write(
      `cue shell install: ~/.local/bin must appear earlier in PATH than the real claude/codex.\n` +
      `Add this to your shell rc and re-run:\n` +
      `  export PATH="$HOME/.local/bin:$PATH"\n`,
    );
    return 1;
  }
  await mkdir(shimDir(opts.homeDir), { recursive: true });
  for (const agent of ["claude", "codex"]) {
    const path = join(shimDir(opts.homeDir), agent);
    await writeFile(path, SHIM(agent));
    await chmod(path, 0o755);
  }
  process.stdout.write(`Wrote ${shimDir(opts.homeDir)}/{claude,codex}\n`);
  return 0;
}

export async function runUninstall(opts: { homeDir: string }): Promise<number> {
  for (const agent of ["claude", "codex"]) {
    try {
      await rm(join(shimDir(opts.homeDir), agent));
    } catch {/* ignore — already gone */}
  }
  return 0;
}

// Dispatch wrapper for the CLI registry.
export async function run(args: string[]): Promise<number> {
  const sub = args[0];
  if (sub === "install") {
    return runInstall({
      homeDir: homedir(),
      pathDirs: (process.env.PATH ?? "").split(":"),
      realClaude: await findRealBin("claude"),
      realCodex: await findRealBin("codex"),
    });
  }
  if (sub === "uninstall") return runUninstall({ homeDir: homedir() });
  process.stderr.write("soul shell: usage: soul shell {install|uninstall}\n");
  return 1;
}

async function findRealBin(name: string): Promise<string | null> {
  const sd = shimDir(homedir());
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === sd) continue;
    try {
      const path = join(dir, name);
      const st = await stat(path);
      if (st.isFile() && (st.mode & 0o111) !== 0) return path;
    } catch {/* not in this dir */}
  }
  return null;
}
```

- [ ] **Step 4: Update command registry**

Edit `bin/cli/commands/_index.ts`:

```typescript
  shell: {
    summary: "Install/uninstall ~/.local/bin/{claude,codex} shims",
    load: () => import("./shell"),
  },
```

Remove the `"init-shell"` entry. Delete `bin/cli/commands/init-shell.ts`.

- [ ] **Step 5: Run tests, expect pass**

```bash
cd /home/deadpool/Documents/soul
bun test bin/cli/commands/shell.test.ts
```

Expected: 3 pass.

- [ ] **Step 6: Commit**

```bash
cd /home/deadpool/Documents/soul
git rm bin/cli/commands/init-shell.ts
git add bin/cli/commands/shell.ts bin/cli/commands/shell.test.ts bin/cli/commands/_index.ts
git commit -m "feat(shell): install/uninstall ~/.local/bin shims"
```

---

## Task 8: `plugins/cue/` Claude Code plugin — in-session slash commands

**Files:**
- Create: `plugins/cue/plugin.json`
- Create: `plugins/cue/commands/cue.md`
- Create: `plugins/cue/commands/cue-switch.md`
- Create: `plugins/cue/commands/cue-reload.md`
- Create: `plugins/cue/commands/cue-current.md`

- [ ] **Step 1: Plugin manifest**

```bash
mkdir -p /home/deadpool/Documents/soul/plugins/cue/commands
```

Create `plugins/cue/plugin.json`:

```json
{
  "$schema": "https://anthropic.com/claude-code/plugin.schema.json",
  "name": "cue",
  "description": "Switch cue profile inside a Claude Code session. Materializes via the cue CLI; restart required to take effect (use /cue reload).",
  "version": "0.1.0",
  "author": { "name": "cue" },
  "commands": [
    { "name": "cue", "path": "commands/cue.md" },
    { "name": "cue-switch", "path": "commands/cue-switch.md" },
    { "name": "cue-reload", "path": "commands/cue-reload.md" },
    { "name": "cue-current", "path": "commands/cue-current.md" }
  ]
}
```

- [ ] **Step 2: `/cue` command markdown**

Create `plugins/cue/commands/cue.md`:

```markdown
---
description: List cue profiles and pick one to switch the current cwd to
---

Run `cue list --json` via Bash to enumerate profiles, then present them as a numbered markdown list to the user. After the user replies with a number or name, write the chosen name to `./.cue.profile` with `printf '%s\n' <name> > ./.cue.profile`. Verify the profile name matches one returned by `cue list --json` before writing — reject typos. Finish by printing the line: "Profile pinned. Run `/cue reload` to apply, or restart claude."
```

- [ ] **Step 3: `/cue switch` command**

Create `plugins/cue/commands/cue-switch.md`:

```markdown
---
description: Switch the cwd to a specific cue profile (no picker)
arguments:
  - name: profile
    description: Profile name (or list number from /cue current)
---

Validate that `{{profile}}` matches a name returned by `cue list --json`. If valid, write it to `./.cue.profile`. If not, surface the error and suggest `/cue` to pick from a list.
```

- [ ] **Step 4: `/cue reload` command**

Create `plugins/cue/commands/cue-reload.md`:

```markdown
---
description: Restart claude under the currently pinned cue profile
---

Run `exec ~/.local/bin/claude` via Bash. This replaces the current claude process with a fresh one that resolves the current `.cue.profile`. The user's transcript is preserved.

If `~/.local/bin/claude` does not exist, instead print: "shim not installed; run `cue shell install` in a terminal first."
```

- [ ] **Step 5: `/cue current` command**

Create `plugins/cue/commands/cue-current.md`:

```markdown
---
description: Show the active cue profile and its resolved capability list
---

Run `cue current` and present the output verbatim, formatted as:

- Profile: <name>
- Skills: <count>
- MCPs: <count>
- Plugins: <count>
- Runtime dir: <path>
```

- [ ] **Step 6: Implement `soul current` to back the slash command**

Create `bin/cli/commands/current.ts`:

```typescript
/**
 * `soul current` — print the active profile and resolved capability list.
 *
 * Reads CUE_PROFILE env if set (we plan to inject it in launch.ts later) or
 * falls back to .cue.profile / repo-default / global-default via cwd-resolver.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { resolveProfileForCwd } from "../lib/cwd-resolver";
import { loadProfile } from "../lib/profile-loader";

function configDir(): string {
  return process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, "cue") : join(homedir(), ".config", "cue");
}

export async function run(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const resolved = await resolveProfileForCwd({
    cwd: process.cwd(),
    homeDir: homedir(),
    configDir: configDir(),
  });
  if (resolved.source === "none") {
    process.stdout.write(json ? "{}\n" : "no profile pinned for this cwd\n");
    return 0;
  }
  const profile = await loadProfile(resolved.profile);
  const out = {
    profile: resolved.profile,
    source: resolved.source,
    skills: profile.skills.local.length + profile.skills.npx.length,
    mcps: profile.mcps.length,
    plugins: profile.plugins.length,
    runtimeDir: join(configDir(), "runtime", resolved.profile),
  };
  process.stdout.write(json ? JSON.stringify(out, null, 2) + "\n" : formatHuman(out));
  return 0;
}

function formatHuman(o: { profile: string; source: string; skills: number; mcps: number; plugins: number; runtimeDir: string; }): string {
  return `Profile: ${o.profile} (${o.source})\nSkills: ${o.skills}\nMCPs: ${o.mcps}\nPlugins: ${o.plugins}\nRuntime dir: ${o.runtimeDir}\n`;
}
```

Add `current` to `bin/cli/commands/_index.ts`:

```typescript
  current: {
    summary: "Print the active profile and its resolved capability counts",
    load: () => import("./current"),
  },
```

- [ ] **Step 7: Manual smoke**

```bash
cd /home/deadpool/Documents/soul
echo core > .cue.profile
bun bin/cli/index.ts current
rm .cue.profile
```

Expected: prints `Profile: core (pin-file)`, plus counts.

- [ ] **Step 8: Commit**

```bash
cd /home/deadpool/Documents/soul
git add plugins/cue bin/cli/commands/current.ts bin/cli/commands/_index.ts
git commit -m "feat(plugin): in-session /cue, /cue switch, /cue reload, /cue current"
```

---

## Task 9: `soul migrate-symlinks` — rewrite external symlinks

**Files:**
- Create: `bin/cli/commands/migrate-symlinks.ts`
- Create: `bin/cli/commands/migrate-symlinks.test.ts`
- Modify: `bin/cli/commands/_index.ts`

- [ ] **Step 1: Write failing test**

Create `bin/cli/commands/migrate-symlinks.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, symlink, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateSymlinks } from "./migrate-symlinks";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "cue-mig-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("migrateSymlinks", () => {
  test("rewrites symlinks whose target starts with --from", async () => {
    const skills = join(root, ".codex", "skills");
    await mkdir(skills, { recursive: true });
    await symlink("/home/user/Documents/soul/skills/skills/x/y", join(skills, "y"));
    const summary = await migrateSymlinks({
      from: "/home/user/Documents/soul",
      to:   "/home/user/Documents/cue",
      roots: [skills],
      dryRun: false,
    });
    expect(summary.updated).toBe(1);
    const after = await readlink(join(skills, "y"));
    expect(after).toBe("/home/user/Documents/cue/skills/skills/x/y");
  });

  test("dryRun does not modify links", async () => {
    const skills = join(root, ".codex", "skills");
    await mkdir(skills, { recursive: true });
    const original = "/home/user/Documents/soul/skills/skills/x/y";
    await symlink(original, join(skills, "y"));
    const summary = await migrateSymlinks({
      from: "/home/user/Documents/soul",
      to:   "/home/user/Documents/cue",
      roots: [skills],
      dryRun: true,
    });
    expect(summary.wouldUpdate).toBe(1);
    expect(summary.updated).toBe(0);
    expect(await readlink(join(skills, "y"))).toBe(original);
  });

  test("ignores symlinks whose target does not match --from", async () => {
    const skills = join(root, ".codex", "skills");
    await mkdir(skills, { recursive: true });
    await symlink("/somewhere/else/x", join(skills, "y"));
    const summary = await migrateSymlinks({
      from: "/home/user/Documents/soul",
      to:   "/home/user/Documents/cue",
      roots: [skills],
      dryRun: false,
    });
    expect(summary.updated).toBe(0);
    expect(summary.skipped).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd /home/deadpool/Documents/soul
bun test bin/cli/commands/migrate-symlinks.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement migrate-symlinks.ts**

```typescript
/**
 * `soul migrate-symlinks` — rewrite external symlinks from soul/ to cue/.
 *
 * Walks the directories named in --roots (default: ~/.codex/skills,
 * ~/.claude-accounts/{any}/skills), inspects each symlink, and if the link's
 * target starts with --from, replaces the link with one whose target starts
 * with --to. Idempotent; dry-run by default.
 */

import { readdir, readlink, lstat, unlink, symlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface MigrateOptions {
  from: string;
  to: string;
  roots: string[];
  dryRun: boolean;
}

export interface MigrateSummary {
  scanned: number;
  updated: number;
  wouldUpdate: number;
  skipped: number;
  errors: { path: string; reason: string }[];
}

export async function migrateSymlinks(opts: MigrateOptions): Promise<MigrateSummary> {
  const summary: MigrateSummary = { scanned: 0, updated: 0, wouldUpdate: 0, skipped: 0, errors: [] };
  for (const root of opts.roots) await walk(root, opts, summary);
  return summary;
}

async function walk(dir: string, opts: MigrateOptions, s: MigrateSummary): Promise<void> {
  let entries: string[];
  try { entries = await readdir(dir); } catch { return; }
  for (const name of entries) {
    const path = join(dir, name);
    let st;
    try { st = await lstat(path); } catch (e) { s.errors.push({ path, reason: (e as Error).message }); continue; }
    if (st.isSymbolicLink()) {
      s.scanned++;
      const target = await readlink(path);
      if (target.startsWith(opts.from)) {
        const newTarget = opts.to + target.slice(opts.from.length);
        if (opts.dryRun) {
          s.wouldUpdate++;
          process.stdout.write(`would update: ${path} -> ${newTarget}\n`);
        } else {
          await unlink(path);
          await symlink(newTarget, path);
          s.updated++;
          process.stdout.write(`updated: ${path} -> ${newTarget}\n`);
        }
      } else {
        s.skipped++;
      }
    } else if (st.isDirectory()) {
      await walk(path, opts, s);
    }
  }
}

export async function run(args: string[]): Promise<number> {
  let from = "";
  let to = "";
  let dryRun = true;
  const roots: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--from") from = args[++i] ?? "";
    else if (a === "--to") to = args[++i] ?? "";
    else if (a === "--apply") dryRun = false;
    else if (a === "--root") roots.push(args[++i] ?? "");
  }
  if (!from || !to) {
    process.stderr.write("usage: soul migrate-symlinks --from <path> --to <path> [--apply] [--root <dir>]+\n");
    return 1;
  }
  const defaultRoots = roots.length > 0 ? roots : [
    join(homedir(), ".codex", "skills"),
    join(homedir(), ".claude-accounts"),
  ];
  const summary = await migrateSymlinks({ from, to, roots: defaultRoots, dryRun });
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  return summary.errors.length > 0 ? 2 : 0;
}
```

- [ ] **Step 4: Register in `_index.ts`**

```typescript
  "migrate-symlinks": {
    summary: "Rewrite ~/.codex and ~/.claude-accounts symlinks from soul/ to cue/",
    load: () => import("./migrate-symlinks"),
  },
```

- [ ] **Step 5: Run tests, expect pass**

```bash
cd /home/deadpool/Documents/soul
bun test bin/cli/commands/migrate-symlinks.test.ts
```

Expected: 3 pass.

- [ ] **Step 6: Commit**

```bash
cd /home/deadpool/Documents/soul
git add bin/cli/commands/migrate-symlinks.ts bin/cli/commands/migrate-symlinks.test.ts bin/cli/commands/_index.ts
git commit -m "feat(migrate-symlinks): rewrite external symlinks from soul to cue paths"
```

---

## Task 10: Repo reorg — `bin/cli/` → `src/`, group `resources/`

**Files:**
- Move: `bin/cli/` → `src/`
- Move: `skills/` → `resources/skills/`
- Move: `mcps/` → `resources/mcps/`
- Move (gitignored): `claude-plugins-official/` → `resources/claude-plugins-official/`
- Modify: `bin/soul` (point at `src/index.ts`)
- Modify: every `REPO_ROOT` calculation in `src/lib/*.ts` and `src/commands/*.ts`
- Modify: every doc that references `bin/cli/`, `soul/skills/`, `soul/mcps/`

- [ ] **Step 1: Move bin/cli to src**

```bash
cd /home/deadpool/Documents/soul
git mv bin/cli src
git status --short
```

Expected: a long list of `R  bin/cli/... -> src/...` entries.

- [ ] **Step 2: Move skills, mcps, claude-plugins-official into resources/**

```bash
cd /home/deadpool/Documents/soul
mkdir resources
git mv skills resources/skills
git mv mcps resources/mcps
# claude-plugins-official is gitignored — plain mv:
mv claude-plugins-official resources/claude-plugins-official
git status --short | head -20
```

- [ ] **Step 3: Fix REPO_ROOT calculations**

In `src/lib/profile-loader.ts`, `src/lib/mcp-materializer.ts`, and any other file that contains `dirname(fileURLToPath(import.meta.url))` followed by `..` walks, count the new directory depth:

- Old: `bin/cli/lib/foo.ts` → 3 levels to repo root → `resolve(..., "..", "..", "..")`.
- New: `src/lib/foo.ts` → 2 levels to repo root → `resolve(..., "..", "..")`.

```bash
cd /home/deadpool/Documents/soul
grep -rln '"\.\.", "\.\.", "\.\."' src/ | xargs sed -i 's|"\.\.", "\.\.", "\.\."|"\.\.", "\.\."|g'
```

Inspect the diff with `git diff src/lib/profile-loader.ts` — verify each REPO_ROOT line now ends at the right depth.

Also update `mcps/configs/...` references to `resources/mcps/configs/...`:

```bash
cd /home/deadpool/Documents/soul
grep -rln '"mcps/configs/\|mcps/configs/' src/ | xargs sed -i 's|"mcps/configs/|"resources/mcps/configs/|g; s|, "mcps", "configs"|, "resources", "mcps", "configs"|g'
```

Inspect the diff and verify by hand — `sed` is blunt.

Same for `"skills/"` references (the skill resolver):

```bash
cd /home/deadpool/Documents/soul
grep -rn '"skills/skills"\|"skills", "skills"' src/
```

Fix each hit to point at `resources/skills/skills`.

- [ ] **Step 4: Update bin/soul launcher**

Edit `bin/soul`:

```bash
exec bun "$SOUL_REPO_ROOT/src/index.ts" "$@"
```

(replacing the previous `bin/cli/index.ts` path).

- [ ] **Step 5: Run the whole test suite**

```bash
cd /home/deadpool/Documents/soul
bun test
```

Expected: all tests pass. If any fail with "module not found" or "ENOENT", the REPO_ROOT or path string in that file wasn't updated. Fix and re-run.

- [ ] **Step 6: Smoke the CLI**

```bash
cd /home/deadpool/Documents/soul
bin/soul list
bin/soul launch claude --cue-profile core --dry-run
```

Expected: both work as before.

- [ ] **Step 7: Commit**

```bash
cd /home/deadpool/Documents/soul
git add -A
git commit -m "refactor: bin/cli -> src/, group skills+mcps+plugins under resources/"
```

---

## Task 11: Rename soul → cue (cosmetic + filesystem)

**Files:**
- Modify: `package.json` (name, bin)
- Move: `bin/soul` → `bin/cue` (keep `bin/soul` as tombstone)
- Modify: every doc and script reference of `soul` → `cue`
- Add: env-var fallback `CUE_REPO_ROOT` (with `SOUL_REPO_ROOT` honored for 2 weeks)
- Rename at filesystem: `mv /home/deadpool/Documents/soul → /home/deadpool/Documents/cue`
- Run: `cue migrate-symlinks --apply` against the now-stale `~/.codex/skills/` etc.

- [ ] **Step 1: Tag the pre-rename point**

```bash
cd /home/deadpool/Documents/soul
git tag -a pre-rename -m "Pre-rename: soul/ → cue/"
```

- [ ] **Step 2: Update package.json**

```bash
cd /home/deadpool/Documents/soul
node -e 'const p=require("./package.json"); p.name="cue"; p.description="agent profile manager — pick a profile, exec claude/codex with the right skills/MCPs/plugins"; p.bin={cue:"bin/cue"}; require("fs").writeFileSync("./package.json", JSON.stringify(p,null,2)+"\n");'
```

- [ ] **Step 3: Add bin/cue, keep bin/soul tombstone**

```bash
cd /home/deadpool/Documents/soul
git mv bin/soul bin/cue
```

Edit the new `bin/cue` — replace every `soul` token in the script with `cue`. Specifically: `SOUL_BIN_DIR` → `CUE_BIN_DIR`, `SOUL_REPO_ROOT` → `CUE_REPO_ROOT`, and the message `"soul: bun is required..."` → `"cue: bun is required..."`. Keep the `SOUL_REPO_ROOT` env-var fallback for 2 weeks:

```bash
# At the top of bin/cue, after src/dir resolution:
export CUE_REPO_ROOT="${CUE_REPO_ROOT:-${SOUL_REPO_ROOT:-$CUE_REPO_ROOT}}"
```

Create the tombstone `bin/soul`:

```bash
cd /home/deadpool/Documents/soul
cat > bin/soul <<'EOF'
#!/usr/bin/env bash
# tombstone — soul has been renamed to cue.
echo "soul → cue: rerun as 'cue $*' (this tombstone will be removed after 2026-06-05)" >&2
exec "$(dirname "$0")/cue" "$@"
EOF
chmod +x bin/soul
```

- [ ] **Step 4: Update src for the rename**

Search and replace `SOUL_REPO_ROOT` → `CUE_REPO_ROOT` (keep a fallback that honors `SOUL_REPO_ROOT` for backwards compat for 2 weeks):

```bash
cd /home/deadpool/Documents/soul
grep -rln 'SOUL_REPO_ROOT' src/ | xargs sed -i 's|process\.env\.SOUL_REPO_ROOT|process.env.CUE_REPO_ROOT ?? process.env.SOUL_REPO_ROOT|g'
grep -rln 'SOUL_PROFILES_DIR' src/ | xargs sed -i 's|process\.env\.SOUL_PROFILES_DIR|process.env.CUE_PROFILES_DIR ?? process.env.SOUL_PROFILES_DIR|g'
```

Inspect the diff to confirm `??` syntax was applied correctly and there are no duplicate insertions on re-runs.

Update `src/index.ts` strings: `"soul — profile-driven Claude Code / Codex setup"` → `"cue — agent profile manager"`. `"soul:"` prefixes in error messages → `"cue:"`.

- [ ] **Step 5: Update README, AGENTS.md, CLAUDE.md, setup/*.md**

```bash
cd /home/deadpool/Documents/soul
grep -rln '\bsoul\b' README.md AGENTS.md CLAUDE.md docs/ setup/ CONTRIBUTING.md
```

For each file, rewrite the prose. Some references stay (history, "the project was previously called soul"). The README h1 changes to `# cue` with a tagline like `> agent profile manager for Claude Code and Codex`.

- [ ] **Step 6: Run all tests once more**

```bash
cd /home/deadpool/Documents/soul
bun test
```

Expected: all pass. If `SOUL_PROFILES_DIR` is used in a test, the `??` fallback should keep it working.

- [ ] **Step 7: Filesystem rename**

This is the only step where the cwd genuinely changes.

```bash
cd /home/deadpool/Documents
mv soul cue
cd cue
ls -la
```

Expected: the repo root is now `/home/deadpool/Documents/cue/`, `bin/cue` is executable.

- [ ] **Step 8: Migrate symlinks**

```bash
cd /home/deadpool/Documents/cue
bin/cue migrate-symlinks --from /home/deadpool/Documents/soul --to /home/deadpool/Documents/cue
```

Expected: a JSON summary with `wouldUpdate > 0`, `updated: 0` (dry-run by default).

Inspect the printed lines. If they look right, apply:

```bash
cd /home/deadpool/Documents/cue
bin/cue migrate-symlinks --from /home/deadpool/Documents/soul --to /home/deadpool/Documents/cue --apply
```

Expected: `updated > 0`, `errors: []`. Spot-check 2-3 of the rewritten symlinks:

```bash
cd /home/deadpool/Documents/cue
ls -la ~/.codex/skills | head -5
```

The targets should now point into `/home/deadpool/Documents/cue/...`.

- [ ] **Step 9: Commit the rename**

```bash
cd /home/deadpool/Documents/cue
git add -A
git commit -m "rename: soul -> cue (project + binary)

Project name, package.json bin, docs, env-var prefixes, and external symlinks
(~/.codex/skills, ~/.claude-accounts) all flip to cue. bin/soul stays as a
2-week tombstone that execs bin/cue."
git tag -a v0.2.0-cue -m "First cue-named release"
```

---

## Task 12: Manual smoke + docs

**Files:**
- Create: `test/manual/cue-launch.md`
- Modify: `README.md` (rebrand + quickstart)
- Modify: `docs/launch.md` (new launch flow)
- Modify: `docs/shell-install.md` (shim install)

- [ ] **Step 1: Smoke walkthrough doc**

Create `test/manual/cue-launch.md`:

```markdown
# Manual smoke — cue launch end-to-end

## 0. Pre-req

```bash
cue shell install
echo $PATH | tr ':' '\n' | head -3   # ~/.local/bin must be first
which claude                          # should print ~/.local/bin/claude
```

## 1. First launch in a new repo — TUI opens

```bash
mkdir -p /tmp/cue-smoke && cd /tmp/cue-smoke
claude
```

Expected:
- Picker opens
- Arrow-key navigation works
- After picking, `.cue.profile` exists in `/tmp/cue-smoke/`
- Claude launches with that profile's skills

## 2. Re-launch — picker is skipped

```bash
cd /tmp/cue-smoke
claude
```

Expected: no picker; claude launches with the previously pinned profile.

## 3. Force picker

```bash
cd /tmp/cue-smoke
claude --cue-pick
```

Expected: picker opens despite pin file.

## 4. Profile flag

```bash
claude --cue-profile frontend
```

Expected: launches under `frontend` even though `.cue.profile` says otherwise. Pin file unchanged.

## 5. In-session switch

Inside claude:
```
/cue current     # prints active profile
/cue             # prints numbered list
/cue switch backend
/cue reload
```

Expected: after `/cue reload`, claude restarts with the new profile.

## 6. Codex parity

Same flow with `codex` instead of `claude`.

## 7. Bypass

```bash
CUE_BYPASS=1 claude --version
```

Expected: just claude's version string, no picker, no materialize.
```

- [ ] **Step 2: Update README**

Re-read `README.md` and rewrite the opening paragraphs to describe cue as the agent profile manager. Keep the per-OS install blocks; replace `soul` tokens with `cue`. Add a short "How it works" section pointing at `docs/launch.md`.

- [ ] **Step 3: Write docs/launch.md**

Create `docs/launch.md` summarizing the launch flow diagram from §6 of the spec. Don't duplicate the whole spec — link to it.

- [ ] **Step 4: Write docs/shell-install.md**

Create `docs/shell-install.md` covering `cue shell install`, PATH ordering caveats, uninstall, and how to bypass.

- [ ] **Step 5: Update AGENTS.md and CLAUDE.md**

Rewrite the two AGENTS.md sections that still mention `soul` and `soul/`. CLAUDE.md is `@AGENTS.md`, so only AGENTS.md needs edits.

- [ ] **Step 6: Final commit**

```bash
cd /home/deadpool/Documents/cue
git add test/manual/cue-launch.md README.md AGENTS.md docs/launch.md docs/shell-install.md
git commit -m "docs: cue launch flow, shell-install guide, README rebrand"
```

- [ ] **Step 7: Run the smoke walkthrough**

Open `/home/deadpool/Documents/cue/test/manual/cue-launch.md` and execute every step by hand. Note any divergence between the doc and observed behavior — file bug-fix tasks for divergences before declaring done.

---

## Self-review checklist

After every task is checked off, re-read the spec (`docs/superpowers/specs/2026-05-22-cue-agent-profile-manager-design.md`) and confirm:

| Spec §                                | Task(s) implementing it                 |
|---------------------------------------|-----------------------------------------|
| §3 rename                              | 11                                       |
| §4 architecture                        | 3, 4, 5, 6, 7                            |
| §5.1 top-level `plugins:`              | 2                                        |
| §5.2 per-resource `agents:` override   | 2                                        |
| §6 launch flow                         | 6                                        |
| §6.1 resolve precedence                | 3                                        |
| §6.2 shim                              | 7                                        |
| §6.3 bypass paths                      | 6 (CLI flags); 7 (shim recursion guard)  |
| §6.4 recursion guard                   | 6                                        |
| §6.5 exit codes                        | 6                                        |
| §7 materialization                     | 5                                        |
| §7.1 algorithm                         | 5                                        |
| §8 picker UX                           | 4                                        |
| §8.2 in-session switching              | 8                                        |
| §9 repo layout                         | 10                                       |
| §10 migration                          | 9, 11                                    |
| §11 error handling                     | 5 (atomic swap), 6 (127/130), 6 (recursion) |
| §12 testing                            | 2, 3, 4, 5, 6, 7, 9 (unit + integration); 12 (manual) |
| §13 rollout                            | 1, 10, 11, 12                             |

If any cell is empty, file a follow-up task before declaring the plan complete.

---

## Notes for the executing agent

- **TDD strictly.** Each task starts with a failing test. Don't write implementation before the red.
- **One commit per task** (not per step). The commit message in the final step of each task is the canonical one.
- **The `exec`/`spawn` distinction in launch.ts matters.** Don't ship the `execFile` promisified version — it buffers stdio and breaks interactive flows. Use the `spawn(..., { stdio: "inherit" })` shape shown in Task 6 Step 3.
- **`renameat2(RENAME_EXCHANGE)` is mentioned in the spec but not used in Task 5.** The `rm + rename` approach is acceptable per the spec's §7.1 macOS fallback note. If you want stricter Linux atomicity later, swap in `renameat2` via `ffi` — out of scope for v0.1.
- **Existing libs assume `SOUL_*` env vars.** Task 11 adds `CUE_*` aliases without removing the old names. Remove the `SOUL_*` fallbacks in a follow-up PR ≥ 2 weeks after Task 11 lands.
- **The cwd changes in Task 11 Step 7.** All commands after that step use `/home/deadpool/Documents/cue/` as the working directory.
- **Existing helper exports may need surfacing.** Task 6 imports `loadProfile`, `listProfiles`, and `resolveLocalSkill` from `lib/`. If `profile-loader.ts` doesn't already export `listProfiles` or `resolver-local.ts` doesn't export `resolveLocalSkill`, add a minimal export at the top of each file — the logic to enumerate `profiles/*/profile.yaml` and to resolve a local skill id to a source path already exists internally for the existing `list`/`use` commands and just needs to be made public. This is an export reshuffle, not new logic.
- **`bin/cli/commands/use.ts` is a stub today.** The plugin commands in Task 8 deliberately bypass `cue use` and write `.cue.profile` directly via Bash, so the stub does not block Task 8. Wiring `cue use` to call `materializeRuntime` is a follow-up task — file it separately if you want eager materialization from the shell.
- **Task 8 plugin is dormant until Task 11.** The plugin lives under `plugins/cue/` and only activates when a profile's `plugins:` includes `cue@<marketplace>`. Until the rename and marketplace registration land, it's just files on disk. Don't worry that `/cue` "doesn't work" before Task 11 — that's expected.
