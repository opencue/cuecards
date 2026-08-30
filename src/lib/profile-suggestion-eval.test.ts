import { describe, expect, test } from "bun:test";
import { percentile, scoreProfileSuggestions } from "./profile-suggestion-eval";

describe("profile suggestion eval metrics", () => {
  test("scores rank, exact stacks, companion precision, overfill, acceptance, and p95", () => {
    const metrics = scoreProfileSuggestions(
      [
        {
          id: "a",
          expected: ["nextjs"],
          expectedStack: ["nextjs", "stripe"],
          forbiddenTop: ["medusa-vite"],
          expectAutoSelect: true,
        },
        { id: "b", expected: ["rust"], expectAutoSelect: false },
        { id: "c", expected: ["python"], forbiddenTop: ["backend"], expectAutoSelect: false },
        { id: "d", expected: ["vite"], expectedStack: ["vite", "supabase"] },
      ],
      [
        { id: "a", suggestions: [["nextjs", "stripe"]], autoSelection: "nextjs+stripe", latencyMs: 5 },
        { id: "b", suggestions: [["backend"], ["rust"]], autoSelection: null, latencyMs: 10 },
        { id: "c", suggestions: [["backend"], ["core"]], autoSelection: "backend", latencyMs: 20 },
        { id: "d", suggestions: [["vite", "aws"]], latencyMs: 15 },
      ],
    );
    expect(metrics).toEqual({
      cases: 4,
      top1Hits: 2,
      top2Hits: 3,
      forbiddenTopHits: 1,
      exactStackCases: 2,
      exactStackHits: 1,
      companionCases: 2,
      companionHits: 1,
      companionPredictedParts: 4,
      companionCorrectParts: 3,
      overfillHits: 3,
      simulatedAcceptances: 1,
      autoDecisionCases: 3,
      autoDecisionsCorrect: 2,
      autoSelections: 2,
      wrongAutoSelections: 1,
      top1Rate: 1 / 2,
      top2Rate: 3 / 4,
      forbiddenTopRate: 1 / 4,
      exactStackRate: 1 / 2,
      companionRecallRate: 1 / 2,
      companionPrecision: 3 / 4,
      overfillRate: 3 / 4,
      simulatedAcceptanceRate: 1 / 4,
      autoDecisionAccuracy: 2 / 3,
      autoSelectionCoverage: 2 / 3,
      autoSelectionPrecision: 1 / 2,
      p95LatencyMs: 20,
    });
  });

  test("percentile handles empty input and nearest-rank boundaries", () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([4, 1, 3, 2], 0.5)).toBe(2);
    expect(percentile([4, 1, 3, 2], 0.95)).toBe(4);
  });
});
