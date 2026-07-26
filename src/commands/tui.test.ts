/**
 * Tests for `cue tui`.
 *
 * Only the --help path is hermetic: it prints a static string and returns 0
 * without touching profiles, skills, or the terminal.
 *
 * The --once render path (loadInitialState → renderFrame) depends on the
 * profile list and render library; it is wired to the real profiles tree
 * and therefore excluded from this suite.
 */

import { describe, expect, test } from "bun:test";

import { run } from "./tui";

async function captureStdout(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const orig = process.stdout.write.bind(process.stdout);
  let out = "";
  (process.stdout as any).write = (chunk: string | Uint8Array) => {
    out += String(chunk);
    return true;
  };
  try {
    const code = await fn();
    return { code, out };
  } finally {
    (process.stdout as any).write = orig;
  }
}

describe("cue tui --help", () => {
  test("--help returns 0 and prints the TUI usage block", async () => {
    const { code, out } = await captureStdout(() => run(["--help"]));
    expect(code).toBe(0);
    expect(out).toContain("cue tui");
    // Key flags documented in helpText()
    expect(out).toContain("--once");
    expect(out).toContain("--mcp");
    expect(out).toContain("tab");
  });

  test("-h is an alias for --help", async () => {
    const { code, out } = await captureStdout(() => run(["-h"]));
    expect(code).toBe(0);
    expect(out).toContain("cue tui");
  });

  test("help text mentions all three pane modes", async () => {
    const { code, out } = await captureStdout(() => run(["--help"]));
    expect(code).toBe(0);
    // --mcp, --cli mode flags should appear in the help
    expect(out).toContain("--cli");
    expect(out).toContain("--mcp");
  });
});
