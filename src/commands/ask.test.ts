/**
 * Tests for `cue ask`.
 *
 * The hermetic surface is limited to the early-exit paths that do not touch the
 * filesystem.  The skill-lookup path reads the real skills submodule, so those
 * cases are covered by the e2e spawnSync suite below (skip-guarded so they
 * don't fail in CI sandboxes without bun).
 */

import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

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
// In-process hermetic tests (no filesystem access)
// ---------------------------------------------------------------------------

describe("cue ask — hermetic early-exit paths", () => {
  test("no args → returns 1 and prints usage to stderr", async () => {
    const { run } = await import("./ask");
    const { code, stderr } = await capture(() => run([]));
    expect(code).toBe(1);
    expect(stderr).toContain("Usage");
  });

  test("only flag args (all start with -) → returns 1 with usage", async () => {
    // Args are filtered by !a.startsWith("-"); if all args are flags, query is empty.
    const { run } = await import("./ask");
    const { code, stderr } = await capture(() => run(["-v", "--verbose"]));
    expect(code).toBe(1);
    expect(stderr).toContain("Usage");
  });
});

// ---------------------------------------------------------------------------
// E2e spawnSync tests (require bun in PATH)
// ---------------------------------------------------------------------------

const CUE_BIN = join(import.meta.dir, "../index.ts");
const BUN_SPAWNABLE = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;

function cue(args: string[], extraEnv?: Record<string, string>): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("bun", ["run", CUE_BIN, ...args], {
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, ...extraEnv },
  });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe.skipIf(!BUN_SPAWNABLE)("cue ask — e2e", () => {
  test("ask with no args exits 1 and emits usage on stderr", () => {
    const { status, stderr } = cue(["ask"]);
    expect(status).toBe(1);
    expect(stderr).toContain("Usage");
  });

  test("ask for a nonexistent skill exits 1 and reports not found", () => {
    const { status, stderr } = cue(["ask", "totally-nonexistent-skill-xyzabc"]);
    expect(status).toBe(1);
    // Either "not found" or "Skill ... not found"
    expect(stderr.toLowerCase()).toContain("not found");
  });
});
