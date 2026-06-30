/**
 * Tests for profile-loader.ts.
 *
 * Each test builds an isolated profiles/ tree under a temp dir and points the
 * loader at it via `CUE_PROFILES_DIR`. The repo's real `profiles/schema.json`
 * is always used — it is the canonical contract.
 *
 * Run with: `bun test bin/cli/lib/profile-loader.test.ts`
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  InheritanceCycle,
  InheritanceDepthExceeded,
  ProfileNotFound,
  SchemaViolation,
} from "../../profiles/_types";
import { isCompositeSelector, listProfiles, loadProfile, parseProfileSelector } from "./profile-loader";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const EXAMPLES_DIR = join(REPO_ROOT, "profiles", "_examples");

let scratchRoot: string;
let priorEnv: string | undefined;
// SOUL_PROFILES_DIR is a fallback the loader honors; one test below sets it.
// Capture + restore it too so it never leaks into sibling test files (a dead
// SOUL_PROFILES_DIR would make their loadProfile() calls fail).
let priorSoulEnv: string | undefined;

beforeEach(async () => {
  scratchRoot = await mkdtemp(join(tmpdir(), "cue-profile-loader-"));
  priorEnv = process.env.CUE_PROFILES_DIR;
  priorSoulEnv = process.env.SOUL_PROFILES_DIR;
  process.env.CUE_PROFILES_DIR = scratchRoot;
});

afterEach(() => {
  if (priorEnv === undefined) {
    delete process.env.CUE_PROFILES_DIR;
  } else {
    process.env.CUE_PROFILES_DIR = priorEnv;
  }
  if (priorSoulEnv === undefined) {
    delete process.env.SOUL_PROFILES_DIR;
  } else {
    process.env.SOUL_PROFILES_DIR = priorSoulEnv;
  }
});

/** Write a profile.yaml at `<scratchRoot>/<name>/profile.yaml`. */
async function writeProfile(name: string, body: string): Promise<void> {
  const dir = join(scratchRoot, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "profile.yaml"), body, "utf8");
}

