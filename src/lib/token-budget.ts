/**
 * Token-budget accounting for materialized profiles — pure, filesystem-free.
 *
 * Extracted from commands/launch.ts (which re-exports these for back-compat).
 * The *formatting* of the budget (colors, the CLI banner block) stays in
 * launch.ts; this module is just the measurement math, so it's unit-testable
 * in isolation and reusable by other surfaces (status, doctor, dashboard).
 */

import type { ResolvedProfile } from "../../profiles/_types";

export interface SkillTokens {
  /** Tokens for the YAML frontmatter (always-on, loaded into skill router). */
  frontmatter: number;
  /** Tokens for the rest of SKILL.md (load-on-activate). */
  body: number;
}

export interface TokenBreakdown {
  /** Sum of frontmatter tokens across every skill — the real always-on cost. */
  alwaysOn: number;
  /** Sum of body tokens — the ceiling if every skill activates this session. */
  maxIfAllActivate: number;
  /** Skill count for the header line. */
  totalSkills: number;
  /**
   * Per-profile attribution of `alwaysOn` for composite selectors (length > 1).
   * Each skill is credited to the first part that declares it, so per-part
   * numbers sum to `alwaysOn` (no double-counting from overlap). Empty for
   * single-part profiles. `icon` carries the part's emoji when declared.
   */
  byProfile: { name: string; icon?: string; tokens: number; skillCount: number }[];
  /** Skills sorted by body size, descending — for the "heaviest if activated" hint. */
  heaviestBodies: { id: string; tokens: number }[];
}

export function computeTokenBreakdown(
  profile: ResolvedProfile,
  parts: ResolvedProfile[] | undefined,
  tokensForSkill: (id: string) => SkillTokens,
): TokenBreakdown {
  let alwaysOn = 0;
  let maxIfAllActivate = 0;
  const heaviestBodies: { id: string; tokens: number }[] = [];
  for (const s of profile.skills.local) {
    const { frontmatter, body } = tokensForSkill(s.id);
    alwaysOn += frontmatter;
    maxIfAllActivate += body;
    if (body > 0) heaviestBodies.push({ id: s.id, tokens: body });
  }
  heaviestBodies.sort((a, b) => b.tokens - a.tokens);

  const byProfile: TokenBreakdown["byProfile"] = [];
  if (parts && parts.length > 1) {
    const credited = new Set<string>();
    for (const part of parts) {
      let pTokens = 0;
      let pCount = 0;
      for (const s of part.skills.local) {
        if (credited.has(s.id)) continue;
        credited.add(s.id);
        const { frontmatter } = tokensForSkill(s.id);
        if (frontmatter > 0) {
          pTokens += frontmatter;
          pCount += 1;
        }
      }
      byProfile.push({ name: part.name, icon: part.icon, tokens: pTokens, skillCount: pCount });
    }
  }

  return {
    alwaysOn,
    maxIfAllActivate,
    totalSkills: profile.skills.local.length,
    byProfile,
    heaviestBodies,
  };
}

/**
 * Extract frontmatter byte length from a SKILL.md string. Returns
 * `{ frontmatter, body }` byte counts. Falls back to a token count of zero
 * when the file lacks the leading `---` block (still legal but rare).
 */
export function splitSkillBytes(source: string): { frontmatter: number; body: number } {
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) {
    return { frontmatter: 0, body: source.length };
  }
  // Find the closing `---` on its own line. Search starts after the opener.
  const closer = source.indexOf("\n---", 4);
  if (closer === -1) {
    return { frontmatter: source.length, body: 0 };
  }
  // Include the closing `---\n` in the frontmatter block.
  const fmEnd = source.indexOf("\n", closer + 1);
  const cut = fmEnd === -1 ? source.length : fmEnd + 1;
  return { frontmatter: cut, body: source.length - cut };
}

/**
 * Map an always-on token count to the bands we color in the CLI banner and
 * the tmux pane-border badge. Single source of truth so the two displays
 * never drift apart on threshold values.
 */
