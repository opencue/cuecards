import { describe, expect, test } from "bun:test";

import { type CommunityReport, COMMUNITY_REPORT_BYTES } from "../../src/lib/community-eval/result.js";
import { type BenchmarkCohort, Benchmarks, handleBenchmarks } from "./benchmarks.js";

const url = "https://example.test/api/v1/benchmarks";
const arm = { score: 1, durationMs: 400, inputTokens: 80, cachedInputTokens: 0, outputTokens: 10, codegraphUsed: false };
const report: CommunityReport = {
  version: 1, benchmark: "codegraph-v1", model: "gpt-5.4", codexVersion: "1.2.3", codegraphVersion: "0.1.2",
  pairs: [
    { off: arm, on: { ...arm, score: 3, codegraphUsed: true } },
    { off: arm, on: { ...arm, score: 0 } },
  ],
};
const cohort: Omit<BenchmarkCohort, "accountDirection" | "improvedAccountShare95"> = {
  benchmark: "codegraph-v1", model: "gpt-5.4", codexVersion: "1.2.3", codegraphVersion: "0.1.2",
  accounts: 5, pairs: 10, offScore: 10, onScore: 15, scoreMax: 30,
  comparablePairs: 10,
  offOutcomes: { completed: 10, timeout: 0, failed: 0 },
  onOutcomes: { completed: 10, timeout: 0, failed: 0 },
  wins: 5, losses: 4, ties: 1, usedPairs: 6, tokenPairs: 0,
  meanDurationDeltaMs: -10, meanInputTokenDelta: null, meanCachedInputTokenDelta: null, meanOutputTokenDelta: null,
  comparableAccounts: 5, improvedAccounts: 3, regressedAccounts: 1, tiedAccounts: 1, meanAccountScoreDeltaPp: 100 / 6,
};

function setup() {
  const reports = new Map<string, CommunityReport>();
  const authHeaders: Headers[] = [];
  const deps = {
    getUser: async (headers: Headers) => {
      authHeaders.push(headers);
      return headers.get("authorization") === "Bearer test-token" ? "test-account" : null;
    },
    submit: async (id: string, candidate: CommunityReport) => {
      const key = [id, candidate.benchmark, candidate.model].join(":");
      if (reports.has(key)) return false;
      reports.set(key, candidate);
      return true;
    },
  };
  return { deps, reports, authHeaders };
}

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST", body,
    headers: { "content-type": "application/json; charset=utf-8", authorization: "Bearer test-token", ...headers },
  });
}

describe("community benchmark HTTP boundary", () => {
  test("accepts a validated bearer-authenticated contribution only once", async () => {
    const { deps, reports, authHeaders } = setup();
    const response = await handleBenchmarks(post(JSON.stringify(report), { cookie: "ignored=value" }), deps);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, data: { accepted: true } });
    expect([...authHeaders[0].keys()]).toEqual(["authorization"]);
    const duplicate = await handleBenchmarks(post(JSON.stringify({ ...report, codexVersion: "2.0.0" })), deps);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual({ ok: true, data: { accepted: false } });
    expect([...reports.values()]).toEqual([report]);
  });

  test("accepts a new benchmark revision without overwriting a legacy report", async () => {
    const { deps, reports } = setup();
    const v2: CommunityReport = {
      ...report, version: 2, benchmark: "codegraph-v2",
      pairs: report.pairs.map(({ off, on }) => ({
        off: { ...off, status: "completed" },
        on: { ...on, status: "completed" },
      })),
    };
    for (const candidate of [report, v2]) {
      expect((await handleBenchmarks(post(JSON.stringify(candidate)), deps)).status).toBe(201);
    }
    expect([...reports.values()]).toEqual([report, v2]);
  });

  test("does not accept browser cookies or unauthenticated contributions", async () => {
    const { deps, reports, authHeaders } = setup();
    expect((await handleBenchmarks(post(JSON.stringify(report), { authorization: "", cookie: "only=session" }), deps)).status).toBe(401);
    expect((await handleBenchmarks(post(JSON.stringify(report), { authorization: "Bearer no" }), deps)).status).toBe(401);
    expect(reports.size).toBe(0);
    expect(authHeaders).toHaveLength(1);
  });

  test("rejects unsupported media, invalid JSON and unexpected report fields", async () => {
    const { deps, reports } = setup();
    expect((await handleBenchmarks(post(JSON.stringify(report), { "content-type": "text/plain" }), deps)).status).toBe(415);
    expect((await handleBenchmarks(post("{"), deps)).status).toBe(400);
    const response = await handleBenchmarks(post(JSON.stringify({ ...report, prompt: "must never be stored" })), deps);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: { code: "BENCHMARK_INVALID_REPORT" } });
    expect(reports.size).toBe(0);
  });

  test("enforces the byte limit independently of Content-Length", async () => {
    const { deps, reports } = setup();
    const response = await handleBenchmarks(post("é".repeat(COMMUNITY_REPORT_BYTES / 2 + 1), { "content-length": "10" }), deps);
    expect(response.status).toBe(413);
    expect(reports.size).toBe(0);
  });

  test("never exposes individual or successive aggregate snapshots through HTTP", async () => {
    const { deps, authHeaders } = setup();
    const response = await handleBenchmarks(new Request(url, { headers: { authorization: "Bearer test-token" } }), deps);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(authHeaders).toHaveLength(0);
  });

  test("uses structured failures without publishing dependency errors", async () => {
    const { deps } = setup();
    const method = await handleBenchmarks(new Request(url, { method: "DELETE" }), deps);
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("POST");
    const retry = await handleBenchmarks(post(JSON.stringify(report)), {
      ...deps, submit: async () => { throw new Error("database connection string"); },
    });
    expect(retry.status).toBe(503);
    expect(await retry.json()).toEqual({ ok: false, error: { code: "BENCHMARK_UNAVAILABLE" } });
  });
});

