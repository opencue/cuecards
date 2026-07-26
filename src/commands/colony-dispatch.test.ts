/**
 * Tests for `cue colony-dispatch` — exercises the argument parsing and output
 * format. The underlying resolveProfileForTask() reads resources/colony-profiles.yaml
 * when it exists (gracefully falls back to "full" default when absent), so
 * tests assert structure, not specific profile names that depend on disk state.
 */

import { describe, test, expect } from "bun:test";
import { run } from "./colony-dispatch";

// ---------------------------------------------------------------------------
// Helper: intercept process.stdout / process.stderr for the duration of fn()
// ---------------------------------------------------------------------------

async function captureIO(fn: () => Promise<number>): Promise<{
  stdout: string;
  stderr: string;
  code: number;
}> {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  (process.stdout as any).write = (c: string | Uint8Array) => { out += String(c); return true; };
  (process.stderr as any).write = (c: string | Uint8Array) => { err += String(c); return true; };
  try {
    const code = await fn();
    return { stdout: out, stderr: err, code };
  } finally {
    (process.stdout as any).write = origOut;
    (process.stderr as any).write = origErr;
  }
}

// ---------------------------------------------------------------------------
// Error path — missing task
// ---------------------------------------------------------------------------

describe("colony-dispatch run() — missing task", () => {
  test("empty args exits 1", async () => {
    const { code } = await captureIO(() => run([]));
    expect(code).toBe(1);
  });

  test("empty args prints usage on stderr", async () => {
    const { stderr } = await captureIO(() => run([]));
    expect(stderr).toContain("Usage");
    expect(stderr).toContain("--task");
  });

  test("--json alone is treated as task text (not an empty task), exits 0", async () => {
    // Without --task, all positional args are joined as the task description.
    // "--json" alone is non-empty so the empty-task guard does NOT trigger.
    const { code } = await captureIO(() => run(["--json"]));
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Plain output (no --json)
// ---------------------------------------------------------------------------

describe("colony-dispatch run() — plain output", () => {
  test("--task with a description exits 0", async () => {
    const { code } = await captureIO(() => run(["--task", "review code"]));
    expect(code).toBe(0);
  });

  test("stdout contains a non-empty profile name", async () => {
    const { stdout } = await captureIO(() => run(["--task", "review code"]));
    expect(stdout.trim().length).toBeGreaterThan(0);
    // Must be a valid single token (no newlines in the middle)
    expect(stdout.trim()).not.toMatch(/\n/);
  });

  test("args after --task are joined as the task description", async () => {
    // run(["--task", "review", "PR", "#42"]) should succeed (task = "review PR #42")
    const { code, stdout } = await captureIO(() => run(["--task", "review", "PR", "#42"]));
    expect(code).toBe(0);
    expect(stdout.trim().length).toBeGreaterThan(0);
  });

  test("positional args without --task are treated as the task description", async () => {
    // Without --task, all args are joined
    const { code } = await captureIO(() => run(["some", "task", "description"]));
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

describe("colony-dispatch run() — --json output", () => {
  test("--json flag exits 0", async () => {
    const { code } = await captureIO(() => run(["--task", "review PR", "--json"]));
    expect(code).toBe(0);
  });

  test("--json output is parseable JSON", async () => {
    const { stdout } = await captureIO(() => run(["--task", "review PR", "--json"]));
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  test("--json result has a non-empty string `profile` field", async () => {
    const { stdout } = await captureIO(() => run(["--task", "review PR", "--json"]));
    const data = JSON.parse(stdout);
    expect(typeof data.profile).toBe("string");
    expect(data.profile.length).toBeGreaterThan(0);
  });

  test("--json result has a `matchedKeywords` array", async () => {
    const { stdout } = await captureIO(() => run(["--task", "review PR", "--json"]));
    const data = JSON.parse(stdout);
    expect(Array.isArray(data.matchedKeywords)).toBe(true);
  });

  test("matchedKeywords contains only strings", async () => {
    const { stdout } = await captureIO(() => run(["--task", "review PR", "--json"]));
    const data = JSON.parse(stdout);
    for (const kw of data.matchedKeywords) {
      expect(typeof kw).toBe("string");
    }
  });

  test("unrecognized task returns a default profile (non-empty string)", async () => {
    const { stdout } = await captureIO(() => run(["--task", "xyznonexistent123randomtask", "--json"]));
    const data = JSON.parse(stdout);
    expect(typeof data.profile).toBe("string");
    expect(data.profile.length).toBeGreaterThan(0);
    // The default profile when no rules match
    expect(data.matchedKeywords).toEqual([]);
  });

  test("--json and --task order is commutative", async () => {
    const { code: c1, stdout: s1 } = await captureIO(() => run(["--task", "review code", "--json"]));
    const { code: c2, stdout: s2 } = await captureIO(() => run(["--json", "--task", "review code"]));
    expect(c1).toBe(0);
    expect(c2).toBe(0);
    // Both should produce the same profile resolution
    expect(JSON.parse(s1).profile).toBe(JSON.parse(s2).profile);
  });
});
