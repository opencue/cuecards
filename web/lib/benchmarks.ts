import type { Pool } from "pg";

import {
  COMMUNITY_REPORT_BYTES,
  COMMUNITY_SCORE_MAX,
  type CommunityReport,
  parseCommunityReport,
} from "../../src/lib/community-eval/result.js";
import { readLimitedBody } from "./http-utils.js";

const MIN_ACCOUNTS = 5;
const MAX_COHORTS = 20;

export type BenchmarkCohort = Pick<CommunityReport, "benchmark" | "model" | "codexVersion" | "codegraphVersion"> & {
  accounts: number;
  pairs: number;
  offScore: number;
  onScore: number;
  scoreMax: number;
  wins: number;
  losses: number;
  ties: number;
  usedPairs: number;
  tokenPairs: number;
  meanDurationDeltaMs: number;
  meanInputTokenDelta: number | null;
  meanCachedInputTokenDelta: number | null;
  meanOutputTokenDelta: number | null;
};

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
    const { rows } = await this.db.query<BenchmarkCohort>(
      `WITH pairs AS (
         SELECT account_id, benchmark, model, codex_version, codegraph_version,
                (arms->'off'->>'score')::int AS off_score,
                (arms->'on'->>'score')::int AS on_score,
                (arms->'on'->>'codegraphUsed')::bool AS used,
                (arms->'on'->>'durationMs')::int - (arms->'off'->>'durationMs')::int AS duration_delta,
                (arms->'on'->>'inputTokens')::int - (arms->'off'->>'inputTokens')::int AS input_delta,
                (arms->'on'->>'cachedInputTokens')::int - (arms->'off'->>'cachedInputTokens')::int AS cached_delta,
                (arms->'on'->>'outputTokens')::int - (arms->'off'->>'outputTokens')::int AS output_delta
           FROM cue_benchmark_report AS report
           CROSS JOIN LATERAL jsonb_array_elements(report.pairs) AS pair(arms)
       ), cohorts AS (
         SELECT benchmark, model, codex_version, codegraph_version,
                count(DISTINCT account_id)::float8 AS accounts,
                count(*)::float8 AS pairs,
                sum(off_score)::float8 AS off_score,
                sum(on_score)::float8 AS on_score,
                (count(*) * $1::int)::float8 AS score_max,
                (count(*) FILTER (WHERE on_score > off_score))::float8 AS wins,
                (count(*) FILTER (WHERE on_score < off_score))::float8 AS losses,
                (count(*) FILTER (WHERE on_score = off_score))::float8 AS ties,
                (count(*) FILTER (WHERE used))::float8 AS used_pairs,
                count(input_delta)::float8 AS token_pairs,
                count(DISTINCT account_id) FILTER (WHERE input_delta IS NOT NULL) AS token_accounts,
                avg(duration_delta)::float8 AS duration_delta,
                avg(input_delta)::float8 AS input_delta,
                avg(cached_delta)::float8 AS cached_delta,
                avg(output_delta)::float8 AS output_delta
           FROM pairs
          GROUP BY benchmark, model, codex_version, codegraph_version
         HAVING count(DISTINCT account_id) >= $2
       )
       SELECT benchmark, model, codex_version AS "codexVersion", codegraph_version AS "codegraphVersion",
              accounts, pairs, off_score AS "offScore", on_score AS "onScore", score_max AS "scoreMax", wins, losses, ties,
              used_pairs AS "usedPairs", token_pairs AS "tokenPairs", duration_delta AS "meanDurationDeltaMs",
              CASE WHEN token_accounts >= $2 THEN input_delta END AS "meanInputTokenDelta",
              CASE WHEN token_accounts >= $2 THEN cached_delta END AS "meanCachedInputTokenDelta",
              CASE WHEN token_accounts >= $2 THEN output_delta END AS "meanOutputTokenDelta"
         FROM cohorts
        ORDER BY accounts DESC, benchmark, model, codex_version, codegraph_version
        LIMIT $3`,
      [COMMUNITY_SCORE_MAX, MIN_ACCOUNTS, MAX_COHORTS],
    );
    return rows;
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
