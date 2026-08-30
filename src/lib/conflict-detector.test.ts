import { describe, test, expect } from "bun:test";
import {
  detectConflicts,
  suggestResolutions,
  type Conflict,
} from "./conflict-detector";

describe("detectConflicts", () => {
  test("empty skillIds returns empty array", () => {
    expect(detectConflicts([])).toEqual([]);
  });

  test("non-existent skill IDs are handled gracefully (no files to read)", () => {
    // These skill paths do not exist on disk; the function catches read errors
    // and returns an empty conflict list rather than throwing.
    const conflicts = detectConflicts(["__nonexistent__/skill-a", "__nonexistent__/skill-b"]);
    expect(Array.isArray(conflicts)).toBe(true);
  });

  test("single skill ID returns empty array (no cross-skill conflict possible)", () => {
    const conflicts = detectConflicts(["__nonexistent__/only-skill"]);
    expect(conflicts).toEqual([]);
  });
});

describe("suggestResolutions", () => {
  test("empty conflicts array returns empty array", () => {
    expect(suggestResolutions([])).toEqual([]);
  });

  const makeConflict = (skillA: string, skillB: string): Conflict => ({
    skillA,
    skillB,
    directiveA: "always run tests",
    directiveB: "never run tests",
    domain: "review",
  });

  test("more specific skill (deeper path) gets prioritize-a suggestion", () => {
    const conflict = makeConflict("review/code-review/deep", "review");
    const [res] = suggestResolutions([conflict]);
    expect(res!.suggestion).toBe("prioritize-a");
    expect(res!.reason).toContain("more specific");
  });

  test("when skillB is deeper, prioritize-b is suggested", () => {
    const conflict = makeConflict("review", "review/code-review/deep");
    const [res] = suggestResolutions([conflict]);
    expect(res!.suggestion).toBe("prioritize-b");
    expect(res!.reason).toContain("more specific");
  });

  test("equal-depth skills get alphabetical precedence resolution", () => {
    const conflict = makeConflict("review/deep", "tools/context");
    const [res] = suggestResolutions([conflict]);
    expect(res!.suggestion).toBe("prioritize-a");
    expect(res!.reason).toBe("alphabetical precedence");
  });

  test("result count matches conflict count", () => {
    const conflicts = [
      makeConflict("a/x", "b/y"),
      makeConflict("c/x", "d/y"),
    ];
    expect(suggestResolutions(conflicts)).toHaveLength(2);
  });

  test("each resolution references its original conflict object", () => {
    const conflict = makeConflict("a/x", "b/y");
    const [res] = suggestResolutions([conflict]);
    expect(res!.conflict).toBe(conflict);
  });
});
