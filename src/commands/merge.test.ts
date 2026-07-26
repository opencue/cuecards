import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { run } from "./merge";

// Capture stdout/stderr writes so tests run silently and can assert content.
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

describe("cue merge run — early-exit paths (no filesystem writes)", () => {
  test("--help prints usage and returns 0", async () => {
    setup();
    const code = await run(["--help"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("cue merge");
    expect(stdoutBuf).toContain("--name");
  });

  test("-h alias also returns 0 and prints help", async () => {
    setup();
    const code = await run(["-h"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("Usage:");
  });

  test("zero profiles → returns 1 with error message", async () => {
    setup();
    const code = await run([]);
    expect(code).toBe(1);
    expect(stderrBuf).toMatch(/at least 2/i);
  });

  test("single profile → returns 1 with error message", async () => {
    setup();
    const code = await run(["medusa-dev"]);
    expect(code).toBe(1);
    expect(stderrBuf).toMatch(/at least 2/i);
  });
});
