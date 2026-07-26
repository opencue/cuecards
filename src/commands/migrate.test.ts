/**
 * Tests for `cue migrate` command.
 *
 * migrate.ts has no exported pure helpers — the only exported symbol is
 * `run()`. All non-help code paths scan `PROFILES_DIR = join(repoRoot(),
 * "profiles")` which is computed at module load time with no env-var override,
 * making those paths non-hermetic.
 *
 * Hermetic surface: the help-flag early exit runs before any filesystem I/O.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { run } from "./migrate";

let stdoutBuf = "";
let stdoutSpy: ReturnType<typeof spyOn>;

function setup() {
  stdoutBuf = "";
  stdoutSpy = spyOn(process.stdout, "write").mockImplementation((s: unknown) => {
    stdoutBuf += String(s);
    return true;
  });
}

afterEach(() => {
  stdoutSpy?.mockRestore();
});

describe("cue migrate --help", () => {
  test("--help returns 0 and prints usage text", async () => {
    setup();
    const code = await run(["--help"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("cue migrate");
    expect(stdoutBuf).toContain("--apply");
  });

  test("-h alias also returns 0", async () => {
    setup();
    const code = await run(["-h"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("Usage");
  });
});
