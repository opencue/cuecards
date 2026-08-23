/** Pure metrics for the labeled profile-suggestion evaluation harness. */

export interface ProfileSuggestionLabel {
  id: string;
  /** Any one of these profiles is an acceptable answer for this fixture. */
  expected: string[];
  /** Profiles that must not appear in the first suggested stack. */
  forbiddenTop?: string[];
}

export interface ProfileSuggestionPrediction {
  id: string;
  /** Ranked stack parts, e.g. [["medusa-next", "stripe"], ["nextjs"]]. */
  suggestions: string[][];
  latencyMs: number;
}

export interface ProfileSuggestionMetrics {
  cases: number;
  top1Hits: number;
  top2Hits: number;
  forbiddenTopHits: number;
  top1Rate: number;
  top2Rate: number;
  forbiddenTopRate: number;
  p95LatencyMs: number;
}

function hitsExpected(parts: readonly string[] | undefined, expected: ReadonlySet<string>): boolean {
  return parts?.some((part) => expected.has(part)) ?? false;
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
    if (top?.some((part) => forbidden.has(part))) forbiddenTopHits += 1;
    if (prediction) latencies.push(prediction.latencyMs);
  }

  const cases = labels.length;
  const rate = (count: number) => (cases === 0 ? 0 : count / cases);
  return {
    cases,
    top1Hits,
    top2Hits,
    forbiddenTopHits,
    top1Rate: rate(top1Hits),
    top2Rate: rate(top2Hits),
    forbiddenTopRate: rate(forbiddenTopHits),
    p95LatencyMs: percentile(latencies, 0.95),
  };
}