export function tokenLevelEmoji(alwaysOn: number): "🔴" | "🟠" | "🟡" | "🟢" {
  return alwaysOn > 15000 ? "🔴"
    : alwaysOn > 10000 ? "🟠"
      : alwaysOn > 5000 ? "🟡"
        : "🟢";
}

// ---------------------------------------------------------------------------
// Model-aware startup budget
//
// The always-on footprint (skill frontmatter + MCP tool schemas) is paid on
// every single message, before the user has typed anything. The guidance we
// enforce here: at session start a profile should consume no more than HALF
// the model's context window, leaving the other half as working headroom for
// the actual task. For a 256K model that's a ~128K startup ceiling.
// ---------------------------------------------------------------------------

/** Fallback context window (tokens) when neither the profile nor the env says
 *  which model is in play. cue can't auto-detect the main-session model (it's a
 *  per-launch `/model` choice), so 256K is the conservative baseline. */
export const DEFAULT_CONTEXT_WINDOW = 256_000;

/** Fraction of the window a profile may occupy at startup. Half the window
 *  keeps the other half free for the conversation. */
export const DEFAULT_LOAD_FACTOR = 0.5;

/**
 * Rough always-on cost of one MCP server, in tokens. Every connected server
 * injects its tool-schema definitions into the system prompt on every message.
 * Real cost varies widely by server (a 2-tool server vs codegraph's dozens),
 * so this is a deliberately conservative per-server heuristic; override with
 * CUE_MCP_TOKENS_PER_SERVER when you have a measured number.
 */
export const MCP_TOKENS_PER_SERVER = 1500;

/**
 * Known model → context-window (tokens). Keyed on the exact model ids cue
 * surfaces in its `/model` hints. The `[1m]` long-context Opus variant is the
 * one outlier; everything else defaults to the standard 256K window.
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-4-8": 256_000,
  "claude-opus-4-8[1m]": 1_000_000,
  "claude-opus-4-7": 256_000,
  "claude-opus-4-6": 256_000,
  "claude-sonnet-4-6": 256_000,
  "claude-haiku-4-5": 256_000,
  "claude-fable-5": 256_000,
};

/**
 * Resolve the context window to budget against. Precedence (first hit wins):
 *   1. explicit `contextWindow` (e.g. the profile's declared field)
 *   2. `model` looked up in MODEL_CONTEXT_WINDOWS
 *   3. env `CUE_CONTEXT_WINDOW` (a raw token count)
 *   4. env `CUE_MODEL` looked up in MODEL_CONTEXT_WINDOWS
 *   5. DEFAULT_CONTEXT_WINDOW (256K)
 * Non-positive / unparseable values are ignored so a bad override can't drive
 * the budget to zero.
 */
export function resolveContextWindow(opts: {
  contextWindow?: number;
  model?: string;
  env?: Record<string, string | undefined>;
} = {}): number {
  const env = opts.env ?? process.env;
  if (opts.contextWindow && opts.contextWindow > 0) return opts.contextWindow;
  if (opts.model && MODEL_CONTEXT_WINDOWS[opts.model]) return MODEL_CONTEXT_WINDOWS[opts.model]!;
  const envWindow = Number(env.CUE_CONTEXT_WINDOW);
  if (Number.isFinite(envWindow) && envWindow > 0) return envWindow;
  const envModel = env.CUE_MODEL;
  if (envModel && MODEL_CONTEXT_WINDOWS[envModel]) return MODEL_CONTEXT_WINDOWS[envModel]!;
  return DEFAULT_CONTEXT_WINDOW;
}

/** Estimate the always-on token cost of `mcpCount` connected MCP servers. */
export function estimateMcpTokens(
  mcpCount: number,
  perServer: number = MCP_TOKENS_PER_SERVER,
): number {
  if (mcpCount <= 0) return 0;
  return mcpCount * perServer;
}

