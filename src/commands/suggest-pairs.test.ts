/**
 * Tests for `cue suggest-pairs`.
 *
 * `parseArgs` is the only exported pure helper here — P1 coverage.
 * `run(["--help"])` is tested as a safe P3 smoke test (no file reads on this path).
 */

import { describe, test, expect, spyOn, afterEach } from "bun:test";

import { parseArgs, run } from "./suggest-pairs";

// ---------------------------------------------------------------------------
// parseArgs — pure function, exhaustive coverage
// ---------------------------------------------------------------------------

describe("parseArgs defaults", () => {
  test("empty argv returns all defaults", () => {
    expect(parseArgs([])).toEqual({
      profile: null,
      minCount: 2,
      minAffinity: 0.5,
      limit: 5,
      json: false,
      help: false,
    });
  });
});

describe("parseArgs flags", () => {
  test("--help sets help:true", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
  });

  test("-h sets help:true", () => {
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  test("--json sets json:true", () => {
    expect(parseArgs(["--json"]).json).toBe(true);
  });

  test("--profile captures the next token", () => {
    expect(parseArgs(["--profile", "core"]).profile).toBe("core");
  });

  test("--profile at end of argv (no value) falls back to null", () => {
    // argv[++i] returns undefined → ?? null
    expect(parseArgs(["--profile"]).profile).toBeNull();
  });
});

describe("parseArgs --min-count", () => {
  test("normal integer is accepted", () => {
    expect(parseArgs(["--min-count", "5"]).minCount).toBe(5);
  });

  test("0 is falsy so the || 2 branch fires, result is 2", () => {
    // Math.max(1, Number("0") || 2) = Math.max(1, 0 || 2) = Math.max(1, 2) = 2
    expect(parseArgs(["--min-count", "0"]).minCount).toBe(2);
  });

  test("negative value: -1 is truthy so || 2 does NOT fire, clamped to 1", () => {
    // Math.max(1, Number("-1") || 2) = Math.max(1, -1) = 1
    expect(parseArgs(["--min-count", "-1"]).minCount).toBe(1);
  });

  test("non-numeric string falls back to 2", () => {
    // NaN is falsy → Math.max(1, NaN || 2) = Math.max(1, 2) = 2
    expect(parseArgs(["--min-count", "abc"]).minCount).toBe(2);
  });
});

describe("parseArgs --min-affinity", () => {
  test("valid float is accepted", () => {
    expect(parseArgs(["--min-affinity", "0.8"]).minAffinity).toBeCloseTo(0.8);
  });

  test("negative value clamps to 0", () => {
    // isFinite(-1) = true; Math.max(0, -1) = 0
    expect(parseArgs(["--min-affinity", "-1"]).minAffinity).toBe(0);
  });

  test("value > 1 clamps to 1", () => {
    // isFinite(2) = true; Math.min(1, Math.max(0, 2)) = 1
    expect(parseArgs(["--min-affinity", "2"]).minAffinity).toBe(1);
  });

  test("non-numeric string falls back to 0.5", () => {
    // Number("abc") = NaN; !isFinite → 0.5
    expect(parseArgs(["--min-affinity", "abc"]).minAffinity).toBe(0.5);
  });

  test("1.5 clamps to 1", () => {
    expect(parseArgs(["--min-affinity", "1.5"]).minAffinity).toBe(1);
  });
});

describe("parseArgs --limit", () => {
  test("normal integer is accepted", () => {
    expect(parseArgs(["--limit", "10"]).limit).toBe(10);
  });

  test("0 is falsy so the || 5 branch fires, result is 5", () => {
    // Math.max(1, Number("0") || 5) = Math.max(1, 5) = 5
    expect(parseArgs(["--limit", "0"]).limit).toBe(5);
  });

  test("non-numeric string falls back to 5", () => {
    expect(parseArgs(["--limit", "bad"]).limit).toBe(5);
  });
});

describe("parseArgs combined", () => {
  test("all flags together are parsed independently", () => {
    const a = parseArgs([
      "--profile", "backend",
      "--min-count", "3",
      "--min-affinity", "0.7",
      "--limit", "8",
      "--json",
    ]);
    expect(a.profile).toBe("backend");
    expect(a.minCount).toBe(3);
    expect(a.minAffinity).toBeCloseTo(0.7);
    expect(a.limit).toBe(8);
    expect(a.json).toBe(true);
    expect(a.help).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// run --help — P3 smoke; safe path that does no I/O
// ---------------------------------------------------------------------------

let stdoutBuf = "";
let stdoutSpy: ReturnType<typeof spyOn>;

function captureStdout() {
  stdoutBuf = "";
  stdoutSpy = spyOn(process.stdout, "write").mockImplementation((s: unknown) => {
    stdoutBuf += String(s);
    return true;
  });
}

afterEach(() => {
  stdoutSpy?.mockRestore();
});

describe("run --help", () => {
  test("returns 0 and prints usage header", async () => {
    captureStdout();
    const code = await run(["--help"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("cue suggest-pairs");
    expect(stdoutBuf).toContain("--profile");
    expect(stdoutBuf).toContain("--min-count");
  });

  test("-h is equivalent to --help", async () => {
    captureStdout();
    const code = await run(["-h"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("cue suggest-pairs");
  });
});
