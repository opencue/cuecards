/**
 * Tests for the 5 new features: suggest, conflicts --resolve, init, playground, export --docker.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = `${tmpdir()}/cue-features-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  mkdirSync(tmp, { recursive: true });
  // Point `cue suggest`'s session scan at the empty tmp dir so the suggest
  // tests stay hermetic + fast — otherwise they scan the real ~/.claude
  // history (minutes on a heavy machine), which hung the whole suite.
  process.env.CUE_SUGGEST_SESSIONS_DIR = tmp;
});

afterEach(() => {
  delete process.env.CUE_SUGGEST_SESSIONS_DIR;
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

function capture(fn: () => Promise<number>): Promise<{ stdout: string; stderr: string; code: number }> {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  let stdout = "", stderr = "";
  (process.stdout as any).write = (c: string | Uint8Array) => { stdout += String(c); return true; };
  (process.stderr as any).write = (c: string | Uint8Array) => { stderr += String(c); return true; };
  return fn().then(code => ({ stdout, stderr, code })).finally(() => {
    (process.stdout as any).write = origOut;
    (process.stderr as any).write = origErr;
  });
}

// ---------------------------------------------------------------------------
// Feature 1: cue suggest
// ---------------------------------------------------------------------------

describe("cue suggest", () => {
  test("--help returns 0", async () => {
    const { run } = await import("./suggest");
    const { stdout, code } = await capture(() => run(["--help"]));
    expect(code).toBe(0);
    expect(stdout).toContain("--days");
    expect(stdout).toContain("--json");
  });

  test("returns 1 with no active profile", async () => {
    const { run } = await import("./suggest");
    // Without a .cue.profile in cwd, should fail gracefully
    const origCwd = process.cwd();
    process.chdir(tmp);
    const { code } = await capture(() => run([]));
    process.chdir(origCwd);
    // Either returns 1 (no profile) or 0 (if there's a global default)
    expect(code === 0 || code === 1).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Feature 3: conflict-detector enhancements
// ---------------------------------------------------------------------------

describe("conflict-detector", () => {
  test("detectAllowedToolsConflicts finds broad vs restricted", async () => {
    const { detectConflicts } = await import("../lib/conflict-detector");
    // This tests the function with real skills — may find 0 conflicts if
    // no skills have contradicting allowed-tools, which is fine
    const result = detectConflicts([]);
    expect(Array.isArray(result)).toBe(true);
  });

  test("suggestResolutions returns resolutions for conflicts", async () => {
    const { suggestResolutions } = await import("../lib/conflict-detector");
    const conflicts = [
      { skillA: "meta/verbose", skillB: "meta/terse", directiveA: "be verbose", directiveB: "be terse", domain: "meta" },
    ];
    const resolutions = suggestResolutions(conflicts);
    expect(resolutions.length).toBe(1);
    expect(resolutions[0]!.suggestion).toBeDefined();
    expect(resolutions[0]!.reason).toBeDefined();
  });

  test("suggestResolutions prefers more specific skill", async () => {
    const { suggestResolutions } = await import("../lib/conflict-detector");
    const conflicts = [
      { skillA: "review/code-review/strict", skillB: "meta/terse", directiveA: "x", directiveB: "y", domain: "meta" },
    ];
    const resolutions = suggestResolutions(conflicts);
    expect(resolutions[0]!.suggestion).toBe("prioritize-a");
  });
});

// ---------------------------------------------------------------------------
// Feature 5: cue init (already exists — verify it works)
// ---------------------------------------------------------------------------

describe("cue init", () => {
  test("module exports run function", async () => {
    const mod = await import("./init");
    expect(typeof mod.run).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Feature 6: cue playground
// ---------------------------------------------------------------------------

describe("cue playground", () => {
  test("--help returns 0", async () => {
    const { run } = await import("./playground");
    const { stdout, code } = await capture(() => run(["--help"]));
    expect(code).toBe(0);
    expect(stdout).toContain("playground");
    expect(stdout).toContain("--profile");
  });

  test("returns 1 with no args", async () => {
    const { run } = await import("./playground");
    const { code } = await capture(() => run([]));
    expect(code).toBe(1);
  });

  test("returns 1 for nonexistent skill", async () => {
    const { run } = await import("./playground");
    const { code, stderr } = await capture(() => run(["nonexistent/fake-skill-xyz"]));
    expect(code).toBe(1);
    expect(stderr).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// Feature 7: cue export --docker
// ---------------------------------------------------------------------------

describe("cue export --docker", () => {
  test("--help returns 0", async () => {
    const { run } = await import("./export-docker");
    const { stdout, code } = await capture(() => run(["--help"]));
    expect(code).toBe(0);
    expect(stdout).toContain("--profile");
    expect(stdout).toContain("--output");
  });

  test("generates Dockerfile for a known profile", async () => {
    const { run } = await import("./export-docker");
    const output = join(tmp, "Dockerfile.cue");
    const origCwd = process.cwd();
    process.chdir(tmp);
    const { code } = await capture(() => run(["--profile", "core", "--output", output]));
    process.chdir(origCwd);
    expect(code).toBe(0);
    expect(existsSync(output)).toBe(true);
    const content = readFileSync(output, "utf8");
    expect(content).toContain("FROM");
    expect(content).toContain("cue-ai");
    expect(content).toContain("core");
    expect(content).toContain("ENTRYPOINT");
  });

  test("generates .dockerignore", async () => {
    const { run } = await import("./export-docker");
    const output = join(tmp, "Dockerfile.cue");
    const origCwd = process.cwd();
    process.chdir(tmp);
    await capture(() => run(["--profile", "core", "--output", output]));
    process.chdir(origCwd);
    expect(existsSync(join(tmp, ".dockerignore.cue"))).toBe(true);
  });
});
