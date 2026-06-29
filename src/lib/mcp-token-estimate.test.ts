/**
 * Tests for mcp-token-estimate.ts — pure functions only, no disk/spawn.
 *
 * Run with: `bun test src/lib/mcp-token-estimate.test.ts`
 */

import { describe, expect, test } from "bun:test";
import {
  mcpServerTokens,
  sumMcpTokens,
  budgetExceeded,
  loadMcpEstimates,
  TOKENS_PER_TOOL,
  UNKNOWN_MCP_TOOLS,
  type McpEstimate,
} from "./mcp-token-estimate";

const cache: Record<string, McpEstimate> = {
  probed: { tokens: 9000, source: "probed" },
  counted: { tools: 10, source: "estimate" },
  noSource: { tools: 4 },
};

describe("mcpServerTokens", () => {
  test("uses measured tokens when present (probed wins)", () => {
    expect(mcpServerTokens("probed", cache)).toEqual({ tokens: 9000, source: "probed" });
  });

  test("derives tokens from tool count × TOKENS_PER_TOOL", () => {
    expect(mcpServerTokens("counted", cache)).toEqual({ tokens: 10 * TOKENS_PER_TOOL, source: "estimate" });
  });

  test("defaults missing source to estimate when a count exists", () => {
    expect(mcpServerTokens("noSource", cache)).toEqual({ tokens: 4 * TOKENS_PER_TOOL, source: "estimate" });
  });

  test("flags an uncached server as unknown with the flagged default", () => {
    expect(mcpServerTokens("ghost", cache)).toEqual({
      tokens: UNKNOWN_MCP_TOOLS * TOKENS_PER_TOOL,
      source: "unknown",
    });
  });
});

describe("sumMcpTokens", () => {
  test("sums tokens and partitions ids by provenance", () => {
    const r = sumMcpTokens(["probed", "counted", "ghost"], cache);
    expect(r.total).toBe(9000 + 10 * TOKENS_PER_TOOL + UNKNOWN_MCP_TOOLS * TOKENS_PER_TOOL);
    expect(r.measured).toEqual(["probed"]);
    expect(r.estimated).toEqual(["counted"]);
    expect(r.unknown).toEqual(["ghost"]);
  });

  test("empty id list → zero total, empty buckets", () => {
    expect(sumMcpTokens([], cache)).toEqual({ total: 0, measured: [], estimated: [], unknown: [] });
  });
});

describe("budgetExceeded", () => {
  test("true only when over a positive budget", () => {
    expect(budgetExceeded(100, 50)).toBe(true);
    expect(budgetExceeded(50, 50)).toBe(false); // boundary is inclusive (not over)
    expect(budgetExceeded(10, 50)).toBe(false);
  });

  test("budget <= 0 disables the gate", () => {
    expect(budgetExceeded(999999, 0)).toBe(false);
    expect(budgetExceeded(999999, -1)).toBe(false);
  });
});

describe("loadMcpEstimates", () => {
  test("runtime override wins over seed per id; injected readers (no disk)", () => {
    const merged = loadMcpEstimates({
      readSeed: () => ({ a: { tools: 1, source: "estimate" }, b: { tools: 2, source: "estimate" } }),
      readRuntime: () => ({ b: { tokens: 5000, source: "probed" } }),
    });
    expect(merged.a).toEqual({ tools: 1, source: "estimate" });
    expect(merged.b).toEqual({ tokens: 5000, source: "probed" });
  });

  test("the shipped repo seed parses and is all estimates (no fake 'probed')", () => {
    const seed = loadMcpEstimates({ readRuntime: () => ({}) });
    expect(Object.keys(seed).length).toBeGreaterThan(0);
    for (const [id, e] of Object.entries(seed)) {
      expect(e.source, `${id} seed source`).not.toBe("probed");
    }
  });
});
