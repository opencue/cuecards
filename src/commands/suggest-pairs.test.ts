/**
 * Tests for `cue suggest-pairs`.
 *
 * `parseArgs` is the only exported pure helper here — P1 coverage.
 * `run(["--help"])` is tested as a safe P3 smoke test (no file reads on this path).
 */

import { describe, test, expect, spyOn, afterEach } from "bun:test";

import { buildRows, renderTable, parseArgs, run } from "./suggest-pairs";
import { computeAffinityMap } from "../lib/pair-suggestions";

// ---------------------------------------------------------------------------
// buildRows — the here/elsewhere split, pure
// ---------------------------------------------------------------------------

describe("buildRows", () => {
  const at = (profile: string, cwd: string): string =>
    JSON.stringify({ ts: "2026-07-01T00:00:00Z", profile, cwd });
  const fakeRepoRootOf = (dir: string): string | undefined => {
    const m = /^(\/home\/u\/[^/]+)(\/|$)/.exec(dir);
    return m ? m[1] : undefined;
  };
  const maps = (...rows: string[]) => {
    const read = () => rows;
    return {
      here: computeAffinityMap(read, { cwd: "/home/u/api", repoRootOf: fakeRepoRootOf }),
      global: computeAffinityMap(read),
    };
  };
  const opts = { minCount: 1, minAffinity: 0, limit: 5 };

  // Affinity is symmetric (see pair-suggestions: "pairwise co-occurrence in
  // both directions"), so one `a+b` pick reports under both `a` and `b`.
  test("a pairing made in this repo lands under `here`, with nothing left over", () => {
    const { here, global } = maps(at("a+b", "/home/u/api"), at("a+b", "/home/u/api"));
    const rows = buildRows(here, global, opts, null);
    expect(rows.map((r) => `${r.profile}:${r.scope}`)).toEqual(["a:here", "b:here"]);
    expect(rows[0]?.partners.map((p) => p.name)).toEqual(["b"]);
  });

  test("a pairing made only in other repos is reported as `elsewhere`", () => {
    const { here, global } = maps(at("a+c", "/home/u/other"));
    const rows = buildRows(here, global, opts, null);
    expect(rows.map((r) => `${r.profile}:${r.scope}`)).toEqual(["a:elsewhere", "c:elsewhere"]);
    expect(rows[0]?.partners.map((p) => p.name)).toEqual(["c"]);
  });

  test("local rows sort ahead of foreign ones, and a partner is not double-listed", () => {
    const { here, global } = maps(
      at("a+b", "/home/u/api"),
      at("a+c", "/home/u/other"),
      at("z+y", "/home/u/other"),
    );
    const rows = buildRows(here, global, opts, null);
    expect(rows.map((r) => `${r.profile}:${r.scope}`)).toEqual([
      "a:here",
      "b:here",
      "a:elsewhere",
      "c:elsewhere",
      "y:elsewhere",
      "z:elsewhere",
    ]);
    expect(rows[0]?.partners.map((p) => p.name)).toEqual(["b"]);
    // `a` paired with b here and c elsewhere — only c survives the elsewhere row.
    const foreignA = rows.find((r) => r.profile === "a" && r.scope === "elsewhere");
    expect(foreignA?.partners.map((p) => p.name)).toEqual(["c"]);
    // `b`'s only partner is `a`, already shown under `here` → no elsewhere row.
    expect(rows.some((r) => r.profile === "b" && r.scope === "elsewhere")).toBe(false);
  });

  test("--profile narrows both sections to that profile", () => {
    const { here, global } = maps(at("a+b", "/home/u/api"), at("z+y", "/home/u/other"));
    expect(buildRows(here, global, opts, "z").map((r) => r.profile)).toEqual(["z"]);
  });
});

describe("renderTable", () => {
  const partners = [{ name: "b", count: 2, affinity: 1 }];

  test("labels each section so a foreign pairing is never mistaken for a local one", () => {
    const out = renderTable([
      { profile: "a", partners, scope: "here" },
      { profile: "z", partners, scope: "elsewhere" },
    ]);
    expect(out).toContain("in this repository");
    expect(out).toContain("in your other projects");
  });

  test("with no history at all, explains how the table fills in", () => {
    expect(renderTable([])).toContain("No pair suggestions yet.");
  });
});

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
