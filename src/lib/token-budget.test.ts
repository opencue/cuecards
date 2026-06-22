import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_LOAD_FACTOR,
  MCP_TOKENS_PER_SERVER,
  MODEL_CONTEXT_WINDOWS,
  computeContextBudget,
  estimateMcpTokens,
  formatContextBudgetWarning,
  resolveContextWindow,
} from "./token-budget";

describe("resolveContextWindow", () => {
  test("explicit contextWindow wins over everything", () => {
    expect(
      resolveContextWindow({
        contextWindow: 64_000,
        model: "claude-opus-4-8[1m]",
        env: { CUE_CONTEXT_WINDOW: "999000" },
      }),
    ).toBe(64_000);
  });

  test("model id maps to its window", () => {
    expect(resolveContextWindow({ model: "claude-opus-4-8" })).toBe(256_000);
    expect(resolveContextWindow({ model: "claude-opus-4-8[1m]" })).toBe(1_000_000);
  });

  test("env CUE_CONTEXT_WINDOW used when no profile signal", () => {
    expect(resolveContextWindow({ env: { CUE_CONTEXT_WINDOW: "300000" } })).toBe(300_000);
  });

  test("env CUE_MODEL used after CUE_CONTEXT_WINDOW", () => {
    expect(resolveContextWindow({ env: { CUE_MODEL: "claude-sonnet-4-6" } })).toBe(256_000);
  });

  test("falls back to the 256K default", () => {
    expect(resolveContextWindow({ env: {} })).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(DEFAULT_CONTEXT_WINDOW).toBe(256_000);
  });

  test("ignores non-positive / unparseable overrides", () => {
    expect(resolveContextWindow({ contextWindow: 0, env: {} })).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(resolveContextWindow({ env: { CUE_CONTEXT_WINDOW: "nonsense" } })).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(resolveContextWindow({ env: { CUE_CONTEXT_WINDOW: "-5" } })).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  test("unknown model id falls through to default", () => {
    expect(resolveContextWindow({ model: "gpt-imaginary", env: {} })).toBe(DEFAULT_CONTEXT_WINDOW);
  });
});

describe("estimateMcpTokens", () => {
  test("scales linearly with server count", () => {
    expect(estimateMcpTokens(0)).toBe(0);
    expect(estimateMcpTokens(4)).toBe(4 * MCP_TOKENS_PER_SERVER);
  });

  test("negative counts clamp to zero", () => {
    expect(estimateMcpTokens(-3)).toBe(0);
  });

  test("honours a custom per-server estimate", () => {
    expect(estimateMcpTokens(2, 1000)).toBe(2000);
  });
});

describe("computeContextBudget", () => {
  test("256K model → 128K budget; small load is within budget", () => {
    const b = computeContextBudget({ skillTokens: 12_000, mcpCount: 4, model: "claude-opus-4-8" });
    expect(b.window).toBe(256_000);
    expect(b.budget).toBe(128_000);
    expect(b.mcpTokens).toBe(4 * MCP_TOKENS_PER_SERVER);
    expect(b.startupLoad).toBe(12_000 + 4 * MCP_TOKENS_PER_SERVER);
    expect(b.withinBudget).toBe(true);
    expect(b.overBy).toBe(0);
  });

  test("flags over-budget when skills + MCPs exceed half the window", () => {
    const b = computeContextBudget({ skillTokens: 130_000, mcpCount: 2, model: "claude-opus-4-8" });
    expect(b.withinBudget).toBe(false);
    expect(b.overBy).toBeGreaterThan(0);
    expect(b.overBy).toBe(b.startupLoad - b.budget);
    expect(b.pctOfWindow).toBeGreaterThan(0.5);
  });

  test("default load factor is 50%", () => {
    expect(DEFAULT_LOAD_FACTOR).toBe(0.5);
    const b = computeContextBudget({ skillTokens: 0, mcpCount: 0, window: 200_000 });
    expect(b.budget).toBe(100_000);
  });

  test("custom load factor changes the ceiling", () => {
    const b = computeContextBudget({ skillTokens: 0, mcpCount: 0, window: 256_000, loadFactor: 0.25 });
    expect(b.budget).toBe(64_000);
  });

  test("a tighter window can push a profile over budget", () => {
    const within = computeContextBudget({ skillTokens: 90_000, mcpCount: 0, model: "claude-opus-4-8" });
    expect(within.withinBudget).toBe(true);
    const tight = computeContextBudget({ skillTokens: 90_000, mcpCount: 0, window: 128_000 });
    expect(tight.budget).toBe(64_000);
    expect(tight.withinBudget).toBe(false);
  });
});

describe("formatContextBudgetWarning", () => {
  test("silent well under budget", () => {
    const b = computeContextBudget({ skillTokens: 5_000, mcpCount: 1, model: "claude-opus-4-8" });
    expect(formatContextBudgetWarning(b)).toEqual([]);
  });

  test("soft 🟡 note when approaching the budget", () => {
    // ~85% of a 128K budget: 100K skills + ~9K MCP.
    const b = computeContextBudget({ skillTokens: 100_000, mcpCount: 6, model: "claude-opus-4-8" });
    const lines = formatContextBudgetWarning(b);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("🟡");
  });

  test("🔴 over-budget warning past the ceiling", () => {
    const b = computeContextBudget({ skillTokens: 140_000, mcpCount: 2, model: "claude-opus-4-8" });
    const lines = formatContextBudgetWarning(b);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("🔴");
    expect(lines.join(" ")).toContain("256K");
  });

  test("mentions MCP count and works without color helpers", () => {
    const b = computeContextBudget({ skillTokens: 140_000, mcpCount: 3, model: "claude-opus-4-8" });
    expect(formatContextBudgetWarning(b)[0]).toContain("3 MCPs");
  });
});

describe("MODEL_CONTEXT_WINDOWS", () => {
  test("known Claude models are present", () => {
    expect(MODEL_CONTEXT_WINDOWS["claude-opus-4-8"]).toBe(256_000);
    expect(MODEL_CONTEXT_WINDOWS["claude-sonnet-4-6"]).toBe(256_000);
  });
});
