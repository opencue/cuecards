/**
 * Tests for `cue audit`.
 *
 * The audit command is a thin dispatcher:
 *   --help / -h  → static help text (hermetic, testable in-process)
 *   default      → delegates to ./security-audit (requires profile resolution)
 *
 * Only the help paths are tested here; the security-audit delegation is covered
 * by the security-related test suite.
 */

import { describe, test, expect } from "bun:test";

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

describe("cue audit --help", () => {
  test("--help returns 0", async () => {
    const { run } = await import("./audit");
    const { code } = await capture(() => run(["--help"]));
    expect(code).toBe(0);
  });

  test("--help prints the command name", async () => {
    const { run } = await import("./audit");
    const { stdout } = await capture(() => run(["--help"]));
    expect(stdout).toContain("cue audit");
  });

  test("--help mentions --security flag", async () => {
    const { run } = await import("./audit");
    const { stdout } = await capture(() => run(["--help"]));
    expect(stdout).toContain("--security");
  });

  test("-h is equivalent to --help (returns 0)", async () => {
    const { run } = await import("./audit");
    const { code, stdout } = await capture(() => run(["-h"]));
    expect(code).toBe(0);
    expect(stdout).toContain("Usage");
  });

  test("--help output contains at least one example", async () => {
    const { run } = await import("./audit");
    const { stdout } = await capture(() => run(["--help"]));
    // The help text has an "Examples:" section
    expect(stdout.toLowerCase()).toContain("example");
  });
});
