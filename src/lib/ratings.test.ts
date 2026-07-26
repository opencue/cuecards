/**
 * ratings.test.ts
 *
 * ratings.ts bakes RATINGS_PATH from XDG_CONFIG_HOME at module load time (a
 * top-level `const`). The only safe way to redirect it in tests is to set
 * XDG_CONFIG_HOME BEFORE the module is first imported. We do this with a
 * top-level await dynamic import: Bun evaluates top-level code (including
 * `process.env.XDG_CONFIG_HOME = tempDir`) AFTER static imports resolve but
 * BEFORE any test runs, so `await import("./ratings")` picks up the env var.
 */

import { describe, test, expect, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up isolated dir BEFORE loading ratings (XDG is read at module init)
const tmpBase = mkdtempSync(join(tmpdir(), "cue-ratings-"));
const savedXdg = process.env.XDG_CONFIG_HOME;
process.env.XDG_CONFIG_HOME = tmpBase;

// Dynamic import after env is set — module bakes RATINGS_PATH from our temp dir
const { rateSkill, getRating, getScore, getAllRatings } = await import("./ratings");

const ratingsFile = join(tmpBase, "cue", "ratings.json");

afterAll(() => {
  if (savedXdg !== undefined) process.env.XDG_CONFIG_HOME = savedXdg;
  else delete process.env.XDG_CONFIG_HOME;
  rmSync(tmpBase, { recursive: true, force: true });
});

beforeEach(() => {
  // Start each test with a clean ratings store
  try { rmSync(ratingsFile); } catch { /* ok if absent */ }
});

describe("getRating", () => {
  test("returns null for unknown skill", () => {
    expect(getRating("never/seen")).toBeNull();
  });
});

describe("getScore", () => {
  test("returns 0 for unknown skill", () => {
    expect(getScore("never/seen")).toBe(0);
  });
});

describe("getAllRatings", () => {
  test("returns empty object when no ratings exist", () => {
    expect(getAllRatings()).toEqual({});
  });
});

describe("rateSkill", () => {
  test("thumbs-up increments up count", () => {
    rateSkill("meta/analyze", true);
    const r = getRating("meta/analyze")!;
    expect(r.up).toBe(1);
    expect(r.down).toBe(0);
  });

  test("thumbs-down increments down count", () => {
    rateSkill("meta/analyze", false);
    const r = getRating("meta/analyze")!;
    expect(r.up).toBe(0);
    expect(r.down).toBe(1);
  });

  test("multiple thumbs-up accumulate", () => {
    rateSkill("meta/help", true);
    rateSkill("meta/help", true);
    rateSkill("meta/help", true);
    expect(getRating("meta/help")!.up).toBe(3);
  });

  test("mixed ratings accumulate independently", () => {
    rateSkill("tools/context7", true);
    rateSkill("tools/context7", false);
    rateSkill("tools/context7", true);
    const r = getRating("tools/context7")!;
    expect(r.up).toBe(2);
    expect(r.down).toBe(1);
  });

  test("sets lastRated to a recent ISO timestamp", () => {
    const before = Date.now();
    rateSkill("meta/analyze", true);
    const after = Date.now();
    const r = getRating("meta/analyze")!;
    const ts = Date.parse(r.lastRated);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test("creates ratings file on disk", () => {
    rateSkill("meta/analyze", true);
    expect(existsSync(ratingsFile)).toBe(true);
  });

  test("persists across multiple skills", () => {
    rateSkill("meta/analyze", true);
    rateSkill("tools/context7", false);
    const all = getAllRatings();
    expect("meta/analyze" in all).toBe(true);
    expect("tools/context7" in all).toBe(true);
  });
});

describe("getScore", () => {
  test("score = up − down", () => {
    rateSkill("plan/autoplan", true);
    rateSkill("plan/autoplan", true);
    rateSkill("plan/autoplan", false);
    expect(getScore("plan/autoplan")).toBe(1);
  });

  test("score can be negative", () => {
    rateSkill("plan/autoplan", false);
    rateSkill("plan/autoplan", false);
    expect(getScore("plan/autoplan")).toBe(-2);
  });

  test("score is 0 for balanced up/down", () => {
    rateSkill("plan/autoplan", true);
    rateSkill("plan/autoplan", false);
    expect(getScore("plan/autoplan")).toBe(0);
  });
});
