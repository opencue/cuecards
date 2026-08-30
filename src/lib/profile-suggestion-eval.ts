/** Pure metrics for the labeled profile-suggestion evaluation harness. */

export interface ProfileSuggestionLabel {
  id: string;
  /** Any one of these profiles is an acceptable answer for this fixture. */
  expected: string[];
  /** Profiles that must not appear in the first suggested stack. */
  forbiddenTop?: string[];
  /** Exact stack the top suggestion should contain, order-independent. */
  expectedStack?: string[];
  /** Whether the ranker should auto-pin instead of abstaining for this case. */
  expectAutoSelect?: boolean;
}

export interface ProfileSuggestionPrediction {
  id: string;
  /** Ranked stack parts, e.g. [["medusa-next", "stripe"], ["nextjs"]]. */
  suggestions: string[][];
  /** Selector the production decision gate would auto-pin; null means abstain. */
  autoSelection?: string | null;
  latencyMs: number;
}

export interface ProfileSuggestionMetrics {
  cases: number;
  top1Hits: number;
  top2Hits: number;
  forbiddenTopHits: number;
  exactStackCases: number;
  exactStackHits: number;
  companionCases: number;
  companionHits: number;
  companionPredictedParts: number;
  companionCorrectParts: number;
  overfillHits: number;
  simulatedAcceptances: number;
  autoDecisionCases: number;
  autoDecisionsCorrect: number;
  autoSelections: number;
  wrongAutoSelections: number;
  top1Rate: number;
  top2Rate: number;
  forbiddenTopRate: number;
  exactStackRate: number;
  companionRecallRate: number;
  companionPrecision: number;
  overfillRate: number;
  /** Offline proxy: top suggestion has the right shape and no forbidden extras. */
  simulatedAcceptanceRate: number;
  autoDecisionAccuracy: number;
  autoSelectionCoverage: number;
  autoSelectionPrecision: number;
  p95LatencyMs: number;
}

function hitsExpected(parts: readonly string[] | undefined, expected: ReadonlySet<string>): boolean {
  return parts?.some((part) => expected.has(part)) ?? false;
}

function sameParts(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  if (!actual || actual.length !== expected.length) return false;
  const actualSet = new Set(actual);
  return actualSet.size === expected.length && expected.every((part) => actualSet.has(part));
}

export function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export function scoreProfileSuggestions(
  labels: readonly ProfileSuggestionLabel[],
  predictions: readonly ProfileSuggestionPrediction[],
): ProfileSuggestionMetrics {
  const byId = new Map(predictions.map((prediction) => [prediction.id, prediction]));
  let top1Hits = 0;
  let top2Hits = 0;
  let forbiddenTopHits = 0;
  let exactStackCases = 0;
  let exactStackHits = 0;
  let companionCases = 0;
  let companionHits = 0;
  let companionPredictedParts = 0;
  let companionCorrectParts = 0;
  let overfillHits = 0;
  let simulatedAcceptances = 0;
  let autoDecisionCases = 0;
  let autoDecisionsCorrect = 0;
  let autoSelections = 0;
  let wrongAutoSelections = 0;
  const latencies: number[] = [];

  for (const label of labels) {
    const prediction = byId.get(label.id);
    const expected = new Set(label.expected);
    const top = prediction?.suggestions[0];
    if (hitsExpected(top, expected)) top1Hits += 1;
    if (prediction?.suggestions.slice(0, 2).some((parts) => hitsExpected(parts, expected))) {
      top2Hits += 1;
    }
    const forbidden = new Set(label.forbiddenTop ?? []);
    const hasForbidden = top?.some((part) => forbidden.has(part)) ?? false;
    if (hasForbidden) forbiddenTopHits += 1;

    const allowedTop = new Set(label.expectedStack ?? label.expected);
    const hasUnexpected = top?.some((part) => !allowedTop.has(part)) ?? false;
    if (hasUnexpected) overfillHits += 1;

    if (label.expectedStack) {
      exactStackCases += 1;
      if (sameParts(top, label.expectedStack)) exactStackHits += 1;
      if (label.expectedStack.length > 1) {
        companionCases += 1;
        const expectedStack = new Set(label.expectedStack);
        companionPredictedParts += top?.length ?? 0;
        companionCorrectParts += top?.filter((part) => expectedStack.has(part)).length ?? 0;
        if (top && label.expectedStack.every((part) => top.includes(part))) companionHits += 1;
      }
    }

    const accepted = label.expectedStack
      ? sameParts(top, label.expectedStack)
      : hitsExpected(top, expected) && !hasUnexpected;
    if (accepted && !hasForbidden) simulatedAcceptances += 1;

    if (label.expectAutoSelect !== undefined) {
      autoDecisionCases += 1;
      const selected = prediction?.autoSelection?.split("+").filter(Boolean);
      if (selected && selected.length > 0) {
        autoSelections += 1;
        const selectedHasForbidden = selected.some((part) => forbidden.has(part));
        const selectedHasUnexpected = selected.some((part) => !allowedTop.has(part));
        const selectionAccepted = label.expectedStack
          ? sameParts(selected, label.expectedStack)
          : hitsExpected(selected, expected) && !selectedHasUnexpected;
        if (label.expectAutoSelect && selectionAccepted && !selectedHasForbidden) {
          autoDecisionsCorrect += 1;
        } else {
          wrongAutoSelections += 1;
        }
      } else if (!label.expectAutoSelect) {
        autoDecisionsCorrect += 1;
      }
    }
    if (prediction) latencies.push(prediction.latencyMs);
  }

  const cases = labels.length;
  const rate = (count: number) => (cases === 0 ? 0 : count / cases);
  return {
    cases,
    top1Hits,
    top2Hits,
    forbiddenTopHits,
    exactStackCases,
    exactStackHits,
    companionCases,
    companionHits,
    companionPredictedParts,
    companionCorrectParts,
    overfillHits,
    simulatedAcceptances,
    autoDecisionCases,
    autoDecisionsCorrect,
    autoSelections,
    wrongAutoSelections,
    top1Rate: rate(top1Hits),
    top2Rate: rate(top2Hits),
    forbiddenTopRate: rate(forbiddenTopHits),
    exactStackRate: exactStackCases === 0 ? 0 : exactStackHits / exactStackCases,
    companionRecallRate: companionCases === 0 ? 0 : companionHits / companionCases,
    companionPrecision:
      companionPredictedParts === 0 ? 0 : companionCorrectParts / companionPredictedParts,
    overfillRate: rate(overfillHits),
    simulatedAcceptanceRate: rate(simulatedAcceptances),
    autoDecisionAccuracy:
      autoDecisionCases === 0 ? 0 : autoDecisionsCorrect / autoDecisionCases,
    autoSelectionCoverage: autoDecisionCases === 0 ? 0 : autoSelections / autoDecisionCases,
    autoSelectionPrecision:
      autoSelections === 0 ? 0 : (autoSelections - wrongAutoSelections) / autoSelections,
    p95LatencyMs: percentile(latencies, 0.95),
  };
}
