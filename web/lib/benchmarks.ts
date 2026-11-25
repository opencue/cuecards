import type { Pool } from "pg";

import {
  COMMUNITY_BENCHMARK,
  COMMUNITY_REPORT_BYTES,
  LEGACY_COMMUNITY_BENCHMARK,
  type CommunityReport,
  communityScoreMax,
  parseCommunityReport,
} from "../../src/lib/community-eval/result.js";
import { readLimitedBody } from "./http-utils.js";

const MIN_ACCOUNTS = 5;
const MAX_COHORTS = 20;

type ArmOutcomes = { completed: number; timeout: number; failed: number };

type CohortRow = Pick<CommunityReport, "benchmark" | "model" | "codexVersion" | "codegraphVersion"> & {
  accounts: number;
  pairs: number;
  comparablePairs: number;
  offOutcomes: ArmOutcomes;
  onOutcomes: ArmOutcomes;
  offScore: number;
  onScore: number;
  scoreMax: number;
  wins: number;
  losses: number;
  ties: number;
  usedPairs: number;
  tokenPairs: number;
  comparableAccounts: number;
  improvedAccounts: number;
  regressedAccounts: number;
  tiedAccounts: number;
  meanAccountScoreDeltaPp: number | null;
  meanDurationDeltaMs: number | null;
  meanInputTokenDelta: number | null;
  meanCachedInputTokenDelta: number | null;
  meanOutputTokenDelta: number | null;
};

export type BenchmarkCohort = CohortRow & {
  improvedAccountShare95: { lower: number; upper: number } | null;
  accountDirection: "inconclusive" | "favors-on" | "favors-off";
};

function accountDirection({ improvedAccounts, regressedAccounts }: CohortRow): Pick<BenchmarkCohort, "improvedAccountShare95" | "accountDirection"> {
  const changed = improvedAccounts + regressedAccounts;
  if (changed === 0) return { improvedAccountShare95: null, accountDirection: "inconclusive" };
  // Wilson interval for the share of non-tied accounts with a positive delta.
  const z = 1.959963984540054;
  const p = improvedAccounts / changed;
  const u = z ** 2 / changed;
  const center = (p + u / 2) / (1 + u);
  const half = z * Math.sqrt((p * (1 - p) + u / 4) / changed) / (1 + u);
  const lower = Math.max(0, center - half);
  const upper = Math.min(1, center + half);
  return {
    improvedAccountShare95: { lower, upper },
    accountDirection: changed < MIN_ACCOUNTS ? "inconclusive"
      : lower > 0.5 ? "favors-on" : upper < 0.5 ? "favors-off" : "inconclusive",
  };
}

export class Benchmarks {
  constructor(private readonly db: Pick<Pool, "query">) {}