/** Copy a fixture file from `profiles/_examples/` into a named profile dir. */
async function installFixture(
  fixtureFile: string,
  asName: string,
): Promise<void> {
  const body = await readFile(join(EXAMPLES_DIR, fixtureFile), "utf8");
  await writeProfile(asName, body);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadProfile", () => {
  test("valid minimal: required fields only, defaults applied", async () => {
    await installFixture("minimal.yaml", "minimal");

    const resolved = await loadProfile("minimal");

    expect(resolved.name).toBe("minimal");
    expect(resolved.description).toBe(
      "Minimal profile — required fields only, no extras",
    );
    // Schema default for agents is applied by the loader when neither parent
    // nor child declared it.
    expect(resolved.agents).toEqual(["claude-code", "codex"]);
    expect(resolved.skills).toEqual({ local: [], npx: [] });
    expect(resolved.mcps).toEqual([]);
    expect(resolved.plugins).toEqual([]);
    expect(resolved.env).toEqual({});
    expect(resolved.inheritanceChain).toEqual(["minimal"]);
  });

  test("valid w/inheritance: arrays concat+dedupe, env overrides, child wins on scalars", async () => {
    // Parent — "core" — supplies a baseline set of skills, mcps, env.
    await writeProfile(
      "core",
      [
        "name: core",
        "description: Always-on baseline",
        "skills:",
        "  local:",
        "    - meta/caveman-commit",
        "    - meta/find-skills",
        "  npx:",
        "    - repo: anthropics/skills",
        "      pin: tag@v0.4.1",
        "      skills: [pdf]",
        "mcps:",
        "  - claude-mem",
        "env:",
        '  CORE_FLAG: "1"',
        '  SHARED_FLAG: "parent-loses"',
        "",
      ].join("\n"),
    );

    // Child — the standard fixture.
    await installFixture("inherits.yaml", "inherits");

    const resolved = await loadProfile("inherits");

    // Identity comes from the leaf.
    expect(resolved.name).toBe("inherits");
    expect(resolved.description).toBe("Child profile that inherits from core");
    expect(resolved.inherits).toBe("core");
    expect(resolved.inheritanceChain).toEqual(["core", "inherits"]);

    // Primitive array merge: parent items first, child appended, deduped.
    // In the resolved form, string refs are normalized to { id } objects.
    expect(resolved.skills.local).toEqual([
      { id: "meta/caveman-commit" },
      { id: "meta/find-skills" },
      { id: "medusa/building-with-medusa" },
    ]);

    // NpxSkillRef merge by `repo`: child overrides the whole entry.
    expect(resolved.skills.npx).toEqual([
      { repo: "anthropics/skills", pin: "tag@v0.5.0", skills: ["xlsx"] },
    ]);

    // MCPs are normalized to { id } object form.
    expect(resolved.mcps).toEqual([{ id: "claude-mem" }, { id: "medusadocs" }]);

    // Env: child keys override, parent-only keys survive.
    expect(resolved.env).toEqual({
      CORE_FLAG: "1",
      CHILD_FLAG: "1",
      SHARED_FLAG: "child-wins",
    });

    // Agents: child declared [claude-code]; parent did not declare. Merge =
    // [claude-code]. (No fallback to default — child was explicit.)
    expect(resolved.agents).toEqual(["claude-code"]);
  });

  test("mcps: when: gate is parsed and survives the inheritance merge", async () => {
    await writeProfile(
      "mcp-when",
      [
        "name: mcp-when",
        "description: profile with a conditional MCP",
        "mcps:",
        "  - always-on", // string form — no gate
        "  - id: gated", // object form with a when: condition
        "    when:",
        "      env: SOME_TOKEN",
        "  - id: cwd-gated",
        "    when:",
        "      has_dir: .obsidian",
        "",
      ].join("\n"),
    );

    const resolved = await loadProfile("mcp-when");
    expect(resolved.mcps).toEqual([
      { id: "always-on" },
      { id: "gated", when: { env: "SOME_TOKEN" } },
      { id: "cwd-gated", when: { has_dir: ".obsidian" } },
    ]);
  });

  test("subagents fold through inheritance: parent first, child appended, deduped", async () => {
    await writeProfile(
      "sa-parent",
      [
        "name: sa-parent",
        "description: parent",
        "subagents:",
        "  - design/design-ui-designer",
        "  - sales/sales-coach",
        "",
      ].join("\n"),
    );
    await writeProfile(
      "sa-child",
      [
        "name: sa-child",
        "description: child",
        "inherits: sa-parent",
        "subagents:",
        "  - sales/sales-coach", // duplicate — should collapse
        "  - testing/testing-api-tester",
        "",
      ].join("\n"),
    );

    const resolved = await loadProfile("sa-child");
    expect(resolved.subagents).toEqual([
      "design/design-ui-designer",
      "sales/sales-coach",
      "testing/testing-api-tester",
    ]);
  });

  test("subagents union across a composite (a+b) selector, deduped", async () => {
    await writeProfile(
      "sa-a",
      ["name: sa-a", "description: a", "subagents:", "  - design/design-ui-designer", ""].join("\n"),
    );
    await writeProfile(
      "sa-b",
      [
        "name: sa-b",
        "description: b",
        "subagents:",
        "  - design/design-ui-designer", // shared — dedupe
        "  - finance/finance-tax-strategist",
        "",
      ].join("\n"),
    );

    const resolved = await loadProfile("sa-a+sa-b");
    expect(resolved.subagents).toEqual([
      "design/design-ui-designer",
      "finance/finance-tax-strategist",
    ]);
  });

  test("schema violation: missing required `description`", async () => {
    await writeProfile("broken", "name: broken\n");

    let err: unknown;
    try {
      await loadProfile("broken");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SchemaViolation);
    expect((err as SchemaViolation).code).toBe("SCHEMA_VIOLATION");
    expect((err as SchemaViolation).errors.length).toBeGreaterThan(0);
  });

  test("schema violation: name field does not match directory name", async () => {
    // Schema validates on its own — but the loader also enforces the dir/name
    // identity (lint rule E1 from SCHEMA.md).
    await writeProfile(
      "alpha",
      ["name: beta", "description: mismatched", ""].join("\n"),
    );

    let err: unknown;
    try {
      await loadProfile("alpha");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SchemaViolation);
  });

  test("cyclic inheritance: aa -> bb -> aa throws InheritanceCycle", async () => {
    await writeProfile(
      "aa",
      ["name: aa", "description: A", "inherits: bb", ""].join("\n"),
    );
    await writeProfile(
      "bb",
      ["name: bb", "description: B", "inherits: aa", ""].join("\n"),
    );

    let err: unknown;
    try {
      await loadProfile("aa");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(InheritanceCycle);
    // The reported chain should expose the loop participants.
    expect((err as InheritanceCycle).chain).toContain("aa");
    expect((err as InheritanceCycle).chain).toContain("bb");
  });

  test("depth-exceeded: a chain with 4 ancestors throws InheritanceDepthExceeded", async () => {
    // leaf -> p1 -> p2 -> p3 -> p4   (4 ancestors, exceeds max of 3)
    await writeProfile(
      "p4",
      ["name: p4", "description: root", ""].join("\n"),
    );
    await writeProfile(
      "p3",
      ["name: p3", "description: p3", "inherits: p4", ""].join("\n"),
    );
    await writeProfile(
      "p2",
      ["name: p2", "description: p2", "inherits: p3", ""].join("\n"),
    );
    await writeProfile(
      "p1",
      ["name: p1", "description: p1", "inherits: p2", ""].join("\n"),
    );
    await writeProfile(
      "leaf",
      ["name: leaf", "description: leaf", "inherits: p1", ""].join("\n"),
    );

    let err: unknown;
    try {
      await loadProfile("leaf");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(InheritanceDepthExceeded);
    expect((err as InheritanceDepthExceeded).chain).toEqual([
      "leaf",
      "p1",
      "p2",
      "p3",
      "p4",
    ]);
  });

  test("depth limit boundary: exactly 3 ancestors is allowed", async () => {
    // leaf -> p1 -> p2 -> p3   (3 ancestors, at the limit)
    await writeProfile(
      "p3",
      ["name: p3", "description: root", ""].join("\n"),
    );
    await writeProfile(
      "p2",
      ["name: p2", "description: p2", "inherits: p3", ""].join("\n"),
    );
    await writeProfile(
      "p1",
      ["name: p1", "description: p1", "inherits: p2", ""].join("\n"),
    );
    await writeProfile(
      "leaf",
      ["name: leaf", "description: leaf", "inherits: p1", ""].join("\n"),
    );

    const resolved = await loadProfile("leaf");
    expect(resolved.inheritanceChain).toEqual(["p3", "p2", "p1", "leaf"]);
  });

  test("profile not found: missing dir throws ProfileNotFound", async () => {
    let err: unknown;
    try {
      await loadProfile("does-not-exist");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ProfileNotFound);
    expect((err as ProfileNotFound).code).toBe("PROFILE_NOT_FOUND");
  });

  test("parent not found: missing ancestor surfaces ProfileNotFound", async () => {
    await writeProfile(
      "orphan",
      [
        "name: orphan",
        "description: refers to a missing parent",
        "inherits: ghost",
        "",
      ].join("\n"),
    );

    let err: unknown;
    try {
      await loadProfile("orphan");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ProfileNotFound);
  });

  test("malformed YAML surfaces as SchemaViolation, not a raw parse error", async () => {
    await writeProfile("garbled", "name: : :\n  description: [unbalanced\n");

    let err: unknown;
    try {
      await loadProfile("garbled");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SchemaViolation);
  });
});

describe("listProfiles", () => {
  test("returns sorted names of dirs that contain profile.yaml; skips system dirs", async () => {
    await writeProfile("zeta", "name: zeta\ndescription: z\n");
    await writeProfile("alpha", "name: alpha\ndescription: a\n");
    await writeProfile("mu", "name: mu\ndescription: m\n");

    // System-reserved dirs (leading underscore) and stray dirs without a
    // profile.yaml must not appear.
    await mkdir(join(scratchRoot, "_examples"), { recursive: true });
    await writeFile(
      join(scratchRoot, "_examples", "profile.yaml"),
      "name: nope\ndescription: should be skipped\n",
    );
    await mkdir(join(scratchRoot, "empty-dir"), { recursive: true });

    const names = await listProfiles();
    expect(names).toEqual(["alpha", "mu", "zeta"]);
  });

  test("returns [] when profiles root is missing", async () => {
    process.env.SOUL_PROFILES_DIR = join(scratchRoot, "does-not-exist");
    const names = await listProfiles();
    expect(names).toEqual([]);
  });
});

describe("parseProfileSelector", () => {
  test("plain name returns single-element array", () => {
    expect(parseProfileSelector("postizz")).toEqual(["postizz"]);
  });

  test("composite splits on +", () => {
    expect(parseProfileSelector("a+b+c")).toEqual(["a", "b", "c"]);
  });

  test("whitespace around parts is trimmed", () => {
    expect(parseProfileSelector(" a + b ")).toEqual(["a", "b"]);
  });

  test("empty parts are dropped (trailing +)", () => {
    expect(parseProfileSelector("a+")).toEqual(["a"]);
  });

  test("fully empty selector throws", () => {
    expect(() => parseProfileSelector("+++")).toThrow(/empty/i);
  });

  test("duplicate parts collapse, first-occurrence order preserved", () => {
    // A stale pin / Recent row can carry repeats — loading a profile twice
    // bloats the materialized CLAUDE.md, so the parser de-dupes.
    expect(parseProfileSelector("gstack+higgsfield+postizz+higgsfield+postizz+gstack")).toEqual([
      "gstack",
      "higgsfield",
      "postizz",
    ]);
    expect(parseProfileSelector("a+a+a")).toEqual(["a"]);
  });

  test("isCompositeSelector recognizes ≥2 parts", () => {
    expect(isCompositeSelector("postizz")).toBe(false);
    expect(isCompositeSelector("postizz+trendradar")).toBe(true);
    expect(isCompositeSelector("a+")).toBe(false); // collapses to single
  });
});

describe("loadProfile (composite)", () => {
  test("a+b unions skills, mcps, rules and synthesizes name", async () => {
    await writeProfile(
      "alpha",
      [
        "name: alpha",
        "description: Alpha profile",
        "icon: 🅰️",
        "skills:",
        "  local:",
        "    - foo/one",
        "    - foo/two",
        "mcps:",
        "  - alpha-mcp",
        "rules:",
        "  - alpha/rule",
        "env:",
        '  SHARED: "from-alpha"',
        '  ALPHA_ONLY: "yes"',
        "persona: |",
        "  alpha persona text",
      ].join("\n"),
    );
    await writeProfile(
      "beta",
      [
        "name: beta",
        "description: Beta profile",
        "icon: 🅱️",
        "skills:",
        "  local:",
        "    - foo/two", // overlaps with alpha → dedupes
        "    - bar/three",
        "mcps:",
        "  - beta-mcp",
        "rules:",
        "  - beta/rule",
        "env:",
        '  SHARED: "from-beta"', // collision → later wins
        '  BETA_ONLY: "yes"',
        "persona: |",
        "  beta persona text",
      ].join("\n"),
    );

    const merged = await loadProfile("alpha+beta");

    expect(merged.name).toBe("alpha+beta");
    expect(merged.description).toBe("Alpha profile + Beta profile");
    expect(merged.icon).toBe("🅰️"); // first-non-empty wins
    expect(merged.skills.local.map((s) => s.id)).toEqual([
      "foo/one",
      "foo/two",
      "bar/three",
    ]);
    expect(merged.mcps.map((m) => m.id)).toEqual(["alpha-mcp", "beta-mcp"]);
    expect(merged.rules).toEqual(["alpha/rule", "beta/rule"]);
    expect(merged.env).toEqual({
      SHARED: "from-beta",
      ALPHA_ONLY: "yes",
      BETA_ONLY: "yes",
    });
    expect(merged.persona).toContain("## alpha");
    expect(merged.persona).toContain("alpha persona text");
    expect(merged.persona).toContain("## beta");
    expect(merged.persona).toContain("beta persona text");
    expect(merged.inheritanceChain).toEqual(["alpha", "beta"]);
    expect(merged.inherits).toBeUndefined();
  });

  test("missing component throws ProfileNotFound for that part", async () => {
    await writeProfile(
      "alpha",
      "name: alpha\ndescription: Alpha\n",
    );

    await expect(loadProfile("alpha+ghost")).rejects.toBeInstanceOf(
      ProfileNotFound,
    );
  });

  test("single-element composite (a+) loads like plain a", async () => {
    await writeProfile(
      "alpha",
      "name: alpha\ndescription: Alpha\nicon: 🅰️\n",
    );

    const merged = await loadProfile("alpha+");
    expect(merged.name).toBe("alpha"); // not "alpha+"; collapses to single-part
    expect(merged.icon).toBe("🅰️");
  });
});

// ---------------------------------------------------------------------------
// Real-profile guards. These point the loader at the repo's actual profiles/
// (not a scratch fixture) to pin cross-profile persona policy that fans out
// from core. beforeEach set CUE_PROFILES_DIR to a temp dir; we override it
// here and afterEach restores it, so isolation holds.
// ---------------------------------------------------------------------------
describe("core persona_includes fan-out (real profiles)", () => {
  const REAL_PROFILES = join(REPO_ROOT, "profiles");

  test("core carries the compact integrity include", async () => {
    process.env.CUE_PROFILES_DIR = REAL_PROFILES;
    const core = await loadProfile("core");
    expect(core.personaIncludes).toContain("integrity-protocol-compact");
    expect(core.personaIncludes).toContain("headroom-compression");
  });

  test("codegraph auto-loads across every built-in profile", async () => {
    process.env.CUE_PROFILES_DIR = REAL_PROFILES;
    const entries = await readdir(REAL_PROFILES, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
      try {
        await access(join(REAL_PROFILES, entry.name, "profile.yaml"));
        names.push(entry.name);
      } catch {
        // Reserved or incomplete profile dirs are ignored by the real loader too.
      }
    }

    const missingMcp: string[] = [];
    const missingRouting: string[] = [];
    for (const name of names.sort()) {
      const profile = await loadProfile(name);
      if (!profile.mcps.some((m) => m.id === "codegraph")) missingMcp.push(name);
      if (!profile.personaIncludes.includes("codegraph-routing")) missingRouting.push(name);
    }

    expect(missingMcp).toEqual([]);
    expect(missingRouting).toEqual([]);
  });

  test("core persona includes fan out to a child that defines its own persona", async () => {
    // gstack overrides persona (leaf-wins), so this proves persona_includes is
    // additive — a child keeping its own persona still inherits core's policy
    // includes. Guards against a core edit silently dropping it everywhere.
    process.env.CUE_PROFILES_DIR = REAL_PROFILES;
    const gstack = await loadProfile("gstack");
    expect(gstack.persona).toBeTruthy(); // gstack has its own persona block
    expect(gstack.personaIncludes).toContain("integrity-protocol-compact");
    expect(gstack.personaIncludes).toContain("headroom-compression");
  });
});

describe("mcpPrune resolution", () => {
  test("unset by default", async () => {
    await writeProfile("np", "name: np\ndescription: no prune declared\n");
    const r = await loadProfile("np");
    expect(r.mcpPrune).toBeUndefined();
  });

  test("parsed from a single profile", async () => {
    await writeProfile("pp", "name: pp\ndescription: prune all\nmcpPrune: all\n");
    const r = await loadProfile("pp");
    expect(r.mcpPrune).toBe("all");
  });

  test("leaf wins through single inheritance", async () => {
    await writeProfile("base-prune", "name: base-prune\ndescription: base\nmcpPrune: profile\n");
    await writeProfile(
      "leaf-prune",
      "name: leaf-prune\ndescription: leaf\ninherits: base-prune\nmcpPrune: all\n",
    );
    expect((await loadProfile("leaf-prune")).mcpPrune).toBe("all");
    // Child without its own setting inherits the parent's.
    await writeProfile("leaf-inherit", "name: leaf-inherit\ndescription: leaf2\ninherits: base-prune\n");
    expect((await loadProfile("leaf-inherit")).mcpPrune).toBe("profile");
  });

  test("most-aggressive wins across a composite (off < profile < all)", async () => {
    await writeProfile("cp-off", "name: cp-off\ndescription: off\n");
    await writeProfile("cp-prof", "name: cp-prof\ndescription: profile\nmcpPrune: profile\n");
    await writeProfile("cp-all", "name: cp-all\ndescription: all\nmcpPrune: all\n");
    expect((await loadProfile("cp-off+cp-prof")).mcpPrune).toBe("profile");
    expect((await loadProfile("cp-prof+cp-all")).mcpPrune).toBe("all");
    expect((await loadProfile("cp-off+cp-all")).mcpPrune).toBe("all");
    // No part declares one → undefined.
    await writeProfile("cp-off2", "name: cp-off2\ndescription: off2\n");
    expect((await loadProfile("cp-off+cp-off2")).mcpPrune).toBeUndefined();
  });
});
