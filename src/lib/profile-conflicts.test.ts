import { describe, test, expect } from "bun:test";
import { buildConflictMap, resolveConflicts } from "./profile-conflicts";

describe("buildConflictMap", () => {
  test("returns empty map for empty input", () => {
    expect(buildConflictMap([])).toEqual(new Map());
  });

  test("returns empty map when no conflicts declared", () => {
    const map = buildConflictMap([{ value: "a" }, { value: "b" }]);
    expect(map.size).toBe(0);
  });

  test("builds symmetric entries from one-sided declaration", () => {
    const map = buildConflictMap([
      { value: "a", conflicts: ["b"] },
      { value: "b" },
    ]);
    expect(map.get("a")?.has("b")).toBe(true);
    expect(map.get("b")?.has("a")).toBe(true);
  });

  test("symmetric when both sides declare the conflict (no duplicates in set)", () => {
    const map = buildConflictMap([
      { value: "a", conflicts: ["b"] },
      { value: "b", conflicts: ["a"] },
    ]);
    // Sets deduplicate; each side should have exactly 1 entry
    expect(map.get("a")!.size).toBe(1);
    expect(map.get("b")!.size).toBe(1);
  });

  test("multiple conflicts from one node all registered", () => {
    const map = buildConflictMap([
      { value: "a", conflicts: ["b", "c"] },
    ]);
    expect(map.get("a")?.has("b")).toBe(true);
    expect(map.get("a")?.has("c")).toBe(true);
    // Reverse edges
    expect(map.get("b")?.has("a")).toBe(true);
    expect(map.get("c")?.has("a")).toBe(true);
  });

  test("node with empty conflicts array produces no entries", () => {
    const map = buildConflictMap([{ value: "a", conflicts: [] }]);
    expect(map.size).toBe(0);
  });

  test("node without conflicts property produces no entries", () => {
    const map = buildConflictMap([{ value: "a" }]);
    expect(map.size).toBe(0);
  });
});

describe("resolveConflicts", () => {
  test("returns selection unchanged when no conflicts defined", () => {
    expect(resolveConflicts(["a", "b", "c"], new Map())).toEqual(["a", "b", "c"]);
  });

  test("drops later-appearing item when it conflicts with an earlier one", () => {
    const map = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["a"])],
    ]);
    expect(resolveConflicts(["a", "b"], map)).toEqual(["a"]);
  });

  test("first-in wins: the later item is dropped regardless of direction", () => {
    const map = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["a"])],
    ]);
    expect(resolveConflicts(["b", "a"], map)).toEqual(["b"]);
  });

  test("non-conflicting items interspersed are preserved", () => {
    const map = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["a"])],
    ]);
    expect(resolveConflicts(["a", "c", "b"], map)).toEqual(["a", "c"]);
  });

  test("returns empty array for empty input", () => {
    expect(resolveConflicts([], new Map())).toEqual([]);
  });

  test("selection with no overlap to conflict map is unchanged", () => {
    const map = new Map([["x", new Set(["y"])]]);
    expect(resolveConflicts(["a", "b", "c"], map)).toEqual(["a", "b", "c"]);
  });

  test("item blocked by multiple earlier kept items is dropped once", () => {
    // a conflicts b and c; b and c do not conflict each other
    const map = new Map([
      ["a", new Set(["b", "c"])],
      ["b", new Set(["a"])],
      ["c", new Set(["a"])],
    ]);
    // a is first → a keeps; b blocked by a; c blocked by a → only ["a"]
    expect(resolveConflicts(["a", "b", "c"], map)).toEqual(["a"]);
  });

  test("first-wins: blocked item does not affect non-conflicting followers", () => {
    // b and a conflict; c does not conflict b
    const map = new Map([
      ["a", new Set(["b", "c"])],
      ["b", new Set(["a"])],
      ["c", new Set(["a"])],
    ]);
    // b first → keeps; a blocked by b; c not in b's conflict set → survives
    expect(resolveConflicts(["b", "a", "c"], map)).toEqual(["b", "c"]);
  });
});
