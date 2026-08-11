import { describe, expect, test } from "bun:test";

import { ANSI, freshnessColor, freshnessLabel } from "./discover-format";

describe("discovery freshness formatting", () => {
  test("invalid timestamps render as unknown instead of NaN", () => {
    expect(freshnessLabel("not-a-date")).toBe("unknown");
    expect(freshnessColor("not-a-date")).toBe(ANSI.gray);
  });
});
