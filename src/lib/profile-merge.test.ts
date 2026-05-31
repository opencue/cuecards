/**
 * Tests for profile-merge.ts.
 *
 * These run against the repo's real `profiles/` tree (medusa-dev, designer,
 * medusa-vite, medusa-next, core all exist), so they double as a smoke test
 * that the loader + merge wiring stays in sync with the shipped profiles.
 *
 * Run with: `bun test src/lib/profile-merge.test.ts`
 */

import { beforeEach, describe, expect, test } from "bun:test";

import {
  mergeProfiles,
  optimizeMerge,
  renderMerged,
  buildSurfaceRouter,
  type MergePreview,
} from "./profile-merge";
import { loadProfile } from "./profile-loader";
import { parse as parseYaml } from "yaml";

// These tests run against the repo's real profiles/ tree. Sibling test files
// set CUE_PROFILES_DIR / SOUL_PROFILES_DIR to a temp dir; clear any leak so we
// always resolve the real profiles (matches eval/debug/cli test guards).
beforeEach(() => {
  delete process.env.CUE_PROFILES_DIR;
  delete process.env.SOUL_PROFILES_DIR;
});

describe("mergeProfiles", () => {
  test("unions + dedupes skills, excludes core baseline", async () => {
    const p = await mergeProfiles(["medusa-dev", "designer"], { name: "commerce" });
    expect(p.name).toBe("commerce");
    expect(p.names).toEqual(["medusa-dev", "designer"]);
    // Skill ids are unique (no duplicates from the union).
    expect(new Set(p.skills).size).toBe(p.skills.length);
    // Core skills are inherited, not inlined.
    const core = await loadProfile("core");
    const coreIds = new Set(core.skills.local.map((s) => s.id));
    expect(p.skills.some((id) => coreIds.has(id))).toBe(false);
    // Pulls from both sources.
    expect(p.skills.some((id) => id.startsWith("medusa/"))).toBe(true);
    expect(p.skills.some((id) => id.startsWith("design/"))).toBe(true);
  });

  test("skill conflicts are deduped to unique pairs (not per-directive)", async () => {
    const p = await mergeProfiles(["medusa-dev", "designer"]);
    const keys = p.skillConflicts.map((c) => [c.skillA, c.skillB].sort().join("|") + c.domain);
    expect(new Set(keys).size).toBe(keys.length); // no duplicate pairs
  });

  test("surfaces a profile-level conflict between mutually-exclusive sources", async () => {
    // medusa-vite and medusa-next declare each other in `conflicts:`.
    const p = await mergeProfiles(["medusa-vite", "medusa-next"]);
    expect(p.profileConflicts.length).toBeGreaterThan(0);
    const pair = p.profileConflicts[0]!;
    expect([pair.a, pair.b].sort()).toEqual(["medusa-next", "medusa-vite"]);
  });

  test("throws on empty input", async () => {
    await expect(mergeProfiles([])).rejects.toThrow();
  });
});

describe("optimizeMerge", () => {
  function fakePreview(skills: string[], usage: Record<string, number>): MergePreview {
    return {
      names: ["a", "b"], name: "x", icon: "🧩", description: "d",
      skills, dropped: [], npx: [], mcps: ["m1"], plugins: [], env: {},
      rules: [], commands: [], hooks: [], persona: "",
      profileConflicts: [], skillConflicts: [], resolutions: [],
      usage: skills.map((id) => ({ id, references: usage[id] ?? 0, lastSeen: null })),
      estTokens: 0, appliedOptimizations: [],
    };
  }

  test("prune drops zero-usage skills but keeps always-keep", () => {
    const p = fakePreview(
      ["x/used", "x/unused", "meta/find-skills"],
      { "x/used": 3, "x/unused": 0, "meta/find-skills": 0 },
    );
    const out = optimizeMerge(p, ["prune"]);
    expect(out.skills).toContain("x/used");
    expect(out.skills).toContain("meta/find-skills"); // always-keep
    expect(out.skills).not.toContain("x/unused");
    expect(out.dropped).toEqual([{ id: "x/unused", reason: "prune" }]);
    expect(out.appliedOptimizations).toContain("prune");
  });

  test("budget caps to top-N by usage", () => {
    const p = fakePreview(
      ["a/1", "a/2", "a/3", "a/4"],
      { "a/1": 10, "a/2": 8, "a/3": 1, "a/4": 0 },
    );
    const out = optimizeMerge(p, ["budget"], { budget: 2 });
    expect(out.skills).toEqual(["a/1", "a/2"]);
    expect(out.dropped.map((d) => d.id).sort()).toEqual(["a/3", "a/4"]);
  });

  test("router builds a surface table from categories", () => {
    const p = fakePreview(["medusa/x", "medusa/y", "design/z"], {});
    const out = optimizeMerge(p, ["router"]);
    expect(out.persona).toContain("Surface router");
    expect(out.persona).toContain("| medusa/* | 2 |");
    expect(out.persona).toContain("| design/* | 1 |");
  });

  test("is pure — does not mutate input", () => {
    const p = fakePreview(["x/a", "x/b"], { "x/a": 0, "x/b": 0 });
    const before = [...p.skills];
    optimizeMerge(p, ["prune"]);
    expect(p.skills).toEqual(before);
    expect(p.dropped).toEqual([]);
  });
});

describe("renderMerged", () => {
  test("static mode → valid YAML, inherits core, inlines skills", async () => {
    const p = await mergeProfiles(["medusa-dev", "designer"], { name: "commerce" });
    const yaml = renderMerged(p, "static");
    const doc = parseYaml(yaml) as any;
    expect(doc.name).toBe("commerce");
    expect(doc.inherits).toBe("core");
    expect(doc.bundles).toEqual(["medusa-dev", "designer"]);
    expect(Array.isArray(doc.skills.local)).toBe(true);
    expect(doc.skills.local.length).toBe(p.skills.length);
  });

  test("alias mode → thin profile with multi-inherit", async () => {
    const p = await mergeProfiles(["backend", "frontend"], { name: "builder" });
    const yaml = renderMerged(p, "alias");
    const doc = parseYaml(yaml) as any;
    expect(doc.name).toBe("builder");
    expect(doc.inherits).toEqual(["backend", "frontend"]);
    expect(doc.skills).toBeUndefined(); // alias carries no inlined skills
  });

  test("buildSurfaceRouter is deterministic", () => {
    const a = buildSurfaceRouter(["x/1", "y/2", "x/3"], "demo");
    const b = buildSurfaceRouter(["x/1", "y/2", "x/3"], "demo");
    expect(a).toBe(b);
  });
});
