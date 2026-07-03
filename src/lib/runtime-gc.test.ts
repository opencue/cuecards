import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_GC_DAYS,
  gcDaysFromEnv,
  runGc,
  runtimeLastUsedMs,
  scanRuntimes,
  selectGcVictims,
  touchRuntime,
  LAST_USED_MARKER,
} from "./runtime-gc";

const DAY = 86_400_000;

describe("gcDaysFromEnv", () => {
  test("defaults when unset", () => {
    expect(gcDaysFromEnv({})).toBe(DEFAULT_GC_DAYS);
  });
  test("parses a numeric override", () => {
    expect(gcDaysFromEnv({ CUE_RUNTIME_GC_DAYS: "7" })).toBe(7);
  });
  test("0 disables (returned verbatim; selectGcVictims treats <=0 as off)", () => {
    expect(gcDaysFromEnv({ CUE_RUNTIME_GC_DAYS: "0" })).toBe(0);
  });
  test("garbage falls back to the default, not disable", () => {
    expect(gcDaysFromEnv({ CUE_RUNTIME_GC_DAYS: "soon" })).toBe(DEFAULT_GC_DAYS);
  });
});

describe("selectGcVictims", () => {
  const now = 1_000 * DAY;
  const mk = (key: string, ageDays: number) => ({ key, path: `/x/${key}`, lastUsedMs: now - ageDays * DAY });

  test("selects only entries older than the threshold", () => {
    const v = selectGcVictims([mk("old", 40), mk("fresh", 5)], { nowMs: now, maxAgeDays: 30 });
    expect(v.map((e) => e.key)).toEqual(["old"]);
  });

  test("never selects the keepKey even when stale", () => {
    const v = selectGcVictims([mk("old", 40), mk("current", 90)], { nowMs: now, maxAgeDays: 30, keepKey: "current" });
    expect(v.map((e) => e.key)).toEqual(["old"]);
  });

  test("maxAgeDays<=0 disables GC entirely", () => {
    expect(selectGcVictims([mk("ancient", 999)], { nowMs: now, maxAgeDays: 0 })).toEqual([]);
    expect(selectGcVictims([mk("ancient", 999)], { nowMs: now, maxAgeDays: -1 })).toEqual([]);
  });

  test("skips entries with unknown (0) last-used", () => {
    const v = selectGcVictims([{ key: "unknown", path: "/x", lastUsedMs: 0 }], { nowMs: now, maxAgeDays: 30 });
    expect(v).toEqual([]);
  });
});

describe("runtime scan + last-used", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cue-gc-"));
  });
  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ok */ }
  });

  test("marker file wins over mtime", () => {
    const dir = join(root, "core@a");
    mkdirSync(dir, { recursive: true });
    touchRuntime(dir, 123_456);
    expect(runtimeLastUsedMs(dir)).toBe(123_456);
  });

  test("falls back to mtime when no marker", () => {
    const dir = join(root, "core@b");
    mkdirSync(join(dir, "claude"), { recursive: true });
    writeFileSync(join(dir, "claude", ".cue-hash"), "x");
    expect(runtimeLastUsedMs(dir)).toBeGreaterThan(0);
  });

  test("scanRuntimes lists one entry per child dir", () => {
    mkdirSync(join(root, "p1"), { recursive: true });
    mkdirSync(join(root, "p2"), { recursive: true });
    writeFileSync(join(root, "not-a-dir"), "x");
    const entries = scanRuntimes(root);
    expect(entries.map((e) => e.key).sort()).toEqual(["p1", "p2"]);
  });
});

describe("runGc end-to-end (temp root)", () => {
  let root: string;
  const now = 1_000 * DAY;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cue-gcrun-"));
    const stale = join(root, "stale@acct");
    const fresh = join(root, "fresh@acct");
    const current = join(root, "current@acct");
    for (const d of [stale, fresh, current]) mkdirSync(d, { recursive: true });
    writeFileSync(join(stale, LAST_USED_MARKER), `${now - 60 * DAY}\n`);
    writeFileSync(join(fresh, LAST_USED_MARKER), `${now - 2 * DAY}\n`);
    writeFileSync(join(current, LAST_USED_MARKER), `${now - 99 * DAY}\n`);
  });
  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ok */ }
  });

  test("dry-run reports victims but deletes nothing", async () => {
    const r = await runGc({ maxAgeDays: 30, dryRun: true, nowMs: now, runtimeRoot: root });
    expect(r.scanned).toBe(3);
    expect(r.victims.map((v) => v.key).sort()).toEqual(["current@acct", "stale@acct"]);
    expect(r.deleted).toEqual([]);
    expect(existsSync(join(root, "stale@acct"))).toBe(true);
  });

  test("live run deletes stale, keeps fresh and keepKey", async () => {
    const r = await runGc({ maxAgeDays: 30, keepKey: "current@acct", nowMs: now, runtimeRoot: root });
    expect(r.deleted).toEqual(["stale@acct"]);
    expect(existsSync(join(root, "stale@acct"))).toBe(false);
    expect(existsSync(join(root, "fresh@acct"))).toBe(true);
    expect(existsSync(join(root, "current@acct"))).toBe(true); // keepKey survived despite 99d idle
  });
});
