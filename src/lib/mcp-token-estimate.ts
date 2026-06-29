/**
 * mcp-token-estimate — honest always-on token accounting for MCP servers.
 *
 * The problem this replaces: `cue cost` used to estimate an MCP server's cost
 * from the byte length of its *config entry* (command/args/env) divided by 200.
 * That number has no relationship to how many tools the server exposes or how
 * big their schemas are, so a 60-tool server with a two-line config was costed
 * at ~1 tool. The dominant always-on cost (MCP tool schemas, injected into the
 * system prompt every message) was undercounted by ~50-100×.
 *
 * The real cost lives in the running server's `tools/list` response, which cue
 * cannot read statically. So this module is cache-backed:
 *
 *   - A repo seed (`resources/mcp-token-estimates.json`, parent repo — NOT the
 *     `resources/mcps` submodule) ships defensible counts for small servers.
 *   - A runtime override (`$CUE_CONFIG/mcp-token-estimates.json`) holds measured
 *     numbers written by `cue cost --probe-mcp`; it wins per-id over the seed.
 *   - Servers with no entry fall back to a flagged `unknown` estimate so the
 *     display can say "estimated" instead of inventing precision.
 *
 * Pure + filesystem-light: `loadMcpEstimates` reads the two JSON files; every
 * other function is a pure transform so the budget gate and lookups are
 * unit-testable without spawning anything.
 */

import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { configDir } from "./config-paths";

const REPO_ROOT =
  process.env.CUE_REPO_ROOT ??
  process.env.SOUL_REPO_ROOT ??
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Repo seed path — parent repo, deliberately not under the mcps submodule. */
export const SEED_PATH = join(REPO_ROOT, "resources", "mcp-token-estimates.json");
/** Runtime override path — where `--probe-mcp` writes measured numbers. */
export function runtimeEstimatesPath(): string {
  return join(configDir(), "mcp-token-estimates.json");
}

/**
 * Mean always-on tokens for one MCP tool: name + description + JSON-schema
 * params. Sampled MCP tools range ~100-400 tokens; 150 is a deliberately
 * mid estimate used only when a server's `tokens` aren't measured. A probe
 * replaces this with the real summed byte count.
 */
export const TOKENS_PER_TOOL = 150;

/**
 * Assumed tool count for a server with no cache entry at all. Picked so an
 * unmeasured server reads as "a normal MCP" (~12 tools) rather than ~0 — the
 * old bug erred toward zero, which hid the cost. Flagged `unknown` so the
 * display never presents it as fact.
 */
export const UNKNOWN_MCP_TOOLS = 12;

export type McpSource = "probed" | "estimate" | "unknown";

export interface McpEstimate {
  /** Number of tools the server exposes. */
  tools?: number;
  /** Measured always-on tokens (summed tool-schema bytes / 4). Wins over tools. */
  tokens?: number;
  /** Provenance, so callers can flag estimates vs measurements. */
  source?: McpSource;
  /** Optional human note (e.g. "http — probe needs auth"). */
  note?: string;
}

export interface McpTokenResult {
  tokens: number;
  source: McpSource;
}

function readJsonRecord(path: string): Record<string, McpEstimate> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // Strip a leading "$schema"/"$comment" doc key if present.
      const out: Record<string, McpEstimate> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (k.startsWith("$")) continue;
        if (v && typeof v === "object") out[k] = v as McpEstimate;
      }
      return out;
    }
  } catch {
    /* missing or malformed → empty */
  }
  return {};
}

/**
 * Merge the repo seed with the runtime override (override wins per-id).
 * `deps` lets tests inject fixture readers instead of touching disk.
 */
export function loadMcpEstimates(deps?: {
  readSeed?: () => Record<string, McpEstimate>;
  readRuntime?: () => Record<string, McpEstimate>;
}): Record<string, McpEstimate> {
  const seed = deps?.readSeed ? deps.readSeed() : readJsonRecord(SEED_PATH);
  const runtime = deps?.readRuntime ? deps.readRuntime() : readJsonRecord(runtimeEstimatesPath());
  return { ...seed, ...runtime };
}

/** Always-on tokens for one server, with provenance. */
export function mcpServerTokens(id: string, cache: Record<string, McpEstimate>): McpTokenResult {
  const e = cache[id];
  if (e?.tokens != null) return { tokens: e.tokens, source: e.source ?? "estimate" };
  if (e?.tools != null) return { tokens: e.tools * TOKENS_PER_TOOL, source: e.source ?? "estimate" };
  return { tokens: UNKNOWN_MCP_TOOLS * TOKENS_PER_TOOL, source: "unknown" };
}

export interface McpTokenSummary {
  /** Summed always-on tokens across all ids. */
  total: number;
  /** Ids backed by a probed measurement. */
  measured: string[];
  /** Ids backed by a cached estimate (seed). */
  estimated: string[];
  /** Ids with no cache entry — counted via the flagged unknown default. */
  unknown: string[];
}

/** Sum always-on MCP tokens across a set of server ids, tracking provenance. */
export function sumMcpTokens(ids: string[], cache: Record<string, McpEstimate>): McpTokenSummary {
  let total = 0;
  const measured: string[] = [];
  const estimated: string[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    const { tokens, source } = mcpServerTokens(id, cache);
    total += tokens;
    if (source === "probed") measured.push(id);
    else if (source === "estimate") estimated.push(id);
    else unknown.push(id);
  }
  return { total, measured, estimated, unknown };
}

/** True when an always-on total exceeds the budget. Budget <= 0 disables the gate. */
export function budgetExceeded(total: number, budget: number): boolean {
  return budget > 0 && total > budget;
}