export interface ContextBudget {
  /** Model context window in tokens. */
  window: number;
  /** Fraction of the window allowed at startup (0..1). */
  loadFactor: number;
  /** Token ceiling = window * loadFactor. */
  budget: number;
  /** Always-on skill frontmatter tokens. */
  skillTokens: number;
  /** Estimated always-on MCP tool-schema tokens. */
  mcpTokens: number;
  /** Number of MCP servers counted. */
  mcpCount: number;
  /** Total always-on startup load = skillTokens + mcpTokens. */
  startupLoad: number;
  /** True when the startup load is at or under the budget. */
  withinBudget: boolean;
  /** Tokens over the budget (0 when within). */
  overBy: number;
  /** startupLoad / window. */
  pctOfWindow: number;
  /** startupLoad / budget. */
  pctOfBudget: number;
}

/**
 * Compute the model-aware startup budget for a profile. Pure: callers pass the
 * measured skill frontmatter total and the MCP count; the window is resolved
 * via `resolveContextWindow`.
 */
export function computeContextBudget(input: {
  skillTokens: number;
  mcpCount: number;
  window?: number;
  model?: string;
  loadFactor?: number;
  mcpTokensPerServer?: number;
  env?: Record<string, string | undefined>;
}): ContextBudget {
  const window = resolveContextWindow({
    contextWindow: input.window,
    model: input.model,
    env: input.env,
  });
  const loadFactor = input.loadFactor && input.loadFactor > 0 ? input.loadFactor : DEFAULT_LOAD_FACTOR;
  const budget = Math.round(window * loadFactor);
  const skillTokens = Math.max(0, input.skillTokens);
  const mcpTokens = estimateMcpTokens(input.mcpCount, input.mcpTokensPerServer);
  const startupLoad = skillTokens + mcpTokens;
  const overBy = Math.max(0, startupLoad - budget);
  return {
    window,
    loadFactor,
    budget,
    skillTokens,
    mcpTokens,
    mcpCount: Math.max(0, input.mcpCount),
    startupLoad,
    withinBudget: startupLoad <= budget,
    overBy,
    pctOfWindow: window > 0 ? startupLoad / window : 0,
    pctOfBudget: budget > 0 ? startupLoad / budget : 0,
  };
}

const fmtK = (n: number): string => `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K`;

/**
 * Format the model-aware budget block for the CLI. Returns `[]` when the
 * profile sits comfortably under the budget (< 80%), a soft 🟡 note when it's
 * approaching it, and a 🔴 over-budget warning past the ceiling. The `color`
 * helpers are injected so this stays free of any terminal/ANSI dependency.
 */
export function formatContextBudgetWarning(
  b: ContextBudget,
  color: { yellow: (s: string) => string; bold: (s: string) => string; dim: (s: string) => string } = {
    yellow: (s) => s,
    bold: (s) => s,
    dim: (s) => s,
  },
): string[] {
  // Quiet until the profile is within striking distance of the ceiling.
  if (b.pctOfBudget < 0.8) return [];

  const windowK = fmtK(b.window);
  const budgetK = fmtK(b.budget);
  const loadK = fmtK(b.startupLoad);
  const pct = Math.round(b.pctOfWindow * 100);
  const mcpNote = b.mcpCount > 0 ? ` + ${b.mcpCount} MCP${b.mcpCount > 1 ? "s" : ""}` : "";
  const lines: string[] = [];

  if (!b.withinBudget) {
    const overK = fmtK(b.overBy);
    lines.push(
      `🔴 Context budget: ${color.yellow(`~${loadK}`)} always-on (skills${mcpNote}) — ` +
        `${color.bold(`over the ${Math.round(b.loadFactor * 100)}% startup target`)} for a ${windowK} model ` +
        `(budget ~${budgetK}, over by ~${overK}).`,
    );
    lines.push(
      `   ${color.dim(`You're at ${pct}% of the window before the first message. Trim skills/MCPs, launch a narrower stack, or raise the window (CUE_CONTEXT_WINDOW).`)}`,
    );
  } else {
    lines.push(
      `🟡 Context budget: ${color.yellow(`~${loadK}`)} always-on (skills${mcpNote}) — ` +
        `${Math.round(b.pctOfBudget * 100)}% of the ${Math.round(b.loadFactor * 100)}% startup target for a ${windowK} model (budget ~${budgetK}).`,
    );
  }
  return lines;
}
