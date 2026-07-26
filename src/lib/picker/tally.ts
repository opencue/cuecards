/**
 * Resource-tally math shared by every picker surface: what a profile brings
 * (skills / mcps / plugins / commands), what a stack costs when combined, and
 * the always-on token soft-warning.
 *
 * Extracted from `lib/picker`; re-exported there for back-compat. Pure.
 */

import { tokenLevelEmoji } from "../token-budget";

/**
 * A single profile's own resource identifiers, as lists so combined-profile
 * previews can union them exactly (a skill/mcp/plugin shared by two stacked
 * profiles is counted once). Skills mirror the picker headline: one entry per
 * local skill + one per npx repo.
 */
export interface ProfileTally {
  skills: string[];
  mcps: string[];
  plugins: string[];
  commands: string[];
  /**
   * This profile's own always-on token cost (skill-description frontmatter that
   * loads into the skill router every session). Optional — when present, the
   * combine preview sums it across the selection and soft-warns on a heavy
   * stack. Summing slightly overcounts skills shared by two companions, so the
   * displayed figure is an upper-bound estimate (rendered with a leading `~`).
   */
  alwaysOn?: number;
}

export interface TallyCounts {
  skills: number;
  mcps: number;
  plugins: number;
  commands: number;
}

export const EMPTY_TALLY: ProfileTally = { skills: [], mcps: [], plugins: [], commands: [] };

/**
 * "17 skills · 1 mcp" — the per-row hint showing what a companion adds.
 * Omits zero categories; returns "" for a profile that adds nothing. Pure.
 */
export function formatTallyDelta(t: ProfileTally): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add(t.skills.length, "skill", "skills");
  add(t.mcps.length, "mcp", "mcps");
  add(t.plugins.length, "plugin", "plugins");
  add(t.commands.length, "cmd", "cmds");
  return parts.join(" · ");
}

/** Count of the de-duped union across several profile tallies. Pure. */
export function unionTallyCounts(tallies: ProfileTally[]): TallyCounts {
  const skills = new Set<string>();
  const mcps = new Set<string>();
  const plugins = new Set<string>();
  const commands = new Set<string>();
  for (const t of tallies) {
    for (const s of t.skills) skills.add(s);
    for (const m of t.mcps) mcps.add(m);
    for (const p of t.plugins) plugins.add(p);
    for (const c of t.commands) commands.add(c);
  }
  return { skills: skills.size, mcps: mcps.size, plugins: plugins.size, commands: commands.size };
}

/**
 * The live "what you're about to pin" line under the combine list. Each segment
 * reads `skills 31→48` when a companion changes the total, or `skills 31` when
 * it doesn't; zero-count categories are dropped. Returns [] when there's nothing
 * to show. Pure (no color) so it's directly testable.
 */
export function formatCombinedPreview(baseline: TallyCounts, combined: TallyCounts): string[] {
  const seg = (label: string, base: number, comb: number): string | null => {
    if (comb === 0) return null;
    return base === comb ? `${label} ${comb}` : `${label} ${base}→${comb}`;
  };
  const segs = [
    seg("skills", baseline.skills, combined.skills),
    seg("mcps", baseline.mcps, combined.mcps),
    seg("plugins", baseline.plugins, combined.plugins),
    seg("cmds", baseline.commands, combined.commands),
  ].filter((s): s is string => s !== null);
  return segs.length > 0 ? [segs.join("  ·  ")] : [];
}

/** Always-on token cost above which a stack preview soft-warns. Mirrors the
 *  🟠 band in `tokenLevelEmoji` — the point at which the agent's own perf
 *  warning starts to fire. */
export const OVERHEAD_WARN_TOKENS = 10_000;

/**
 * Soft-warning line for a heavy combined stack — "⚠ heavy: ~32k always-on 🔴 —
 * slows the agent". Returns "" below the warn threshold so light combos stay
 * uncluttered. The `~` flags it as an upper-bound estimate. Pure.
 */
export function formatOverheadBadge(alwaysOnTokens: number): string {
  if (alwaysOnTokens <= OVERHEAD_WARN_TOKENS) return "";
  const k =
    alwaysOnTokens >= 10_000
      ? String(Math.round(alwaysOnTokens / 1000))
      : (alwaysOnTokens / 1000).toFixed(1);
  return `⚠ heavy: ~${k}k always-on ${tokenLevelEmoji(alwaysOnTokens)} — slows the agent`;
}

/**
 * "31 skills · 2 mcps" — a compact one-line summary of a whole stack's
 * resources, used by the v2 card and the palette's sticky footer. Zero
 * categories are dropped; an empty tally returns "". Pure.
 */
export function formatStackTotals(counts: TallyCounts): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add(counts.skills, "skill", "skills");
  add(counts.mcps, "mcp", "mcps");
  add(counts.plugins, "plugin", "plugins");
  add(counts.commands, "cmd", "cmds");
  return parts.join(" · ");
}
