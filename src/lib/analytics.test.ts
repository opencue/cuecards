import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computeDailyActivity, computeStats } from "./analytics";

// A fixed "now" so the day-bucket math is deterministic regardless of when the
// suite runs. 10:00 UTC means the boundary cases below straddle a UTC midnight.
const NOW = Date.parse("2026-06-03T10:00:00.000Z");

let prevXdg: string | undefined;
let scratch: string;

function writeAnalytics(lines: object[]): void {
  writeFileSync(join(scratch, "cue", "analytics.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}
function writeSessionLog(lines: object[]): void {
  writeFileSync(join(scratch, "cue", "session-log.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}
function bucket(rows: { date: string; sessions: number }[], date: string): number {
  return rows.find((r) => r.date === date)?.sessions ?? -1;
}

beforeEach(() => {
  prevXdg = process.env.XDG_CONFIG_HOME;
  scratch = mkdtempSync(join(tmpdir(), "cue-analytics-test-"));
  mkdirSync(join(scratch, "cue"), { recursive: true });
  process.env.XDG_CONFIG_HOME = scratch;
});

afterEach(() => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  try { rmSync(scratch, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("computeStats — per-repo scoping", () => {
  /** Pretend every path under /home/u/<name> belongs to repo /home/u/<name>. */
  const fakeRepoRootOf = (dir: string): string | undefined => {
    const m = /^(\/home\/u\/[^/]+)(\/|$)/.exec(dir);
    return m ? m[1] : undefined;
  };
  const start = (profile: string, cwd?: string) => ({
    ts: "2026-06-01T00:00:00.000Z",
    event: "start",
    profile,
    ...(cwd === undefined ? {} : { cwd }),
  });
  const sessions = (rows: ReturnType<typeof computeStats>, profile: string): number =>
    rows.find((r) => r.profile === profile)?.sessions ?? 0;

  test("a session from the repo root counts when launching in a subdirectory", () => {
    writeAnalytics([start("rust", "/home/u/api"), start("shop", "/home/u/other")]);
    writeSessionLog([]);
    const out = computeStats({ cwd: "/home/u/api/packages/core", repoRootOf: fakeRepoRootOf });
    expect(sessions(out, "rust")).toBe(1);
    expect(sessions(out, "shop")).toBe(0);
  });

  test("the Stop-hook session log is scoped the same way", () => {
    writeAnalytics([]);
    writeSessionLog([
      { ts: "2026-06-01T00:00:00.000Z", cwd: "/home/u/api/src", profile: "rust", session_id: "A" },
      { ts: "2026-06-01T00:00:00.000Z", cwd: "/home/u/other", profile: "shop", session_id: "B" },
    ]);
    const out = computeStats({ cwd: "/home/u/api", repoRootOf: fakeRepoRootOf });
    expect(sessions(out, "rust")).toBe(1);
    expect(sessions(out, "shop")).toBe(0);
  });

  test("a session with no recorded directory is excluded under a scope", () => {
    writeAnalytics([start("rust")]);
    writeSessionLog([]);
    const out = computeStats({ cwd: "/home/u/api", repoRootOf: fakeRepoRootOf });
    expect(sessions(out, "rust")).toBe(0);
  });

  test("without a scope every session counts", () => {
    writeAnalytics([start("rust", "/home/u/api"), start("shop", "/home/u/other")]);
    writeSessionLog([]);
    const out = computeStats({});
    expect(sessions(out, "rust")).toBe(1);
    expect(sessions(out, "shop")).toBe(1);
  });

  test("outside any repository, scoping falls back to the directory subtree", () => {
    writeAnalytics([start("notes", "/scratch/nb/sub"), start("other", "/scratch/elsewhere")]);
    writeSessionLog([]);
    const out = computeStats({ cwd: "/scratch/nb", repoRootOf: () => undefined });
    expect(sessions(out, "notes")).toBe(1);
    expect(sessions(out, "other")).toBe(0);
  });
});

describe("computeDailyActivity", () => {
  test("returns exactly `days` contiguous UTC buckets ending today", () => {
    writeAnalytics([]);
    writeSessionLog([]);
    const out = computeDailyActivity(30, NOW);
    expect(out).toHaveLength(30);
    expect(out[0]!.date).toBe("2026-05-05"); // now - 29 days
    expect(out[29]!.date).toBe("2026-06-03"); // today
    // every bucket present, zero-filled, strictly ascending
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.date > out[i - 1]!.date).toBe(true);
    }
  });

  test("counts a session on its own day", () => {
    writeAnalytics([]);
    writeSessionLog([
      { ts: "2026-05-20T12:00:00.000Z", cwd: "/x", profile: "core", session_id: "S2" },
    ]);
    expect(bucket(computeDailyActivity(30, NOW), "2026-05-20")).toBe(1);
  });

  // Regression for the off-by-one: reading a full `days` span back pulled in the
  // day BEFORE the oldest bucket. A session whose `start` lands there poisoned the
  // dedup set, so its Stop-hook log on the oldest shown day was dropped. With the
  // fix `since` is the oldest bucket's midnight, so the start is simply out of
  // window and the log counts. This bucket is 2 after the fix, 1 before it.
  test("does not drop a session that starts pre-window but logs on the oldest shown day", () => {
    writeAnalytics([
      // out of window after the fix (prior day, 23:00) — must NOT poison dedup
      { ts: "2026-05-04T23:00:00.000Z", event: "start", profile: "core", cwd: "/x", session_id: "S1" },
      // in window, early on the oldest shown day — proves full-day capture
      { ts: "2026-05-05T00:30:00.000Z", event: "start", profile: "core", cwd: "/x", session_id: "S3" },
    ]);
    writeSessionLog([
      { ts: "2026-05-05T01:00:00.000Z", cwd: "/x", profile: "core", session_id: "S1" },
    ]);
    const out = computeDailyActivity(30, NOW);
    expect(bucket(out, "2026-05-05")).toBe(2); // S1 (via log) + S3 (via start)
  });

  test("excludes events before the window entirely", () => {
    writeAnalytics([]);
    writeSessionLog([
      { ts: "2026-05-04T09:00:00.000Z", cwd: "/x", profile: "core", session_id: "OLD" },
    ]);
    const out = computeDailyActivity(30, NOW);
    const total = out.reduce((a, r) => a + r.sessions, 0);
    expect(total).toBe(0);
  });
});
