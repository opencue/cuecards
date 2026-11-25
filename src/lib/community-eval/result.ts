/** The only data allowed out of a community benchmark. Shared by the CLI and collector. */
export const COMMUNITY_MODELS = ["gpt-5.4", "gpt-5.6-sol"] as const;
export const COMMUNITY_BENCHMARK = "codegraph-v1";
export const COMMUNITY_REPORT_BYTES = 4096;
export const COMMUNITY_PAIR_COUNT = 2;
export const COMMUNITY_SCORE_MAX = 3;

export type CommunityModel = (typeof COMMUNITY_MODELS)[number];
export type CommunityArm = {
  score: number;
  durationMs: number;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  codegraphUsed: boolean;
};
export type CommunityReport = {
  version: 1;
  benchmark: typeof COMMUNITY_BENCHMARK;
  model: CommunityModel;
  codexVersion: string;
  codegraphVersion: string;
  pairs: { off: CommunityArm; on: CommunityArm }[];
};

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

function parseArm(value: unknown, available: boolean): CommunityArm {
  const arm = exactRecord(value, ["score", "durationMs", "inputTokens", "cachedInputTokens", "outputTokens", "codegraphUsed"]);
  const { inputTokens: input, cachedInputTokens: cached, outputTokens: output, codegraphUsed } = arm;
  if (typeof codegraphUsed !== "boolean" || (!available && codegraphUsed)) invalid();
  const missing = input === null && cached === null && output === null;
  const inputTokens = missing ? null : integer(input, 0, 10_000_000);
  return {
    score: integer(arm.score, 0, COMMUNITY_SCORE_MAX),
    durationMs: integer(arm.durationMs, 1, 300_000),
    inputTokens,
    cachedInputTokens: missing ? null : integer(cached, 0, inputTokens!),
    outputTokens: missing ? null : integer(output, 0, 10_000_000),
    codegraphUsed,
  };
}

export function parseCommunityReport(value: unknown): CommunityReport {
  const report = exactRecord(value, ["version", "benchmark", "model", "codexVersion", "codegraphVersion", "pairs"]);
  if (report.version !== 1 || report.benchmark !== COMMUNITY_BENCHMARK
      || !isCommunityModel(report.model) || !Array.isArray(report.pairs)
      || report.pairs.length !== COMMUNITY_PAIR_COUNT) invalid();
  return {
    version: 1,
    benchmark: COMMUNITY_BENCHMARK,
    model: report.model,
    codexVersion: version(report.codexVersion),
    codegraphVersion: version(report.codegraphVersion),
    pairs: Array.from(report.pairs, (value: unknown) => {
      const pair = exactRecord(value, ["off", "on"]);
      return { off: parseArm(pair.off, false), on: parseArm(pair.on, true) };
    }),
  };
}
