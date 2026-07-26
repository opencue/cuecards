/**
 * Tests for src/commands/gc.ts
 *
 * The `parseDaysFlag` helper is not exported, but its effect is observable
 * through run(). `configDir()` reads XDG_CONFIG_HOME at call time (not at
 * import time), so we redirect it to a temp dir for hermetic execution.
 *
 * Coverage:
 *  - disabled path (--days 0)
 *  - empty runtime dir → nothing to remove
 *  - JSON output shape
 *  - stale runtime detection via dry-run
 *  - invalid --days value falls back to DEFAULT_GC_DAYS (30)
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./gc";

// --- Output capture ---

function captureStdout(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (chunk: string | Uint8Array) => {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  };
  return fn().then(
    (code) => { process.stdout.write = orig; return { code, out: lines.join("") }; },
    (err)  => { process.stdout.write = orig; throw err; },
  );
}

// --- Temp-dir / env setup ---

let tmpDir: string;
let savedXDG: string | undefined;
let savedGcDays: string | undefined;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cue-gc-"));
  savedXDG = process.env.XDG_CONFIG_HOME;
  savedGcDays = process.env.CUE_RUNTIME_GC_DAYS;
  // Redirect configDir() to tmpDir — it reads XDG_CONFIG_HOME at call time
  process.env.XDG_CONFIG_HOME = tmpDir;
  // Ensure CUE_RUNTIME_GC_DAYS doesn't leak in from the user's shell
  delete process.env.CUE_RUNTIME_GC_DAYS;
});

afterAll(() => {
  if (savedXDG !== undefined) process.env.XDG_CONFIG_HOME = savedXDG;
  else delete process.env.XDG_CONFIG_HOME;
  if (savedGcDays !== undefined) process.env.CUE_RUNTIME_GC_DAYS = savedGcDays;
  else delete process.env.CUE_RUNTIME_GC_DAYS;
  rmSync(tmpDir, { recursive: true, force: true });
});

// --- Tests ---

describe("cue gc — disabled path", () => {
  test("--days 0 prints 'disabled' and returns 0", async () => {
    const { code, out } = await captureStdout(() => run(["--days", "0"]));
    expect(code).toBe(0);
    expect(out).toContain("disabled");
  });

  test("--days -1 (negative) also prints 'disabled' and returns 0", async () => {
    const { code, out } = await captureStdout(() => run(["--days", "-1"]));
    expect(code).toBe(0);
    expect(out).toContain("disabled");
  });
});

describe("cue gc — empty runtime dir", () => {
  test("dry-run with no runtimes → 'nothing to remove', returns 0", async () => {
    // The configDir() path (tmpDir/cue/runtime) doesn't exist → scanRuntimes returns []
    const { code, out } = await captureStdout(() => run(["--dry-run", "--days", "30"]));
    expect(code).toBe(0);
    expect(out).toContain("nothing to remove");
    // scanned count is 0
    expect(out).toContain("0 runtimes");
  });

  test("--json --dry-run → valid JSON with expected shape", async () => {
    const { code, out } = await captureStdout(() => run(["--json", "--dry-run", "--days", "30"]));
    expect(code).toBe(0);
    const data = JSON.parse(out.trim());
    expect(data).toHaveProperty("maxAgeDays", 30);
    expect(data).toHaveProperty("dryRun", true);
    expect(data).toHaveProperty("scanned", 0);
    expect(Array.isArray(data.victims)).toBe(true);
    expect(data.victims).toEqual([]);
    expect(Array.isArray(data.deleted)).toBe(true);
    expect(data.deleted).toEqual([]);
  });

  test("--json --days 0 → JSON shows maxAgeDays=0", async () => {
    const { code, out } = await captureStdout(() => run(["--json", "--days", "0"]));
    expect(code).toBe(0);
    const data = JSON.parse(out.trim());
    expect(data.maxAgeDays).toBe(0);
  });
});

describe("cue gc — stale runtime detection", () => {
  test("dry-run lists a stale runtime without deleting it", async () => {
    // Create a fake runtime dir with a .cue-last-used timestamp in the far past
    const runtimeRoot = join(tmpDir, "cue", "runtime");
    mkdirSync(runtimeRoot, { recursive: true });
    const staleKey = "stale-profile@test-account";
    const staleDir = join(runtimeRoot, staleKey);
    mkdirSync(staleDir, { recursive: true });
    // Write a last-used timestamp 100 days in the past
    const pastMs = Date.now() - 100 * 86_400_000;
    writeFileSync(join(staleDir, ".cue-last-used"), `${pastMs}\n`);

    const { code, out } = await captureStdout(() => run(["--dry-run", "--days", "30"]));
    expect(code).toBe(0);
    // Reports the stale runtime
    expect(out).toContain(staleKey);
    // Reports "would remove" (dry-run mode)
    expect(out).toContain("would remove");
    // The dir still exists (it was a dry run)
    const { existsSync } = await import("node:fs");
    expect(existsSync(staleDir)).toBe(true);

    // Cleanup for subsequent tests
    rmSync(staleDir, { recursive: true, force: true });
  });

  test("--json dry-run with stale runtime → victims array has the entry", async () => {
    const runtimeRoot = join(tmpDir, "cue", "runtime");
    mkdirSync(runtimeRoot, { recursive: true });
    const staleKey = "json-victim@account";
    const staleDir = join(runtimeRoot, staleKey);
    mkdirSync(staleDir, { recursive: true });
    const pastMs = Date.now() - 60 * 86_400_000;
    writeFileSync(join(staleDir, ".cue-last-used"), `${pastMs}\n`);

    const { code, out } = await captureStdout(() =>
      run(["--json", "--dry-run", "--days", "30"]),
    );
    expect(code).toBe(0);
    const data = JSON.parse(out.trim());
    expect(data.scanned).toBeGreaterThanOrEqual(1);
    expect(data.victims).toContain(staleKey);
    expect(data.deleted).toEqual([]); // dry-run → nothing actually deleted

    rmSync(staleDir, { recursive: true, force: true });
  });
});

describe("cue gc — parseDaysFlag (indirect)", () => {
  test("non-numeric --days value falls back to default (30)", async () => {
    // parseDaysFlag("abc") returns undefined → gcDaysFromEnv() returns 30
    const { code, out } = await captureStdout(() =>
      run(["--dry-run", "--days", "abc"]),
    );
    expect(code).toBe(0);
    // Output should mention 30d threshold (default)
    expect(out).toContain("30");
  });

  test("missing --days flag uses gcDaysFromEnv default (30)", async () => {
    const { code, out } = await captureStdout(() => run(["--dry-run"]));
    expect(code).toBe(0);
    // The default threshold (30d) appears in the "nothing to remove" message
    expect(out).toContain("30");
  });
});
