/**
 * Tests for `cue resolve`.
 *
 * The only exported surface is `run(args)`. We test the early-return paths
 * that are hermetic (no index read, no journal write):
 *   - empty query → return 2 with usage message
 *   - flags without query words → return 2 (flags don't constitute a query)
 */

import { describe, expect, test, spyOn } from "bun:test";
import { run } from "./resolve";

function captureIO(fn: () => Promise<number>): Promise<{ stdout: string; consoleErrors: string[]; code: number }> {
  const origOut = process.stdout.write.bind(process.stdout);
  let stdout = "";
  const consoleErrors: string[] = [];
  (process.stdout as any).write = (c: string | Uint8Array) => { stdout += String(c); return true; };
  const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(" "));
  });
  return fn()
    .then(code => ({ stdout, consoleErrors, code }))
    .finally(() => {
      (process.stdout as any).write = origOut;
      spy.mockRestore();
    });
}

describe("cue resolve — empty-query early exit", () => {
  test("no args → returns 2 (no query)", async () => {
    const { code } = await captureIO(() => run([]));
    expect(code).toBe(2);
  });

  test("flags only (no query words) → returns 2", async () => {
    const { code } = await captureIO(() => run(["--json", "--limit", "3"]));
    expect(code).toBe(2);
  });

  test("--no-journal flag without query → returns 2", async () => {
    const { code } = await captureIO(() => run(["--no-journal"]));
    expect(code).toBe(2);
  });

  test("--all flag without query → returns 2", async () => {
    const { code } = await captureIO(() => run(["--all", "--explain"]));
    expect(code).toBe(2);
  });

  test("usage message mentions 'cue resolve' and '--rebuild'", async () => {
    const { consoleErrors } = await captureIO(() => run([]));
    const combined = consoleErrors.join("\n");
    expect(combined).toContain("cue resolve");
    expect(combined).toContain("--rebuild");
  });

  test("--threshold without query → returns 2 (threshold doesn't create a query)", async () => {
    const { code } = await captureIO(() => run(["--threshold", "50"]));
    expect(code).toBe(2);
  });

  test("--profile NAME without query → returns 2", async () => {
    const { code } = await captureIO(() => run(["--profile", "core"]));
    expect(code).toBe(2);
  });
});