  async submit(accountId: string, report: CommunityReport): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `INSERT INTO cue_benchmark_report (account_id, benchmark, model, codex_version, codegraph_version, pairs)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (account_id, benchmark, model) DO NOTHING`,
      [accountId, report.benchmark, report.model, report.codexVersion, report.codegraphVersion, JSON.stringify(report.pairs)],
    );
    return rowCount === 1;
  }

  async list(): Promise<BenchmarkCohort[]> {
    const { rows } = await this.db.query<CohortRow>(
      `WITH reported_pairs AS (
         SELECT account_id, benchmark, model, codex_version, codegraph_version,
                CASE benchmark WHEN 'codegraph-v1' THEN $1::int ELSE $2::int END AS pair_max,
                CASE benchmark WHEN 'codegraph-v1' THEN 'completed' ELSE arms->'off'->>'status' END AS off_status,
                CASE benchmark WHEN 'codegraph-v1' THEN 'completed' ELSE arms->'on'->>'status' END AS on_status,
                (arms->'off'->>'score')::int AS off_score,
                (arms->'on'->>'score')::int AS on_score,
                (arms->'on'->>'codegraphUsed')::bool AS used,
                (arms->'on'->>'durationMs')::int - (arms->'off'->>'durationMs')::int AS duration_delta,
                (arms->'on'->>'inputTokens')::int - (arms->'off'->>'inputTokens')::int AS input_delta,
                (arms->'on'->>'cachedInputTokens')::int - (arms->'off'->>'cachedInputTokens')::int AS cached_delta,
                (arms->'on'->>'outputTokens')::int - (arms->'off'->>'outputTokens')::int AS output_delta
           FROM cue_benchmark_report AS report
           CROSS JOIN LATERAL jsonb_array_elements(report.pairs) AS pair(arms)
          WHERE benchmark IN ('codegraph-v1', 'codegraph-v2')
       ), pairs AS (
         SELECT *, (off_status = 'completed' AND on_status = 'completed') AS comparable
           FROM reported_pairs
       ), account_scores AS (
         SELECT benchmark, model, codex_version, codegraph_version, account_id, pair_max,
                avg(on_score - off_score) AS score_delta
           FROM pairs
          WHERE comparable
          GROUP BY benchmark, model, codex_version, codegraph_version, account_id, pair_max
       ), account_comparisons AS (
         SELECT benchmark, model, codex_version, codegraph_version,
                count(*)::float8 AS comparable_accounts,
                (count(*) FILTER (WHERE score_delta > 0))::float8 AS improved_accounts,
                (count(*) FILTER (WHERE score_delta < 0))::float8 AS regressed_accounts,
                (count(*) FILTER (WHERE score_delta = 0))::float8 AS tied_accounts,
                (avg(score_delta) * 100.0 / max(pair_max))::float8 AS mean_account_delta_pp
           FROM account_scores
          GROUP BY benchmark, model, codex_version, codegraph_version
       ), cohorts AS (
         SELECT benchmark, model, codex_version, codegraph_version,
                count(DISTINCT account_id)::float8 AS accounts,
                count(*)::float8 AS pairs,
                (count(*) FILTER (WHERE comparable))::float8 AS comparable_pairs,
                jsonb_build_object('completed', count(*) FILTER (WHERE off_status = 'completed'),
                                   'timeout', count(*) FILTER (WHERE off_status = 'timeout'),
                                   'failed', count(*) FILTER (WHERE off_status = 'failed')) AS off_outcomes,
                jsonb_build_object('completed', count(*) FILTER (WHERE on_status = 'completed'),
                                   'timeout', count(*) FILTER (WHERE on_status = 'timeout'),
                                   'failed', count(*) FILTER (WHERE on_status = 'failed')) AS on_outcomes,
                coalesce(sum(off_score) FILTER (WHERE comparable), 0)::float8 AS off_score,
                coalesce(sum(on_score) FILTER (WHERE comparable), 0)::float8 AS on_score,
                coalesce(sum(pair_max) FILTER (WHERE comparable), 0)::float8 AS score_max,
                (count(*) FILTER (WHERE comparable AND on_score > off_score))::float8 AS wins,
                (count(*) FILTER (WHERE comparable AND on_score < off_score))::float8 AS losses,
                (count(*) FILTER (WHERE comparable AND on_score = off_score))::float8 AS ties,
                (count(*) FILTER (WHERE used))::float8 AS used_pairs,
                (count(input_delta) FILTER (WHERE comparable))::float8 AS token_pairs,
                count(DISTINCT account_id) FILTER (WHERE comparable AND input_delta IS NOT NULL) AS token_accounts,
                (avg(duration_delta) FILTER (WHERE comparable))::float8 AS duration_delta,
                (avg(input_delta) FILTER (WHERE comparable))::float8 AS input_delta,
                (avg(cached_delta) FILTER (WHERE comparable))::float8 AS cached_delta,
                (avg(output_delta) FILTER (WHERE comparable))::float8 AS output_delta
           FROM pairs
          GROUP BY benchmark, model, codex_version, codegraph_version
         HAVING count(DISTINCT account_id) >= $3
       )
       SELECT benchmark, model, codex_version AS "codexVersion", codegraph_version AS "codegraphVersion",
              accounts, pairs, comparable_pairs AS "comparablePairs", off_outcomes AS "offOutcomes", on_outcomes AS "onOutcomes",
              off_score AS "offScore", on_score AS "onScore", score_max AS "scoreMax", wins, losses, ties,
              used_pairs AS "usedPairs", token_pairs AS "tokenPairs", duration_delta AS "meanDurationDeltaMs",
              CASE WHEN token_accounts >= $3 THEN input_delta END AS "meanInputTokenDelta",
              CASE WHEN token_accounts >= $3 THEN cached_delta END AS "meanCachedInputTokenDelta",
              CASE WHEN token_accounts >= $3 THEN output_delta END AS "meanOutputTokenDelta",
              coalesce(comparable_accounts, 0) AS "comparableAccounts",
              coalesce(improved_accounts, 0) AS "improvedAccounts",
              coalesce(regressed_accounts, 0) AS "regressedAccounts",
              coalesce(tied_accounts, 0) AS "tiedAccounts",
              mean_account_delta_pp AS "meanAccountScoreDeltaPp"
         FROM cohorts
         LEFT JOIN account_comparisons USING (benchmark, model, codex_version, codegraph_version)
        ORDER BY accounts DESC, benchmark, model, codex_version, codegraph_version
        LIMIT $4`,
      [communityScoreMax(LEGACY_COMMUNITY_BENCHMARK), communityScoreMax(COMMUNITY_BENCHMARK), MIN_ACCOUNTS, MAX_COHORTS],
    );
    return rows.map((row) => ({ ...row, ...accountDirection(row) }));
  }
}

type BenchmarkDeps = Pick<Benchmarks, "submit"> & {
  getUser: (headers: Headers) => Promise<string | null>;
};

function failure(status: number, code: string, extraHeaders?: Record<string, string>): Response {
  return Response.json({ ok: false, error: { code } }, { status, headers: { "cache-control": "no-store", ...extraHeaders } });
}

export async function handleBenchmarks(request: Request, deps: BenchmarkDeps): Promise<Response> {
  try {
    if (request.method !== "POST") return failure(405, "METHOD_NOT_ALLOWED", { allow: "POST" });
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return failure(415, "UNSUPPORTED_MEDIA_TYPE");
    }
    const authorization = request.headers.get("authorization");
    // No browser cookies: only an explicit marketplace API key can contribute.
    if (!authorization || !/^Bearer \S+$/i.test(authorization)) return failure(401, "UNAUTHORIZED");
    if (Number(request.headers.get("content-length")) > COMMUNITY_REPORT_BYTES) return failure(413, "BODY_TOO_LARGE");
    const accountId = await deps.getUser(new Headers({ authorization }));
    if (!accountId) return failure(401, "UNAUTHORIZED");

    let report: CommunityReport;
    try {
      const bytes = await readLimitedBody(request, COMMUNITY_REPORT_BYTES);
      report = parseCommunityReport(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "BODY_TOO_LARGE") return failure(413, "BODY_TOO_LARGE");
      return failure(400, "BENCHMARK_INVALID_REPORT");
    }
    const accepted = await deps.submit(accountId, report);
    return Response.json({ ok: true, data: { accepted } }, {
      status: accepted ? 201 : 200,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return failure(503, "BENCHMARK_UNAVAILABLE");
  }
}
