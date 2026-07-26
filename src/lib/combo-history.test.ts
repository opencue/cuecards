import { describe, expect, test } from "bun:test";

import { readCombos, recordCombo, type ComboRecord } from "./combo-history";

describe("recordCombo", () => {
  const capture = () => {
    const lines: string[] = [];
    return { lines, append: (l: string) => lines.push(l) };
  };

  test("writes a {ts, profile, primary} row for a real combo (≥2 parts)", () => {
    const { lines, append } = capture();
    const wrote = recordCombo(["gstack", "skill-writer", "core"], "2026-06-02T00:00:00.000Z", append);
    expect(wrote).toBe(true);
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]!) as ComboRecord;
    expect(rec.profile).toBe("gstack+skill-writer+core");
    expect(rec.primary).toBe("gstack");
    expect(rec.ts).toBe("2026-06-02T00:00:00.000Z");
    expect(lines[0]!.endsWith("\n")).toBe(true);
  });

  test("a single-profile pick is not a combo → no write", () => {
    const { lines, append } = capture();
    expect(recordCombo(["gstack"], "t", append)).toBe(false);
    expect(lines).toHaveLength(0);
  });

  test("dedupes parts before recording (so a+a+b → a+b)", () => {
    const { lines, append } = capture();
    recordCombo(["a", "a", "b"], "t", append);
    expect((JSON.parse(lines[0]!) as ComboRecord).profile).toBe("a+b");
  });

  test("dedup that collapses to a single distinct part is not recorded", () => {
    const { lines, append } = capture();
    expect(recordCombo(["a", "a"], "t", append)).toBe(false);
    expect(lines).toHaveLength(0);
  });

  test("trims whitespace and drops empty parts", () => {
    const { lines, append } = capture();
    recordCombo([" a ", "", " b "], "t", append);
    expect((JSON.parse(lines[0]!) as ComboRecord).profile).toBe("a+b");
  });

  test("a throwing append is swallowed (best-effort) → returns false", () => {
    const wrote = recordCombo(["a", "b"], "t", () => {
      throw new Error("disk full");
    });
    expect(wrote).toBe(false);
  });
});

describe("readCombos", () => {
  /** Write a temp history log and read it back through the real path. */
  const withLog = (lines: string[], fn: (path: string) => void): void => {
    const { mkdtempSync, writeFileSync, rmSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "cue-combo-"));
    const path = join(dir, "combos.jsonl");
    writeFileSync(path, lines.join("\n"));
    try {
      fn(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test("aggregates repeats into one row with a count and the newest timestamp", () => {
    withLog(
      [
        JSON.stringify({ ts: "2026-07-01T00:00:00Z", profile: "rust+secops", primary: "rust" }),
        JSON.stringify({ ts: "2026-07-05T00:00:00Z", profile: "rust+secops", primary: "rust" }),
        JSON.stringify({ ts: "2026-07-02T00:00:00Z", profile: "python+ops", primary: "python" }),
      ],
      (path) => {
        const out = readCombos(path);
        expect(out).toEqual([
          { parts: ["rust", "secops"], count: 2, lastUsed: "2026-07-05T00:00:00Z" },
          { parts: ["python", "ops"], count: 1, lastUsed: "2026-07-02T00:00:00Z" },
        ]);
      },
    );
  });

  test("skips malformed lines, blanks and single-profile rows", () => {
    withLog(
      [
        "not json",
        "",
        JSON.stringify({ ts: "2026-07-01T00:00:00Z", profile: "solo", primary: "solo" }),
        JSON.stringify({ ts: "2026-07-01T00:00:00Z", profile: "a+b", primary: "a" }),
      ],
      (path) => {
        expect(readCombos(path).map((c) => c.parts.join("+"))).toEqual(["a+b"]);
      },
    );
  });

  test("a missing log is empty, not an error", () => {
    expect(readCombos("/nonexistent/cue/combos.jsonl")).toEqual([]);
  });
});
