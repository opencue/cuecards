import { describe, test, expect } from "bun:test";
import {
  compressCombo,
  dedupeSelectorParts,
  DIVIDER_PREFIX,
  SHOW_ALL,
  SKIP_COMBINE,
} from "./selector";

describe("dedupeSelectorParts", () => {
  test("returns unique parts from simple picks", () => {
    expect(dedupeSelectorParts(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  test("deduplicates duplicate picks", () => {
    expect(dedupeSelectorParts(["a", "b", "a"])).toEqual(["a", "b"]);
  });

  test("expands composite picks and dedupes", () => {
    expect(dedupeSelectorParts(["a+b", "b+c"])).toEqual(["a", "b", "c"]);
  });

  test("primary may already be a composite — inner dedup fires", () => {
    expect(dedupeSelectorParts(["core+frontend", "frontend"])).toEqual(["core", "frontend"]);
  });

  test("drops SKIP_COMBINE sentinel", () => {
    expect(dedupeSelectorParts(["a", SKIP_COMBINE, "b"])).toEqual(["a", "b"]);
  });

  test("drops SHOW_ALL sentinel", () => {
    expect(dedupeSelectorParts(["a", SHOW_ALL, "b"])).toEqual(["a", "b"]);
  });

  test("a sentinel embedded in a composite is dropped", () => {
    expect(dedupeSelectorParts([`a+${SKIP_COMBINE}+b`])).toEqual(["a", "b"]);
  });

  test("empty array returns []", () => {
    expect(dedupeSelectorParts([])).toEqual([]);
  });

  test("empty-string parts are dropped", () => {
    // A "+" at start/end produces empty segments
    expect(dedupeSelectorParts(["+a+"])).toEqual(["a"]);
  });

  test("preserves first-seen order", () => {
    expect(dedupeSelectorParts(["c", "a", "b", "a"])).toEqual(["c", "a", "b"]);
  });
});

describe("compressCombo", () => {
  test("renders short combo in full (default max=3)", () => {
    expect(compressCombo(["a", "b", "c"])).toBe("a + b + c");
  });

  test("exactly max parts renders in full", () => {
    expect(compressCombo(["a", "b", "c"], 3)).toBe("a + b + c");
  });

  test("over max collapses to 'first +N more'", () => {
    expect(compressCombo(["a", "b", "c", "d"], 3)).toBe("a +3 more");
  });

  test("single part is not compressed", () => {
    expect(compressCombo(["core"])).toBe("core");
  });

  test("two parts with default max renders in full", () => {
    expect(compressCombo(["a", "b"])).toBe("a + b");
  });

  test("custom max=1 compresses at 2 parts", () => {
    expect(compressCombo(["a", "b"], 1)).toBe("a +1 more");
  });
});

describe("sentinels", () => {
  test("DIVIDER_PREFIX is a non-empty string", () => {
    expect(DIVIDER_PREFIX.length).toBeGreaterThan(0);
  });

  test("SKIP_COMBINE and SHOW_ALL are distinct", () => {
    expect(SKIP_COMBINE).not.toBe(SHOW_ALL);
  });
});
