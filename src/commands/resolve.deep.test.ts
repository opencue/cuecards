/**
 * Tests for deepResolve() — the Tier-3 LLM escalation path in `cue resolve`.
 *
 * deepResolve was previously untested (zero tests). These tests cover the
 * deterministic paths that do not require a live Claude binary:
 *
 *   1. Too few candidates (≤4) → returns base rows unchanged.
 *   2. selectRelevantSkills returns classified:false → returns base rows with
 *      an informative note ("deep pass unavailable …").
 *   3. Base rows are always preserved in the fail-open case.
 *   4. A non-empty note is always returned.
 *
 * The tier-3 promotion path (classified:true, result.selected used to build
 * ResultRow with tier===3) requires a live Claude binary and is therefore
 * exercised only in the full e2e suite, not here.
 *
 * Uses `__test.deepResolve` exposed for test purposes only.
 */

import { describe, expect, test } from "bun:test";
import type { IndexEntry, SkillIndex } from "../lib/catalog-index";
import type { ParseQuality } from "../lib/skill-router";
import { __test } from "./resolve";

const { deepResolve, emptyProfile } = __test;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(id: string, description = "", triggers: string[] = []): IndexEntry {
  const parts = id.split("/");
  return {
    id,
    name: parts[parts.length - 1] ?? id,
    category: parts[0] ?? "test",
    description,
    source: `/tmp/${id}/SKILL.md`,
    tags: [],
    triggers,
    capability: "",
    notFor: "",
    links: [],
    requires: { mcps: [] },
    quality: "good" as ParseQuality,
  };
}

function makeIndex(entries: IndexEntry[]): SkillIndex {
  return {
    schema_version: "2.2",
    catalog_mtime: 0,
    counts: {
      skills: entries.length,
      withTriggers: entries.filter((e) => e.triggers.length > 0).length,
      withCapability: 0,
      withRequires: 0,
    },
    skills: entries,
    mcpProviders: {},
  };
}

/** An index with `n` entries that all match the query word via description. */
function makeMatchingIndex(n: number, matchWord: string): SkillIndex {
  // Use a 5+ char word so it passes MIN_TERM_LENGTH=4 tokenizer filter.
  const entries = Array.from({ length: n }, (_, i) =>
    makeEntry(`test/skill-${i}`, `A ${matchWord} helper for developers`),
  );
  return makeIndex(entries);
}

const EMPTY_BASE: never[] = [];
const profile = emptyProfile();
const counts = new Map<string, number>();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deepResolve — too few candidates (≤4)", () => {
  test("returns base rows unchanged when only 1 entry matches", async () => {
    const index = makeMatchingIndex(1, "deploy");
    const baseRow = { id: "existing/skill", tier: 2 } as any;
    const { rows, note } = await deepResolve(index, "deploy", profile, counts, [baseRow], false, 5);
    expect(rows).toStrictEqual([baseRow]);
    expect(note).toBe("too few candidates to classify — Tier 2 results");
  });

  test("returns base rows unchanged when exactly 4 entries match", async () => {
    const index = makeMatchingIndex(4, "deploy");
    const { rows, note } = await deepResolve(index, "deploy", profile, counts, EMPTY_BASE, false, 5);
    expect(rows).toBe(EMPTY_BASE);
    expect(note).toBe("too few candidates to classify — Tier 2 results");
  });

  test("note is always non-empty string on early exit", async () => {
    const index = makeMatchingIndex(3, "build");
    const { note } = await deepResolve(index, "build", profile, counts, EMPTY_BASE, false, 5);
    expect(typeof note).toBe("string");
    expect(note.length).toBeGreaterThan(0);
  });
});

describe("deepResolve — classifier unavailable (fail-open)", () => {
  // In the test environment there is no `claude` binary, so selectRelevantSkills
  // returns classified:false. deepResolve must return the base rows unchanged
  // and produce an informative note.

  test("returns base rows unchanged when classifier is unavailable", async () => {
    // 5 entries so we pass the candidates>4 gate and reach selectRelevantSkills.
    const index = makeMatchingIndex(5, "deploy");
    const baseRows = [{ id: "base/skill", tier: 2 as const }] as any[];
    const { rows } = await deepResolve(index, "deploy", profile, counts, baseRows, false, 5);
    // Fail-open: base rows come back unchanged.
    expect(rows).toStrictEqual(baseRows);
  }, 35_000);

  test("note contains 'Tier 2 results' when classifier is unavailable", async () => {
    const index = makeMatchingIndex(5, "deploy");
    const { note } = await deepResolve(index, "deploy", profile, counts, EMPTY_BASE, false, 5);
    expect(note).toContain("Tier 2 results");
  }, 35_000);

  test("note is non-empty on fail-open", async () => {
    const index = makeMatchingIndex(5, "build");
    const { note } = await deepResolve(index, "build", profile, counts, EMPTY_BASE, false, 5);
    expect(typeof note).toBe("string");
    expect(note.length).toBeGreaterThan(0);
  }, 35_000);
});

describe("deepResolve — base rows invariant", () => {
  test("base rows array identity is preserved on early exit", async () => {
    const index = makeMatchingIndex(2, "search");
    const base = [{ id: "a/b" } as any];
    const { rows } = await deepResolve(index, "search", profile, counts, base, false, 5);
    expect(rows).toBe(base); // same reference, not a copy
  });

  test("empty base stays empty on too-few-candidates path", async () => {
    const index = makeMatchingIndex(1, "search");
    const { rows } = await deepResolve(index, "search", profile, counts, [], false, 5);
    expect(rows).toHaveLength(0);
  });

  test("no entries match → too few candidates → returns base", async () => {
    // none of the entries mention "zork", so candidates.length === 0 ≤ 4
    const index = makeMatchingIndex(10, "deploy");
    const base = [{ id: "x/y" } as any];
    const { rows, note } = await deepResolve(index, "zork", profile, counts, base, false, 5);
    expect(rows).toBe(base);
    expect(note).toContain("too few candidates");
  });
});
