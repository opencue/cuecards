import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { PROMOTION_THRESHOLD, recordResolve, resolveCounts, resolveJournalPath } from "./skill-resolve-journal";

// The journal lives under XDG_CONFIG_HOME, so pointing that at a temp dir
// redirects both the writer and the reader without stubbing either.
const home = mkdtempSync(join(tmpdir(), "cue-journal-"));
const originalXdg = process.env.XDG_CONFIG_HOME;
process.env.XDG_CONFIG_HOME = home;

afterAll(() => {
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdg;
  rmSync(home, { recursive: true, force: true });
});

const rec = (id: string, cwd: string) => ({
  ts: "2026-07-26T00:00:00.000Z",
  id,
  cwd,
  profile: "core",
  tier: 2 as const,
  score: 12,
});

beforeEach(() => {
  // recordResolve creates the parent dir itself; the reset has to as well.
  mkdirSync(dirname(resolveJournalPath()), { recursive: true });
  writeFileSync(resolveJournalPath(), "");
});

describe("resolveJournalPath", () => {
  test("honors XDG_CONFIG_HOME", () => {
    expect(resolveJournalPath()).toBe(join(home, "cue", "skill-resolve.jsonl"));
  });
});

describe("recordResolve / resolveCounts", () => {
  test("counts repeat resolutions of the same skill", () => {
    recordResolve(rec("deployment/coolify", "/repo/a"));
    recordResolve(rec("deployment/coolify", "/repo/a"));
    expect(resolveCounts().get("deployment/coolify")).toBe(2);
  });

  test("scopes counts to a directory — the same skill elsewhere doesn't count", () => {
    recordResolve(rec("deployment/coolify", "/repo/a"));
    recordResolve(rec("deployment/coolify", "/repo/b"));
    recordResolve(rec("deployment/coolify", "/repo/b"));

    expect(resolveCounts({ cwd: "/repo/a" }).get("deployment/coolify")).toBe(1);
    expect(resolveCounts({ cwd: "/repo/b" }).get("deployment/coolify")).toBe(2);
    expect(resolveCounts().get("deployment/coolify")).toBe(3);
  });

  test("tracks distinct skills separately", () => {
    recordResolve(rec("a/one", "/repo"));
    recordResolve(rec("b/two", "/repo"));
    const counts = resolveCounts({ cwd: "/repo" });
    expect(counts.get("a/one")).toBe(1);
    expect(counts.get("b/two")).toBe(1);
  });

  test("a torn line doesn't discard the rest of the journal", () => {
    recordResolve(rec("a/one", "/repo"));
    writeFileSync(resolveJournalPath(), `${JSON.stringify(rec("a/one", "/repo"))}\n{"id":"broke\n`, { flag: "a" });
    recordResolve(rec("a/one", "/repo"));
    expect(resolveCounts({ cwd: "/repo" }).get("a/one")).toBe(3);
  });

  test("a missing journal reads as empty rather than throwing", () => {
    rmSync(resolveJournalPath(), { force: true });
    expect(resolveCounts().size).toBe(0);
  });

  test("reaching the promotion threshold is what the suggestion keys off", () => {
    for (let i = 0; i < PROMOTION_THRESHOLD; i++) recordResolve(rec("deployment/coolify", "/repo"));
    expect(resolveCounts({ cwd: "/repo" }).get("deployment/coolify")).toBeGreaterThanOrEqual(PROMOTION_THRESHOLD);
  });
});
