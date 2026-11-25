import { expect, test } from "bun:test";
import { parseCommunityReport } from "./result";

const arm = { score: 2, durationMs: 1234, inputTokens: 400, cachedInputTokens: 100, outputTokens: 50, codegraphUsed: false };
const pair = { off: arm, on: { ...arm, codegraphUsed: true } };
const report = { version: 1, benchmark: "codegraph-v1", model: "gpt-5.4", codexVersion: "0.172.0", codegraphVersion: "1.6.4", pairs: [pair, pair] };

test("accepts exactly the versioned measurements and preserves missing usage", () => {
  expect(parseCommunityReport(report)).toEqual(report);
  const missing = { ...arm, inputTokens: null, cachedInputTokens: null, outputTokens: null };
  expect(parseCommunityReport({ ...report, pairs: [pair, { ...pair, on: missing }] }).pairs[1]?.on.inputTokens).toBeNull();
});

const completed = { ...arm, score: 6, status: "completed" };
const failed = { ...arm, score: 0, status: "failed", inputTokens: null, cachedInputTokens: null, outputTokens: null };
const v2Pair = { off: completed, on: { ...failed, status: "timeout" } };
const reportV2 = { ...report, version: 2, benchmark: "codegraph-v2", pairs: [v2Pair, { off: failed, on: completed }] };

test("keeps the legacy score bound while accepting six answers and failed arms in v2", () => {
  expect(parseCommunityReport(reportV2)).toEqual(reportV2);
  expect(parseCommunityReport(report)).toEqual(report);
  expect(() => parseCommunityReport({ ...report, version: 2 })).toThrow("BENCHMARK_INVALID_REPORT");
  expect(() => parseCommunityReport({ ...reportV2, version: 1 })).toThrow("BENCHMARK_INVALID_REPORT");
});

test("v2 requires an allowlisted outcome and keeps failed attempts out of answer and token data", () => {
  for (const off of [
    arm, { ...completed, score: 7 }, { ...completed, status: "private error" },
    { ...failed, score: 1 }, { ...failed, status: "timeout", inputTokens: 4, cachedInputTokens: 0, outputTokens: 0 },
    { ...completed, error: "private path" },
  ]) {
    expect(() => parseCommunityReport({ ...reportV2, pairs: [v2Pair, { off, on: completed }] }))
      .toThrow("BENCHMARK_INVALID_REPORT");
  }
  expect(() => parseCommunityReport({ ...reportV2, pairs: [v2Pair, { off: failed, on: { ...failed, codegraphUsed: true } }] }))
    .toThrow("BENCHMARK_INVALID_REPORT");
});

test("rejects private fields, invalid cohorts, incomplete pairs, and invalid metrics", () => {
  for (const bad of [
    { ...report, cwd: "/private/project" },
    { ...report, model: "personal-model-id" },
    { ...report, codexVersion: "private-build" },
    { ...report, pairs: [pair] },
    { ...report, pairs: [pair, { ...pair, transcript: "private" }] },
    ...[
      { prompt: "private" }, { score: 4 }, { durationMs: Infinity }, { durationMs: 300_001 },
      { cachedInputTokens: 401 }, { outputTokens: null }, { inputTokens: -1 },
      { inputTokens: 10_000_001 }, { codegraphUsed: true },
    ].map((fields) => ({ ...report, pairs: [pair, { ...pair, off: { ...arm, ...fields } }] })),
  ]) expect(() => parseCommunityReport(bad)).toThrow("BENCHMARK_INVALID_REPORT");
});
