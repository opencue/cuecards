import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { run } from "./mcps";

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

describe("cue mcps run — hermetic paths", () => {
  test("--help returns 0 and prints usage", async () => {
    setup();
    const code = await run(["--help"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("cue mcps");
    expect(stdoutBuf).toContain("Subcommands:");
  });

  test("-h returns 0 and prints usage", async () => {
    setup();
    const code = await run(["-h"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("Usage:");
  });

  test("unknown subcommand returns 1 with error on stderr", async () => {
    setup();
    const code = await run(["doesnotexist"]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("doesnotexist");
  });
});
