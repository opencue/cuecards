/**
 * Tests for `runQueryBatches` — the bounded parallel search scheduler
 * introduced to keep GitHub search API usage within the 30 req/min rate
 * limit while preserving early-exit semantics.
 *
 * All tests use an injectable mock searchFn; no real network calls are made.
 */

import { describe, expect, test } from "bun:test";
import { runQueryBatches, type GitHubRepoItem } from "./discover";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo(full_name: string): GitHubRepoItem {
  const [owner, name] = full_name.split("/");
  return {
    full_name,
    name: name ?? full_name,
    owner: { login: owner ?? "" },
    description: `${full_name} description`,
    stargazers_count: 1,
    forks_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    pushed_at: "2026-05-01T00:00:00Z",
    topics: [],
    language: "TypeScript",
    html_url: `https://github.com/${full_name}`,
  };
}

function makeQuery(label: string) {
  return { q: `q:${label}`, label };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runQueryBatches — early exit", () => {
  test("stops launching further batches once limit unique items are collected", async () => {
    const callLog: string[] = [];

    // 8 queries; limit=4. First batch (4 queries) returns one unique item each → 4
    // total. Second batch should NOT be launched.
    const queries = Array.from({ length: 8 }, (_, i) => makeQuery(`q${i}`));

    const searchFn = async (q: string, _limit: number): Promise<GitHubRepoItem[]> => {
      callLog.push(q);
      const idx = parseInt(q.replace("q:q", ""), 10);
      return [makeRepo(`owner/repo-${idx}`)];
    };

    const results = await runQueryBatches(queries, 4, searchFn, 4);

    expect(results.length).toBe(4);
    // Only the first batch (queries 0-3) should have been called
    expect(callLog.length).toBe(4);
    expect(callLog).toEqual(["q:q0", "q:q1", "q:q2", "q:q3"]);
  });

  test("launches a second batch when first batch yields fewer unique items than limit", async () => {
    const callLog: string[] = [];

    // 8 queries; limit=5. Batch 1 (4 queries) returns 2 unique items total.
    // Batch 2 is needed to reach the limit.
    const queries = Array.from({ length: 8 }, (_, i) => makeQuery(`q${i}`));

    const searchFn = async (q: string, _limit: number): Promise<GitHubRepoItem[]> => {
      callLog.push(q);
      const idx = parseInt(q.replace("q:q", ""), 10);
      // Queries 0-3 each return the same 2 repos → 2 unique items after dedup
      if (idx < 4) return [makeRepo("owner/repo-A"), makeRepo("owner/repo-B")];
      // Queries 4-7 return distinct repos
      return [makeRepo(`owner/repo-${idx}`)];
    };

    const results = await runQueryBatches(queries, 5, searchFn, 4);

    expect(results.length).toBe(5);
    // Batch 1 + at least some of batch 2 must have fired
    expect(callLog.length).toBeGreaterThan(4);
  });

  test("deduplicates by full_name across batches", async () => {
    const queries = [makeQuery("q0"), makeQuery("q1"), makeQuery("q2")];

    const searchFn = async (q: string, _limit: number): Promise<GitHubRepoItem[]> => {
      // All queries return the same repo — only one should survive
      return [makeRepo("owner/shared-repo")];
    };

    // batchSize=1 forces sequential single-query batches to make cross-batch dedup visible
    const results = await runQueryBatches(queries, 10, searchFn, 1);
    expect(results.length).toBe(1);
    expect(results[0].full_name).toBe("owner/shared-repo");
  });

  test("returns items in query-then-result order within each batch", async () => {
    const queries = [makeQuery("first"), makeQuery("second")];

    const searchFn = async (q: string, _limit: number): Promise<GitHubRepoItem[]> => {
      if (q === "q:first") return [makeRepo("owner/alpha"), makeRepo("owner/beta")];
      return [makeRepo("owner/gamma")];
    };

    const results = await runQueryBatches(queries, 10, searchFn, 4);
    expect(results.map((r) => r.full_name)).toEqual(["owner/alpha", "owner/beta", "owner/gamma"]);
  });

  test("handles empty queries list without calling searchFn", async () => {
    let called = false;
    const searchFn = async (_q: string, _limit: number): Promise<GitHubRepoItem[]> => {
      called = true;
      return [];
    };

    const results = await runQueryBatches([], 10, searchFn);
    expect(results).toEqual([]);
    expect(called).toBe(false);
  });
});
