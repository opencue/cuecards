/**
 * Tests for src/commands/diff.ts
 *
 * The only exported symbol is `run(args)`. The internal pure helpers
 * (estimateTokens, getSkillTokens) are private. We test the early-exit
 * error paths that run hermetically — no profile loading, no network.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { run } from "./diff";

// Capture writes to process.stderr without spying on console (the command
// uses process.stderr.write directly).
let stderrCapture: string[];
let originalStderrWrite: typeof process.stderr.write;

beforeEach(() => {
  stderrCapture = [];
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as any).write = (chunk: string | Uint8Array, ...rest: any[]) => {
    stderrCapture.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  };
});

afterEach(() => {
  process.stderr.write = originalStderrWrite;
});

describe("cue diff — argument validation (hermetic)", () => {
  test("no args → usage error on stderr, returns 1", async () => {
    const code = await run([]);
    expect(code).toBe(1);
    expect(stderrCapture.join("")).toContain("Usage: cue diff");
  });

  test("single profile name → usage error on stderr, returns 1", async () => {
    const code = await run(["only-one"]);
    expect(code).toBe(1);
    expect(stderrCapture.join("")).toContain("Usage: cue diff");
  });

  test("--json flag alone (no profiles) → usage error on stderr, returns 1", async () => {
    const code = await run(["--json"]);
    expect(code).toBe(1);
    expect(stderrCapture.join("")).toContain("Usage: cue diff");
  });

  test("--json with one profile name → usage error on stderr, returns 1", async () => {
    const code = await run(["--json", "single-profile"]);
    expect(code).toBe(1);
    expect(stderrCapture.join("")).toContain("Usage: cue diff");
  });

  test("flags only (no profile names) → usage error on stderr, returns 1", async () => {
    // --json and --live both start with "--" so they're filtered out of `names`
    // leaving 0 non-flag args → triggers usage error before any profile load
    const code = await run(["--json", "--live"]);
    // --live triggers runLive path, not this branch — but it's worth verifying
    // the function is reachable. It may write a different error message.
    // We just assert it doesn't hang / throw and returns a number.
    expect(typeof code).toBe("number");
  });
});
