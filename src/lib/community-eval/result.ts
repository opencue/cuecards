/** The only data allowed out of a community benchmark. Shared by the CLI and collector. */
export const COMMUNITY_MODELS = ["gpt-5.4", "gpt-5.6-sol"] as const;
export const COMMUNITY_BENCHMARK = "codegraph-v2";
export const LEGACY_COMMUNITY_BENCHMARK = "codegraph-v1";
export const COMMUNITY_REPORT_BYTES = 4096;
export const COMMUNITY_PAIR_COUNT = 2;
export const COMMUNITY_SCORE_MAX = 6;

export type CommunityModel = (typeof COMMUNITY_MODELS)[number];
export type CommunityArm = {
  score: number;
  durationMs: number;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  codegraphUsed: boolean;
};
export type CommunityArmV2 = CommunityArm & {
  status: "completed" | "timeout" | "failed";
};
type ReportFields = {
  model: CommunityModel;
  codexVersion: string;
  codegraphVersion: string;
};
type Pair<T> = { off: T; on: T };
export type CommunityReportV2 = ReportFields & {
  version: 2;
  benchmark: typeof COMMUNITY_BENCHMARK;
  pairs: Pair<CommunityArmV2>[];
};
export type CommunityReport = CommunityReportV2 | (ReportFields & {
  version: 1;
  benchmark: typeof LEGACY_COMMUNITY_BENCHMARK;
  pairs: Pair<CommunityArm>[];
});

export function communityScoreMax(benchmark: CommunityReport["benchmark"]): number {
  return benchmark === LEGACY_COMMUNITY_BENCHMARK ? 3 : COMMUNITY_SCORE_MAX;
}

function invalid(): never {
  throw new Error("BENCHMARK_INVALID_REPORT");
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) invalid();
  return value as Record<string, unknown>;
}

function integer(value: unknown, min: number, max: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : invalid();
}

function version(value: unknown): string {
  return typeof value === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value) ? value : invalid();
}

export function isCommunityModel(value: unknown): value is CommunityModel {
  return COMMUNITY_MODELS.some((model) => model === value);
}

const ARM_KEYS = ["score", "durationMs", "inputTokens", "cachedInputTokens", "outputTokens", "codegraphUsed"];

function parseMetrics(arm: Record<string, unknown>, available: boolean, scoreMax: number): CommunityArm {
  const { inputTokens: input, cachedInputTokens: cached, outputTokens: output, codegraphUsed } = arm;
  if (typeof codegraphUsed !== "boolean" || (!available && codegraphUsed)) invalid();
  const missing = input === null && cached === null && output === null;
  const inputTokens = missing ? null : integer(input, 0, 10_000_000);
  return {
    score: integer(arm.score, 0, scoreMax),
    durationMs: integer(arm.durationMs, 1, 300_000),
    inputTokens,
    cachedInputTokens: inputTokens === null ? null : integer(cached, 0, inputTokens),
    outputTokens: missing ? null : integer(output, 0, 10_000_000),
    codegraphUsed,
  };
}

function parseArmV2(value: unknown, available: boolean): CommunityArmV2 {
  const arm = exactRecord(value, [...ARM_KEYS, "status"]);
  const { status } = arm;
  if (status !== "completed" && status !== "timeout" && status !== "failed") invalid();
  const metrics = parseMetrics(arm, available, COMMUNITY_SCORE_MAX);
  if (status !== "completed" && (metrics.score !== 0 || metrics.inputTokens !== null || metrics.codegraphUsed)) invalid();
  return { ...metrics, status };
}

function parsePairs<T>(pairs: unknown[], parseArm: (arm: unknown, available: boolean) => T): Pair<T>[] {
  return Array.from(pairs, (value) => {
    const pair = exactRecord(value, ["off", "on"]);
    return { off: parseArm(pair.off, false), on: parseArm(pair.on, true) };
  });
}

export function parseCommunityReport(value: unknown): CommunityReport {
  const report = exactRecord(value, ["version", "benchmark", "model", "codexVersion", "codegraphVersion", "pairs"]);
  if (!isCommunityModel(report.model) || !Array.isArray(report.pairs) || report.pairs.length !== COMMUNITY_PAIR_COUNT) invalid();
  const fields = {
    model: report.model,
    codexVersion: version(report.codexVersion),
    codegraphVersion: version(report.codegraphVersion),
  };
  if (report.version === 2 && report.benchmark === COMMUNITY_BENCHMARK) {
    return { version: 2, benchmark: COMMUNITY_BENCHMARK, ...fields, pairs: parsePairs(report.pairs, parseArmV2) };
  }
  if (report.version === 1 && report.benchmark === LEGACY_COMMUNITY_BENCHMARK) {
    const max = communityScoreMax(LEGACY_COMMUNITY_BENCHMARK);
    const pairs = parsePairs(report.pairs, (arm, available) => parseMetrics(exactRecord(arm, ARM_KEYS), available, max));
    return { version: 1, benchmark: LEGACY_COMMUNITY_BENCHMARK, ...fields, pairs };
  }
  return invalid();
}
