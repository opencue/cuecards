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
const cohort: BenchmarkCohort = {
  benchmark: "codegraph-v1", model: "gpt-5.4", codexVersion: "1.2.3", codegraphVersion: "0.1.2",
  accounts: 5, pairs: 10, offScore: 10, onScore: 15, scoreMax: 30,
  wins: 5, losses: 4, ties: 1, usedPairs: 6, tokenPairs: 0,
  meanDurationDeltaMs: -10, meanInputTokenDelta: null, meanCachedInputTokenDelta: null, meanOutputTokenDelta: null,
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
    list: async () => [cohort],
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

  test("lists only public self-reported cohorts, not account rows", async () => {
    const { deps, authHeaders } = setup();
    const response = await handleBenchmarks(new Request(url), deps);
    expect(await response.json()).toEqual({ ok: true, data: { source: "self-reported", minAccounts: 5, cohorts: [cohort] } });
    expect(authHeaders).toHaveLength(0);
  });

  test("uses structured failures without publishing dependency errors", async () => {
    const { deps } = setup();
    const method = await handleBenchmarks(new Request(url, { method: "DELETE" }), deps);
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("GET, POST");
    const retry = await handleBenchmarks(new Request(url), {
      ...deps, list: async () => { throw new Error("database connection string"); },
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

  test("queries aggregated rows, with a contributor threshold and result limit", async () => {
    const store = new Benchmarks({
      query: async (sql: string, args: unknown[]) => {
        expect(sql).toContain("HAVING count(DISTINCT account_id) >= $2");
        expect(sql).toContain("CASE WHEN token_accounts >= $2 THEN input_delta");
        expect(sql).toContain("LIMIT $3");
        expect(args).toEqual([3, 5, 20]);
        return { rows: [cohort] };
      },
    } as unknown as ConstructorParameters<typeof Benchmarks>[0]);
    expect(await store.list()).toEqual([cohort]);
  });
});
