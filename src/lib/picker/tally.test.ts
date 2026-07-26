import { describe, test, expect } from "bun:test";
import {
  EMPTY_TALLY,
  formatCombinedPreview,
  formatOverheadBadge,
  formatStackTotals,
  formatTallyDelta,
  OVERHEAD_WARN_TOKENS,
  type ProfileTally,
  type TallyCounts,
  unionTallyCounts,
} from "./tally";

describe("formatTallyDelta", () => {
  test("all-zero tally returns empty string", () => {
    expect(formatTallyDelta(EMPTY_TALLY)).toBe("");
  });

  test("skills only — singular", () => {
    expect(formatTallyDelta({ skills: ["a"], mcps: [], plugins: [], commands: [] })).toBe("1 skill");
  });

  test("skills only — plural", () => {
    expect(formatTallyDelta({ skills: ["a", "b"], mcps: [], plugins: [], commands: [] })).toBe("2 skills");
  });

  test("mcps only — singular", () => {
    expect(formatTallyDelta({ skills: [], mcps: ["codegraph"], plugins: [], commands: [] })).toBe("1 mcp");
  });

  test("mcps only — plural", () => {
    expect(formatTallyDelta({ skills: [], mcps: ["a", "b"], plugins: [], commands: [] })).toBe("2 mcps");
  });

  test("commands — singular and plural", () => {
    expect(formatTallyDelta({ skills: [], mcps: [], plugins: [], commands: ["x"] })).toBe("1 cmd");
    expect(formatTallyDelta({ skills: [], mcps: [], plugins: [], commands: ["x", "y"] })).toBe("2 cmds");
  });

  test("plugins — singular", () => {
    expect(formatTallyDelta({ skills: [], mcps: [], plugins: ["p"], commands: [] })).toBe("1 plugin");
  });

  test("mixed categories are joined with ' · '", () => {
    const t: ProfileTally = { skills: ["a", "b"], mcps: ["m"], plugins: [], commands: [] };
    expect(formatTallyDelta(t)).toBe("2 skills · 1 mcp");
  });

  test("all four categories present", () => {
    const t: ProfileTally = { skills: ["a"], mcps: ["m"], plugins: ["p"], commands: ["c"] };
    expect(formatTallyDelta(t)).toBe("1 skill · 1 mcp · 1 plugin · 1 cmd");
  });
});

describe("unionTallyCounts", () => {
  test("empty array returns all zeros", () => {
    expect(unionTallyCounts([])).toEqual({ skills: 0, mcps: 0, plugins: 0, commands: 0 });
  });

  test("single tally is counted as-is", () => {
    const t: ProfileTally = { skills: ["a", "b"], mcps: ["m"], plugins: [], commands: ["c"] };
    expect(unionTallyCounts([t])).toEqual({ skills: 2, mcps: 1, plugins: 0, commands: 1 });
  });

  test("deduplicates shared skills across tallies", () => {
    const a: ProfileTally = { skills: ["shared", "unique-a"], mcps: [], plugins: [], commands: [] };
    const b: ProfileTally = { skills: ["shared", "unique-b"], mcps: [], plugins: [], commands: [] };
    expect(unionTallyCounts([a, b]).skills).toBe(3); // shared, unique-a, unique-b
  });

  test("deduplicates shared mcps across tallies", () => {
    const a: ProfileTally = { skills: [], mcps: ["codegraph", "context7"], plugins: [], commands: [] };
    const b: ProfileTally = { skills: [], mcps: ["codegraph"], plugins: [], commands: [] };
    expect(unionTallyCounts([a, b]).mcps).toBe(2); // deduped
  });
});

describe("formatCombinedPreview", () => {
  const base: TallyCounts = { skills: 10, mcps: 2, plugins: 0, commands: 3 };

  test("when combined equals baseline, counts shown without arrow", () => {
    const lines = formatCombinedPreview(base, base);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("skills 10");
    expect(lines[0]).not.toContain("→");
  });

  test("when combined differs, arrow notation is used", () => {
    const combined: TallyCounts = { skills: 15, mcps: 3, plugins: 0, commands: 3 };
    const lines = formatCombinedPreview(base, combined);
    expect(lines[0]).toContain("skills 10→15");
    expect(lines[0]).toContain("mcps 2→3");
  });

  test("zero-count categories are omitted", () => {
    const b: TallyCounts = { skills: 5, mcps: 0, plugins: 0, commands: 0 };
    const lines = formatCombinedPreview(b, b);
    expect(lines[0]).not.toContain("mcps");
    expect(lines[0]).not.toContain("plugins");
    expect(lines[0]).not.toContain("cmds");
  });

  test("all-zero combined returns empty array", () => {
    const zero: TallyCounts = { skills: 0, mcps: 0, plugins: 0, commands: 0 };
    expect(formatCombinedPreview(zero, zero)).toEqual([]);
  });

  test("segments are separated by '  ·  '", () => {
    const b: TallyCounts = { skills: 5, mcps: 1, plugins: 0, commands: 0 };
    const lines = formatCombinedPreview(b, b);
    expect(lines[0]).toContain("  ·  ");
  });
});

describe("formatOverheadBadge", () => {
  test("returns empty string below warn threshold", () => {
    expect(formatOverheadBadge(OVERHEAD_WARN_TOKENS)).toBe("");
  });

  test("returns empty string well below threshold", () => {
    expect(formatOverheadBadge(5000)).toBe("");
  });

  test("returns warning string above threshold", () => {
    const badge = formatOverheadBadge(OVERHEAD_WARN_TOKENS + 1);
    expect(badge.length).toBeGreaterThan(0);
    expect(badge).toContain("⚠");
    expect(badge).toContain("always-on");
    expect(badge).toContain("slows the agent");
  });

  test("large stack shows k suffix and red emoji", () => {
    const badge = formatOverheadBadge(20000);
    expect(badge).toContain("20k");
    expect(badge).toContain("🔴");
  });

  test("moderate over-threshold shows orange emoji", () => {
    // 12k tokens > 10k (orange threshold) but < 15k
    const badge = formatOverheadBadge(12000);
    expect(badge).toContain("🟠");
    expect(badge).toContain("12k");
  });
});

describe("formatStackTotals", () => {
  test("all-zero returns empty string", () => {
    expect(formatStackTotals({ skills: 0, mcps: 0, plugins: 0, commands: 0 })).toBe("");
  });

  test("single category — singular", () => {
    expect(formatStackTotals({ skills: 1, mcps: 0, plugins: 0, commands: 0 })).toBe("1 skill");
  });

  test("single category — plural", () => {
    expect(formatStackTotals({ skills: 31, mcps: 0, plugins: 0, commands: 0 })).toBe("31 skills");
  });

  test("multiple categories joined with ' · '", () => {
    expect(formatStackTotals({ skills: 31, mcps: 2, plugins: 0, commands: 5 })).toBe("31 skills · 2 mcps · 5 cmds");
  });

  test("plugins included when non-zero", () => {
    expect(formatStackTotals({ skills: 0, mcps: 0, plugins: 1, commands: 0 })).toBe("1 plugin");
  });
});
