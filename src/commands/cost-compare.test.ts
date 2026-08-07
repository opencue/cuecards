/**
 * Tests for `cue cost --compare` scoping (Task 8 review, Finding 1).
 *
 * Before this fix, `runCompare()` silently discarded the parsed profile name
 * and always rendered all ~90 profiles, regardless of whether a target
 * profile was passed. That meant `cue cost <profile> --compare` — and the
 * `showCostProof()` call in `init.ts` that relies on it — dumped an
 * all-profiles table instead of a two-way comparison.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { run } from "./cost";

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

describe("cue cost --compare scoping", () => {
  test("a targeted comparison yields exactly the target and `full`", async () => {
    setup();
    const code = await run(["backend", "--compare", "--json"]);
    expect(code).toBe(0);
    const rows = JSON.parse(stdoutBuf) as { name: string }[];
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.name).sort()).toEqual(["backend", "full"]);
  });

  test("an untargeted comparison still returns every profile", async () => {
    setup();
    const code = await run(["--compare", "--json"]);
    expect(code).toBe(0);
    const rows = JSON.parse(stdoutBuf) as { name: string }[];
    expect(rows.length).toBeGreaterThan(2);
    expect(rows.some((r) => r.name === "backend")).toBe(true);
    expect(rows.some((r) => r.name === "full")).toBe(true);
  });

  test("an unknown target falls back to comparing all profiles instead of throwing", async () => {
    setup();
    const code = await run(["zzzz-does-not-exist", "--compare", "--json"]);
    expect(code).toBe(0);
    const rows = JSON.parse(stdoutBuf) as { name: string }[];
    expect(rows.length).toBeGreaterThan(2);
    expect(rows.some((r) => r.name === "full")).toBe(true);
  });
});
