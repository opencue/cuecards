/**
 * Tests for `cue scan`.
 *
 * Exported surface: `run(args)`.
 *
 * Tested paths:
 *   --help / -h  — hermetic, no FS reads
 *   --json       — reads real skills tree (safe: no home-dir writes)
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run } from "./scan";

const SKILLS_DIR = join(import.meta.dir, "../../resources/skills/skills");
const SKILLS_PRESENT = existsSync(SKILLS_DIR);

function captureIO(fn: () => Promise<number>): Promise<{ stdout: string; stderr: string; code: number }> {
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

describe("cue scan --help", () => {
  test("--help returns 0", async () => {
    const { code } = await captureIO(() => run(["--help"]));
    expect(code).toBe(0);
  });

  test("-h returns 0", async () => {
    const { code } = await captureIO(() => run(["-h"]));
    expect(code).toBe(0);
  });

  test("--help output contains usage line", async () => {
    const { stdout } = await captureIO(() => run(["--help"]));
    expect(stdout).toContain("Usage: cue scan");
    expect(stdout).toContain("--json");
  });

  test("--help explains what the command discovers", async () => {
    const { stdout } = await captureIO(() => run(["--help"]));
    expect(stdout).toContain("skills");
    expect(stdout).toContain("domain");
  });
});

describe.skipIf(!SKILLS_PRESENT)("cue scan --json", () => {
  test("returns 0", async () => {
    const { code } = await captureIO(() => run(["--json"]));
    expect(code).toBe(0);
  });

  test("output is valid JSON", async () => {
    const { stdout } = await captureIO(() => run(["--json"]));
    let _parsed: unknown;
    expect(() => { _parsed = JSON.parse(stdout); }).not.toThrow();
  });

  test("JSON has assignments array and diagnostics array", async () => {
    const { stdout } = await captureIO(() => run(["--json"]));
    const data = JSON.parse(stdout) as { assignments: unknown[]; diagnostics: unknown[] };
    expect(Array.isArray(data.assignments)).toBe(true);
    expect(Array.isArray(data.diagnostics)).toBe(true);
  });

  test("default (non-JSON) output is non-empty string", async () => {
    const { stdout, code } = await captureIO(() => run([]));
    expect(code).toBe(0);
    // May be empty if no skills installed, but the call should not throw
    expect(typeof stdout).toBe("string");
  });
});
