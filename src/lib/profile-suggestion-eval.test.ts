import { describe, expect, test } from "bun:test";
import { percentile, scoreProfileSuggestions } from "./profile-suggestion-eval";

describe("profile suggestion eval metrics", () => {
  test("scores top-1, top-2, forbidden answers, and p95", () => {
    const metrics = scoreProfileSuggestions(
      [
        { id: "a", expected: ["nextjs"], forbiddenTop: ["medusa-vite"] },
        { id: "b", expected: ["rust"] },
        { id: "c", expected: ["python"], forbiddenTop: ["backend"] },
      ],
      [
        { id: "a", suggestions: [["nextjs"]], latencyMs: 5 },
        { id: "b", suggestions: [["backend"], ["rust"]], latencyMs: 10 },
        { id: "c", suggestions: [["backend"], ["core"]], latencyMs: 20 },
      ],
    );
    expect(metrics).toEqual({
      cases: 3,
      top1Hits: 1,
      top2Hits: 2,
      forbiddenTopHits: 1,
      top1Rate: 1 / 3,
      top2Rate: 2 / 3,
      forbiddenTopRate: 1 / 3,
      p95LatencyMs: 20,
    });
  });

  test("percentile handles empty input and nearest-rank boundaries", () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([4, 1, 3, 2], 0.5)).toBe(2);
    expect(percentile([4, 1, 3, 2], 0.95)).toBe(4);
  });
});