describe("community benchmark storage boundary", () => {
  test("binds account and report data and makes duplicate submissions no-ops", async () => {
    const queries: { sql: string; args: unknown[] }[] = [];
    const store = new Benchmarks({
      query: async (sql: string, args: unknown[]) => {
        queries.push({ sql, args });
        return { rowCount: queries.length === 1 ? 1 : 0 };
      },
    } as unknown as ConstructorParameters<typeof Benchmarks>[0]);

    expect(await store.submit("test-account", report)).toBe(true);
    expect(await store.submit("test-account", report)).toBe(false);
    expect(queries[0].sql).toContain("ON CONFLICT (account_id, benchmark, model) DO NOTHING");
    expect(queries[0].sql).not.toContain("test-account");
    expect(queries[0].args).toEqual([
      "test-account", report.benchmark, report.model, report.codexVersion, report.codegraphVersion, JSON.stringify(report.pairs),
    ]);
  });

  test("queries only cohort and paired-account aggregates, with a contributor threshold and result limit", async () => {
    const store = new Benchmarks({
      query: async (sql: string, args: unknown[]) => {
        expect(sql).toContain("HAVING count(DISTINCT account_id) >= $3");
        expect(sql).toContain("CASE WHEN token_accounts >= $3 THEN input_delta");
        expect(sql).toContain("LIMIT $4");
        expect(args).toEqual([3, 6, 5, 20]);
        return { rows: [cohort] };
      },
    } as unknown as ConstructorParameters<typeof Benchmarks>[0]);
    const [summary] = await store.list();
    expect(summary).toMatchObject({ ...cohort, accountDirection: "inconclusive" });
    expect(summary.improvedAccountShare95?.lower).toBeCloseTo(0.3006, 4);
    expect(summary.improvedAccountShare95?.upper).toBeCloseTo(0.9544, 4);
  });

  test("reports directional uncertainty without treating tied or tiny samples as equivalent", async () => {
    const store = new Benchmarks({
      query: async () => ({
        rows: [
          { ...cohort, improvedAccounts: 0, regressedAccounts: 0 },
          { ...cohort, improvedAccounts: 4, regressedAccounts: 0 },
          { ...cohort, improvedAccounts: 5, regressedAccounts: 0 },
          { ...cohort, improvedAccounts: 0, regressedAccounts: 5 },
        ],
      }),
    } as unknown as ConstructorParameters<typeof Benchmarks>[0]);
    const results = await store.list();
    expect(results.map(({ accountDirection }) => accountDirection))
      .toEqual(["inconclusive", "inconclusive", "favors-on", "favors-off"]);
    expect(results[0].improvedAccountShare95).toBeNull();
    expect(results[2].improvedAccountShare95?.lower).toBeGreaterThan(0.5);
    expect(results[3].improvedAccountShare95?.upper).toBeLessThan(0.5);
  });
});
