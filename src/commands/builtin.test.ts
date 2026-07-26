/**
 * Tests for `cue builtin` (list / add / remove).
 *
 * CORE_YAML is a module-level constant set at import time, so write operations
 * (add / remove) MUST run in isolated subprocesses with CUE_PROFILES_DIR
 * pointing at a temp fixture.  The read-only `list` subcommand can be tested
 * in-process against the real core profile.
 *
 * E2e tests are skip-guarded for CI sandboxes without bun.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// capture helper — patches process.stdout/stderr in-process
// ---------------------------------------------------------------------------
function capture(fn: () => Promise<number>): Promise<{ stdout: string; stderr: string; code: number }> {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";
  (process.stdout as any).write = (c: string | Uint8Array) => { stdout += String(c); return true; };
  (process.stderr as any).write = (c: string | Uint8Array) => { stderr += String(c); return true; };
  return fn()
    .then(code => ({ stdout, stderr, code }))
    .finally(() => {
      (process.stdout as any).write = origOut;
      (process.stderr as any).write = origErr;
    });
}

// ---------------------------------------------------------------------------
// In-process tests — read-only; use the real core profile
// ---------------------------------------------------------------------------

describe("cue builtin list (in-process, read-only)", () => {
  test("list returns 0", async () => {
    const { run } = await import("./builtin");
    const { code } = await capture(() => run(["list"]));
    expect(code).toBe(0);
  });

  test("list output mentions built-in skills", async () => {
    const { run } = await import("./builtin");
    const { stdout } = await capture(() => run(["list"]));
    expect(stdout.toLowerCase()).toContain("built-in");
  });

  test("default subcommand (no arg) behaves like list", async () => {
    const { run } = await import("./builtin");
    const { code, stdout } = await capture(() => run([]));
    expect(code).toBe(0);
    // Should print the same header as "list"
    expect(stdout.toLowerCase()).toContain("skill");
  });

  test("list output includes skill count line", async () => {
    const { run } = await import("./builtin");
    const { stdout } = await capture(() => run(["list"]));
    // Format: "  N skill(s) in core."
    expect(stdout).toMatch(/\d+ skill\(s\)/);
  });
});

describe("cue builtin error cases (in-process)", () => {
  test("add with no skill id returns 1 and prints usage to stderr", async () => {
    const { run } = await import("./builtin");
    const { code, stderr } = await capture(() => run(["add"]));
    expect(code).toBe(1);
    expect(stderr).toContain("Usage");
  });

  test("remove with no skill id returns 1 and prints usage to stderr", async () => {
    const { run } = await import("./builtin");
    const { code, stderr } = await capture(() => run(["remove"]));
    expect(code).toBe(1);
    expect(stderr).toContain("Usage");
  });

  test("unknown subcommand returns 1", async () => {
    const { run } = await import("./builtin");
    const { code } = await capture(() => run(["frob"]));
    expect(code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// E2e spawnSync tests — write operations with isolated temp dir fixture
// ---------------------------------------------------------------------------

const CUE_BIN = join(import.meta.dir, "../index.ts");
const BUN_SPAWNABLE = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;

/** Minimal core/profile.yaml with a skills.local section. */
const FIXTURE_YAML = [
  "name: core",
  "description: Test core profile fixture",
  "skills:",
  "  local:",
  "    - meta/analyze",
  "    - meta/help",
].join("\n") + "\n";

let fixtureDir: string;

function setupFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "cue-builtin-e2e-"));
  mkdirSync(join(dir, "core"), { recursive: true });
  writeFileSync(join(dir, "core", "profile.yaml"), FIXTURE_YAML);
  return dir;
}

function cueBuiltin(
  args: string[],
  env: Record<string, string>,
): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("bun", ["run", CUE_BIN, "builtin", ...args], {
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, ...env },
  });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe.skipIf(!BUN_SPAWNABLE)("cue builtin — e2e with isolated fixture", () => {
  beforeEach(() => {
    fixtureDir = setupFixture();
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("list shows skills from fixture profile", () => {
    const env = { CUE_PROFILES_DIR: fixtureDir };
    const { status, stdout } = cueBuiltin(["list"], env);
    expect(status).toBe(0);
    expect(stdout).toContain("meta/analyze");
    expect(stdout).toContain("meta/help");
  });

  test("add inserts a new skill into the profile YAML", () => {
    const env = { CUE_PROFILES_DIR: fixtureDir };
    const { status, stdout } = cueBuiltin(["add", "tools/my-test-skill"], env);
    expect(status).toBe(0);
    expect(stdout).toContain("Added");

    // Verify the YAML was actually written
    const content = readFileSync(join(fixtureDir, "core", "profile.yaml"), "utf8");
    expect(content).toContain("tools/my-test-skill");
  });

  test("add of an already-present skill is idempotent (returns 0, prints already-present)", () => {
    const env = { CUE_PROFILES_DIR: fixtureDir };
    const { status, stdout } = cueBuiltin(["add", "meta/analyze"], env);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toContain("already");
  });

  test("remove deletes a skill from the profile YAML", () => {
    const env = { CUE_PROFILES_DIR: fixtureDir };
    const addResult = cueBuiltin(["add", "tools/removable-skill"], env);
    expect(addResult.status).toBe(0);

    const { status, stdout } = cueBuiltin(["remove", "tools/removable-skill"], env);
    expect(status).toBe(0);
    expect(stdout).toContain("Removed");

    const content = readFileSync(join(fixtureDir, "core", "profile.yaml"), "utf8");
    expect(content).not.toContain("tools/removable-skill");
  });

  test("remove of a nonexistent skill returns 1 with an error message", () => {
    const env = { CUE_PROFILES_DIR: fixtureDir };
    const { status, stderr } = cueBuiltin(["remove", "tools/does-not-exist"], env);
    expect(status).toBe(1);
    expect(stderr.length).toBeGreaterThan(0);
  });

  test("list after add shows the newly added skill", () => {
    const env = { CUE_PROFILES_DIR: fixtureDir };
    cueBuiltin(["add", "review/new-skill"], env);
    const { status, stdout } = cueBuiltin(["list"], env);
    expect(status).toBe(0);
    expect(stdout).toContain("review/new-skill");
  });

  test("list after remove does not show the removed skill", () => {
    const env = { CUE_PROFILES_DIR: fixtureDir };
    cueBuiltin(["add", "review/ephemeral-skill"], env);
    cueBuiltin(["remove", "review/ephemeral-skill"], env);
    const { stdout } = cueBuiltin(["list"], env);
    expect(stdout).not.toContain("review/ephemeral-skill");
  });
});
