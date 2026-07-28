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

  test("records the launch directory so combos can be scoped per repo", () => {
    const { lines, append } = capture();
    recordCombo(["a", "b"], "t", append, "/home/u/proj");
    expect((JSON.parse(lines[0]!) as ComboRecord).cwd).toBe("/home/u/proj");
  });

  test("omits cwd when the caller has no directory to attribute", () => {
    const { lines, append } = capture();
    recordCombo(["a", "b"], "t", append);
    expect((JSON.parse(lines[0]!) as ComboRecord).cwd).toBeUndefined();
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

  /** A cwd-attributed history row, the shape `recordCombo` writes today. */
  const row = (ts: string, profile: string, cwd: string): string =>
    JSON.stringify({ ts, profile, primary: profile.split("+")[0], cwd });

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

  /** Pretend every path under /home/u/<name> belongs to repo /home/u/<name>. */
  const fakeRepoRootOf = (dir: string): string | undefined => {
    const m = /^(\/home\/u\/[^/]+)(\/|$)/.exec(dir);
    return m ? m[1] : undefined;
  };

  test("a launch inside the repo sees a stack confirmed at the repo root", () => {
    withLog([row("2026-07-01T00:00:00Z", "a+b", "/home/u/api")], (path) => {
      const out = readCombos(path, {
        cwd: "/home/u/api/packages/core",
        repoRootOf: fakeRepoRootOf,
      });
      expect(out[0]?.here).toBe(1);
    });
  });

  test("a stack from a different repo is never `here`", () => {
    withLog([row("2026-07-01T00:00:00Z", "a+b", "/home/u/other/src")], (path) => {
      const out = readCombos(path, { cwd: "/home/u/api", repoRootOf: fakeRepoRootOf });
      expect(out[0]?.here).toBe(0);
    });
  });

  test("outside any repo, scoping falls back to the directory subtree", () => {
    withLog(
      [
        row("2026-07-01T00:00:00Z", "a+b", "/scratch/notes/sub"),
        row("2026-07-02T00:00:00Z", "c+d", "/scratch/elsewhere"),
      ],
      (path) => {
        const out = readCombos(path, { cwd: "/scratch/notes", repoRootOf: () => undefined });
        expect(out.find((c) => c.parts.join("+") === "a+b")?.here).toBe(1);
        expect(out.find((c) => c.parts.join("+") === "c+d")?.here).toBe(0);
      },
    );
  });

  test("`here` counts only rows recorded at or under the scoping directory", () => {
    withLog(
      [
        row("2026-07-01T00:00:00Z", "rust+secops", "/home/u/api"),
        row("2026-07-02T00:00:00Z", "rust+secops", "/home/u/api/crates/core"),
        row("2026-07-03T00:00:00Z", "rust+secops", "/home/u/other"),
        row("2026-07-04T00:00:00Z", "python+ops", "/home/u/other"),
      ],
      (path) => {
        const out = readCombos(path, { cwd: "/home/u/api", repoRootOf: fakeRepoRootOf });
        const rust = out.find((c) => c.parts.join("+") === "rust+secops");
        const python = out.find((c) => c.parts.join("+") === "python+ops");
        expect(rust?.here).toBe(2); // the repo row + the row from a subdirectory
        expect(rust?.count).toBe(3); // global total still counts the other repo
        expect(python?.here).toBe(0);
      },
    );
  });

  test("a sibling directory sharing a name prefix is not `here`", () => {
    withLog([row("2026-07-01T00:00:00Z", "a+b", "/home/u/api-legacy")], (path) => {
      expect(readCombos(path, { cwd: "/home/u/api", repoRootOf: fakeRepoRootOf })[0]?.here).toBe(0);
    });
  });

  test("legacy rows written before cwd was recorded never count as `here`", () => {
    withLog(
      [JSON.stringify({ ts: "2026-07-01T00:00:00Z", profile: "a+b", primary: "a" })],
      (path) => {
        const out = readCombos(path, { cwd: "/home/u/api", repoRootOf: fakeRepoRootOf });
        expect(out[0]?.count).toBe(1);
        expect(out[0]?.here).toBe(0);
      },
    );
  });

  test("`here` stays undefined when no scope is requested (unchanged shape)", () => {
    withLog([row("2026-07-01T00:00:00Z", "a+b", "/home/u/api")], (path) => {
      expect(readCombos(path)[0]?.here).toBeUndefined();
    });
  });

  test("stacks used in this directory sort ahead of more-used foreign stacks", () => {
    withLog(
      [
        row("2026-07-01T00:00:00Z", "here+stack", "/home/u/api"),
        row("2026-07-02T00:00:00Z", "far+stack", "/home/u/other"),
        row("2026-07-03T00:00:00Z", "far+stack", "/home/u/other"),
        row("2026-07-04T00:00:00Z", "far+stack", "/home/u/other"),
      ],
      (path) => {
        const out = readCombos(path, { cwd: "/home/u/api", repoRootOf: fakeRepoRootOf });
        expect(out.map((c) => c.parts.join("+"))).toEqual(["here+stack", "far+stack"]);
      },
    );
  });
});
