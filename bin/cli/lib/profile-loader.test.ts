/**
 * Tests for profile-loader.ts.
 *
 * Each test builds an isolated profiles/ tree under a temp dir and points the
 * loader at it via `SOUL_PROFILES_DIR`. The repo's real `profiles/schema.json`
 * is always used — it is the canonical contract.
 *
 * Run with: `bun test bin/cli/lib/profile-loader.test.ts`
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  InheritanceCycle,
  InheritanceDepthExceeded,
  ProfileNotFound,
  SchemaViolation,
} from "../../../profiles/_types";
import { listProfiles, loadProfile } from "./profile-loader";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const EXAMPLES_DIR = join(REPO_ROOT, "profiles", "_examples");

let scratchRoot: string;
let priorEnv: string | undefined;

beforeEach(async () => {
  scratchRoot = await mkdtemp(join(tmpdir(), "soul-profile-loader-"));
  priorEnv = process.env.SOUL_PROFILES_DIR;
  process.env.SOUL_PROFILES_DIR = scratchRoot;
});

afterEach(() => {
  if (priorEnv === undefined) {
    delete process.env.SOUL_PROFILES_DIR;
  } else {
    process.env.SOUL_PROFILES_DIR = priorEnv;
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
