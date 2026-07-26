/**
 * Tests for `cue new` command.
 *
 * The exported surface is just `run()`. Tests cover:
 *  - Help-flag early exit (no filesystem access)
 *  - Argument-parsing errors that return before any I/O
 *  - Happy-path createEmpty using an isolated CUE_PROFILES_DIR temp dir
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { run } from "./new";

// ---------------------------------------------------------------------------
// stdout / stderr capture helpers
// ---------------------------------------------------------------------------

let stdoutBuf = "";
let stderrBuf = "";
let stdoutSpy: ReturnType<typeof spyOn>;
let stderrSpy: ReturnType<typeof spyOn>;

function setupSpies() {
  stdoutBuf = "";
  stderrBuf = "";
  stdoutSpy = spyOn(process.stdout, "write").mockImplementation((s: unknown) => {
    stdoutBuf += String(s);
    return true;
  });
  stderrSpy = spyOn(process.stderr, "write").mockImplementation((s: unknown) => {
    stderrBuf += String(s);
    return true;
  });
}

afterEach(() => {
  stdoutSpy?.mockRestore();
  stderrSpy?.mockRestore();
});

// ---------------------------------------------------------------------------
// Help flag — no filesystem access
// ---------------------------------------------------------------------------

describe("cue new --help", () => {
  test("--help returns 0 and prints usage", async () => {
    setupSpies();
    const code = await run(["--help"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("cue new");
    expect(stdoutBuf).toContain("--from-scan");
  });

  test("-h alias returns 0", async () => {
    setupSpies();
    const code = await run(["-h"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("Usage:");
  });
});

// ---------------------------------------------------------------------------
// Argument-parsing errors (no filesystem access)
// ---------------------------------------------------------------------------

describe("cue new argument errors", () => {
  test("no args → returns 1 with 'missing profile name' in stderr", async () => {
    setupSpies();
    const code = await run([]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("missing profile name");
  });

  test("unknown flag → returns 1 with flag name in stderr", async () => {
    setupSpies();
    const code = await run(["my-profile", "--unknown-flag"]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("--unknown-flag");
  });

  test("invalid profile name (uppercase) → returns 1", async () => {
    setupSpies();
    const code = await run(["INVALID_NAME"]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("invalid profile name");
  });

  test("invalid profile name (spaces) → returns 1", async () => {
    setupSpies();
    const code = await run(["has space"]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("invalid profile name");
  });

  test("--from-scan and --seed together → returns 1", async () => {
    setupSpies();
    const code = await run(["my-profile", "--from-scan", "--seed", "core"]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("--from-scan");
    expect(stderrBuf).toContain("--seed");
  });

  test("--seed without value → returns 1", async () => {
    setupSpies();
    const code = await run(["my-profile", "--seed"]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("--seed");
  });

  test("--domain with unknown value → returns 1", async () => {
    setupSpies();
    const code = await run(["my-profile", "--domain", "not-a-real-domain"]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("--domain");
  });
});

// ---------------------------------------------------------------------------
// Happy path: createEmpty with isolated CUE_PROFILES_DIR
// ---------------------------------------------------------------------------

describe("cue new createEmpty", () => {
  let tmpDir: string;
  let savedEnv: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cue-new-"));
    savedEnv = process.env.CUE_PROFILES_DIR;
    process.env.CUE_PROFILES_DIR = tmpDir;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.CUE_PROFILES_DIR;
    } else {
      process.env.CUE_PROFILES_DIR = savedEnv;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates profile.yaml in CUE_PROFILES_DIR and returns 0", async () => {
    setupSpies();
    const code = await run(["brand-new-profile"]);
    expect(code).toBe(0);
    expect(existsSync(join(tmpDir, "brand-new-profile", "profile.yaml"))).toBe(true);
    expect(stdoutBuf).toContain("Created");
  });

  test("returns 1 when profile already exists (no --force)", async () => {
    setupSpies();
    // Create it once…
    await run(["dupe-profile"]);
    stderrBuf = "";
    // …then try again without --force
    const code = await run(["dupe-profile"]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("dupe-profile");
  });

  test("--force overwrites an existing profile and returns 0", async () => {
    setupSpies();
    // Create it once…
    await run(["force-profile"]);
    stdoutBuf = "";
    // …then overwrite with --force
    const code = await run(["force-profile", "--force"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("Created");
  });
});
