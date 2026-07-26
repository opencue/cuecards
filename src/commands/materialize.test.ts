import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { run } from "./materialize";

let stdoutBuf = "";
let stderrBuf = "";
let stdoutSpy: ReturnType<typeof spyOn>;
let stderrSpy: ReturnType<typeof spyOn>;

function setup() {
  stdoutBuf = "";
  stderrBuf = "";
  stdoutSpy = spyOn(process.stdout, "write").mockImplementation((s: unknown) => {
    stdoutBuf += String(s);
    return true;
  });
  stderrSpy = spyOn(process.stderr, "write").mockImplementation((s: unknown) => {
    stderrBuf += String(s);
    return true;
  });
}

afterEach(() => {
  stdoutSpy?.mockRestore();
  stderrSpy?.mockRestore();
});

describe("cue materialize run — early-exit paths", () => {
  test("--help prints usage and returns 0", async () => {
    setup();
    const code = await run(["--help"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("cue materialize");
    expect(stdoutBuf).toContain("--dir");
  });

  test("-h alias also returns 0 and prints help", async () => {
    setup();
    const code = await run(["-h"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("Usage:");
  });

  test("no agent and no --all → returns 1 with usage on stderr", async () => {
    // Exits before any profile resolution — only flag-parsing has run.
    setup();
    const code = await run([]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("Usage:");
    expect(stderrBuf).toContain("Agents:");
  });

  test("flags only (no positional, no --all) → returns 1", async () => {
    // --dir without a positional agent and without --all triggers the same guard.
    setup();
    const code = await run(["--dry-run"]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("Agents:");
  });
});
