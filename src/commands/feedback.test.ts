/**
 * Tests for src/commands/feedback.ts
 *
 * The hermetically-testable surface is very small:
 *   - run(["--help"]) writes help text and returns 0 (no filesystem, no network)
 *
 * Not tested here (and why):
 *   - run([]) (interactive): spawns readline on stdin — not scriptable without
 *     a pseudo-TTY harness.
 *   - run(["--view"]): reads from LOG_PATH which is a module-level constant
 *     computed from XDG_CONFIG_HOME at import time; cannot be redirected
 *     without a dynamic-import setup or preload change.
 *   - run(["--share", ...]): same LOG_PATH issue plus makes a gh CLI call.
 *   - buildIssueBody: pure formatter, not exported — a one-line `export` on that
 *     function would unlock valuable unit tests for its Markdown structure.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { run } from "./feedback";

let stdoutLines: string[];
let origStdoutWrite: typeof process.stdout.write;

beforeEach(() => {
  stdoutLines = [];
  origStdoutWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (chunk: string | Uint8Array) => {
    stdoutLines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  };
});

afterEach(() => {
  process.stdout.write = origStdoutWrite;
});

describe("cue feedback — help text", () => {
  test("--help returns 0 and prints usage block", async () => {
    const code = await run(["--help"]);
    expect(code).toBe(0);
    const out = stdoutLines.join("");
    expect(out).toContain("cue feedback");
    expect(out).toContain("Usage");
    expect(out).toContain("--view");
    expect(out).toContain("--share");
  });

  test("-h returns 0 and prints usage block", async () => {
    const code = await run(["-h"]);
    expect(code).toBe(0);
    const out = stdoutLines.join("");
    expect(out).toContain("cue feedback");
    expect(out).toContain("--view");
  });

  test("help mentions local-only privacy guarantee", async () => {
    const code = await run(["--help"]);
    expect(code).toBe(0);
    // The privacy promise is material: test it's present in the help text
    const out = stdoutLines.join("");
    expect(out.toLowerCase()).toContain("never sent");
  });
});
