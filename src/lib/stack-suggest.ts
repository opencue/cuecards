/**
 * Stack suggestion engine — the brain behind the v2 picker's card.
 *
 * `cue` already collects plenty of signal about a directory (file/dep
 * detection, content companions, session history, curated featured picks) but
 * historically each one only decorated a row somewhere in a 90-item list. This
 * module fuses them into a small ranked list of *concrete stacks* ("rust +
 * secops, because Cargo.toml and you pair these"), which is what the picker
 * actually needs to answer with.
 *
 * `suggestStacks` is pure: no I/O, no TTY, no clock. `pathSignals` is the one
 * filesystem-touching helper (injectable for tests) and feeds its results in as
 * ordinary detections.
 */

import { existsSync, readdirSync } from "node:fs";
import { basename, join, sep } from "node:path";
import { buildConflictMap, resolveConflicts } from "./profile-conflicts";

/** A selectable profile, as the picker knows it. */
export interface SuggestProfile {
  value: string;
  label?: string;
  hint?: string;
  recommends?: string[];
  autoSelect?: string[];
  conflicts?: string[];
}

/** A scored "this directory looks like X" signal. */
export interface SuggestSignal {
  name: string;
  confidence: number;
  reasons: string[];
}

/** A content-detected companion profile (image assets → higgsfield, …). */
export interface SuggestCompanion {
  profile: string;
  reason: string;
  confidence: number;
}

/** A profile the user launched before. */
export interface SuggestRecent {
  name: string;
  sessions: number;
  /** ISO timestamp; `null` when the analytics row carried no last-used date. */
  lastUsed?: string | null;
}

/** A multi-profile stack the user confirmed before. */
export interface SuggestCombo {
  parts: string[];
  count: number;
  lastUsed?: string | null;
  /**
   * Of `count`, how many confirmations happened in *this* directory (see
   * `combo-history.readCombos`). `undefined` means the caller had no per-repo
   * attribution and the stack is scored the way it always was; `0` means the
   * stack is genuinely foreign to this directory and is demoted accordingly.
   */
  here?: number;
}

export interface SuggestInput {
  /** Every selectable profile (no dividers, no composites). */
  profiles: SuggestProfile[];
  detected?: SuggestSignal[];
  companions?: SuggestCompanion[];
  /** Most-recent-first is not required — this module sorts by `lastUsed`. */
  recents?: SuggestRecent[];
  /** True when `recents` was scoped to this cwd (changes the reason text). */
  recentsAreCwdScoped?: boolean;
  combos?: SuggestCombo[];
  /** Historical partners per primary, from session-log pair mining. */
  pairSuggestions?: Map<string, string[]>;
  featured?: string[];
  /**
   * Generic repo→profile matches (see `profile-match`). The other sources are
   * hand-maintained and between them cover 19 of 85 profiles; this one scores
   * every profile's own vocabulary against the directory, so the suggestion
   * list keeps going after curation runs out.
   */
  matched?: SuggestMatch[];
  /** Resolved Default selector (e.g. `"core"`), the last-resort suggestion. */
  defaultSelector?: string;
  /** Max suggestions returned. Default 3. */
  limit?: number;
}

/** A profile matched generically against the directory's own evidence. */
export interface SuggestMatch {
  name: string;
  /** 0..1 absolute match strength. */
  strength: number;
  /** One-line explanation, already human-readable. */
  reason: string;
}

export type SuggestionOrigin = "detected" | "combo" | "recent" | "featured" | "matched" | "default";

export interface StackSuggestion {
  /** Conflict-free, deduped profile names. Always at least one. */
  parts: string[];
  score: number;
  /** 1-3 short human reasons, most important first. */
  reasons: string[];
  origin: SuggestionOrigin;
}

/** Hard cap on how many profiles one suggested stack may contain. Past three
 *  the card stops reading as an answer and starts reading as a list. */
export const MAX_STACK_PARTS = 3;

/** Confidence at/above which a detected companion joins a suggested stack. */
export const COMPANION_AUTO_CONFIDENCE = 0.7;

/** Below this a detection is too noisy to build a suggestion from. */
export const DETECT_MIN_CONFIDENCE = 0.5;

// Score bases per origin. Detection dominates (it describes *this* directory),
// history comes next (it describes this user), curation last.
export const SCORE_DETECTED = 100;
export const SCORE_COMBO = 45;
/**
 * A stack confirmed in *this* directory: the strongest history signal there is,
 * because it describes both this user and this project. Ranks above any
 * cwd-scoped recent (a single profile) but still below a confident detection.
 */
export const SCORE_COMBO_HERE = 55;
/**
 * A stack the user only ever confirmed in *other* directories. Still a hint —
 * they clearly like this pairing — but it says nothing about the repo they're
 * standing in, so it drops below everything cwd-scoped.
 */
export const SCORE_COMBO_ELSEWHERE = 28;
export const SCORE_RECENT_CWD = 40;
export const SCORE_RECENT_GLOBAL = 25;
export const SCORE_FEATURED = 15;
export const SCORE_DEFAULT = 5;

/**
 * Band for generic matches, scaled by match strength.
 *
 * Placed so curation still leads but a strong match isn't buried: above the
 * default always, past `SCORE_FEATURED` from ~0.32 strength, past a global
 * recent from ~0.77. It can never outrank a real detection, a confirmed combo,
 * or something the user launched in this very directory — those describe this
 * project or this user, while a match only describes a resemblance.
 */
export const SCORE_MATCHED_MIN = 8;
export const SCORE_MATCHED_MAX = 30;

/** Origin ordering used as a deterministic tie-break when scores match. */
const ORIGIN_RANK: Record<SuggestionOrigin, number> = {
  detected: 0,
  combo: 1,
  recent: 2,
  featured: 3,
  matched: 4,
  default: 5,
};

/**
 * Merge two signal lists the way `detectProfileV2` merges its own rules:
 * confidence is the max of both, reasons are unioned (deduped, first-seen
 * order). Pure.
 */
export function mergeSignals(...lists: Array<SuggestSignal[] | undefined>): SuggestSignal[] {
  const byName = new Map<string, SuggestSignal>();
  for (const list of lists) {
    for (const s of list ?? []) {
      const prev = byName.get(s.name);
      if (!prev) {
        byName.set(s.name, { name: s.name, confidence: s.confidence, reasons: [...s.reasons] });
        continue;
      }
      prev.confidence = Math.max(prev.confidence, s.confidence);
      for (const r of s.reasons) if (!prev.reasons.includes(r)) prev.reasons.push(r);
    }
  }
  return [...byName.values()].sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
}

/**
 * Rank concrete stacks for this directory.
 *
 * Candidate primaries come from (in descending authority): cwd detection,
 * previously-confirmed combos, recents, featured, and finally the Default
 * selector. Each primary is grown into a stack with its `autoSelect`
 * companions, strongly-detected content companions, and its top historical
 * partner — capped at `MAX_STACK_PARTS` and run through symmetric conflict
 * resolution, so a returned stack is always launchable as-is.
 *
 * The result is never empty as long as `profiles` or `defaultSelector` is
 * non-empty: with no signal at all the Default entry is returned with an
 * explicit "no clear signal" reason. Pure and deterministic.
 */
export function suggestStacks(input: SuggestInput): StackSuggestion[] {
  const limit = input.limit ?? 3;
  const known = new Map(input.profiles.map((p) => [p.value, p]));
  const conflictMap = buildConflictMap(input.profiles);
  const companions = input.companions ?? [];
  const companionByName = new Map(companions.map((c) => [c.profile, c]));

  const out: StackSuggestion[] = [];
  const seenKeys = new Set<string>();

  /**
   * Grow a primary into a full stack + reasons and record it, unless an equal
   * part-set was already recorded by a stronger source.
   */
  const record = (
    primaryParts: string[],
    score: number,
    origin: SuggestionOrigin,
    reasons: string[],
  ): void => {
    const seeds = primaryParts.filter((n) => known.has(n));
    if (seeds.length === 0) return;
    const parts = growStack(seeds, {
      known,
      conflictMap,
      companionByName,
      pairSuggestions: input.pairSuggestions,
    });
    const key = [...parts].sort().join("+");
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    const extra = parts.filter((p) => !seeds.includes(p));
    const withCompanions = [...reasons];
    for (const name of extra) {
      const why = companionByName.get(name)?.reason;
      withCompanions.push(why ? `+ ${name} (${why})` : `+ ${name}`);
    }
    out.push({ parts, score, origin, reasons: withCompanions.slice(0, 3) });
  };

  // 1. cwd detection — the strongest statement about *this* directory.
  for (const d of (input.detected ?? []).filter((d) => d.confidence >= DETECT_MIN_CONFIDENCE)) {
    if (!known.has(d.name)) continue;
    const pct = Math.round(d.confidence * 100);
    const why = d.reasons.slice(0, 2).join(", ");
    record([d.name], Math.round(d.confidence * SCORE_DETECTED), "detected", [
      why ? `${pct}% match — ${why}` : `${pct}% match`,
    ]);
  }

  // 2. stacks the user confirmed before (combo history), repo-scoped when the
  //    caller supplied attribution: what you launched *here* leads, what you
  //    launched elsewhere stays available but stops crowding out this
  //    directory's own signals.
  for (const c of [...(input.combos ?? [])].sort(byHereThenCountThenRecency)) {
    const parts = c.parts.filter((p) => known.has(p));
    if (parts.length < 2) continue;
    record(parts, comboScore(c), "combo", [comboReason(c)]);
  }

  // 3. recents — most-recent first, so "what I did here last" wins over
  //    "what I've done here most".
  const recentBase = input.recentsAreCwdScoped ? SCORE_RECENT_CWD : SCORE_RECENT_GLOBAL;
  const recentWhy = input.recentsAreCwdScoped ? "last used in this directory" : "you use this often";
  for (const r of [...(input.recents ?? [])].sort(byRecency)) {
    const parts = r.name.split("+").filter((p) => known.has(p));
    if (parts.length === 0) continue;
    record(parts, recentBase + Math.min(r.sessions, 5) * 2, "recent", [
      `${recentWhy} · ${r.sessions}× session${r.sessions === 1 ? "" : "s"}`,
    ]);
  }

  // 4. curated featured picks.
  for (const f of input.featured ?? []) {
    const parts = f.split("+").filter((p) => known.has(p));
    if (parts.length === 0) continue;
    record(parts, SCORE_FEATURED, "featured", ["featured pick"]);
  }

  // 5. Generic matches — every profile scored against the directory's own
  //    evidence. Strongest first, so cycling past the curated answers keeps
  //    landing on something relevant instead of running out.
  for (const m of [...(input.matched ?? [])].sort((a, b) => b.strength - a.strength)) {
    if (!known.has(m.name)) continue;
    const strength = Math.max(0, Math.min(1, m.strength));
    const score = Math.round(SCORE_MATCHED_MIN + strength * (SCORE_MATCHED_MAX - SCORE_MATCHED_MIN));
    record([m.name], score, "matched", [m.reason]);
  }

  // 6. Default — the answer when the directory says nothing. Recorded last so
  //    it only surfaces if it isn't already covered above.
  if (input.defaultSelector) {
    const parts = input.defaultSelector.split("+").filter((p) => known.has(p));
    if (parts.length > 0) {
      record(parts, SCORE_DEFAULT, "default", [
        out.length === 0 ? "no clear signal in this directory" : "your default profile",
      ]);
    }
  }

  return out
    .sort(
      (a, b) =>
        b.score - a.score ||
        ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin] ||
        a.parts.join("+").localeCompare(b.parts.join("+")),
    )
    .slice(0, limit);
}

/** Sort combos by local use first, then total use, then recency. */
function byHereThenCountThenRecency(a: SuggestCombo, b: SuggestCombo): number {
  return (
    (b.here ?? 0) - (a.here ?? 0) ||
    b.count - a.count ||
    (b.lastUsed ?? "").localeCompare(a.lastUsed ?? "")
  );
}

/**
 * Score a remembered stack against the directory it's being suggested for.
 * Unattributed history (`here === undefined`) keeps the original global score,
 * so a caller that can't scope loses nothing.
 */
function comboScore(c: SuggestCombo): number {
  if (c.here === undefined) return SCORE_COMBO + Math.min(c.count, 4) * 5;
  if (c.here > 0) return SCORE_COMBO_HERE + Math.min(c.here, 4) * 5;
  return SCORE_COMBO_ELSEWHERE + Math.min(c.count, 4) * 3;
}

/** The one-line "why" shown under a remembered stack. */
function comboReason(c: SuggestCombo): string {
  if (c.here === undefined) return `you launched this stack ${c.count}×`;
  if (c.here > 0) return `you launched this stack ${c.here}× here`;
  return `you launched this stack ${c.count}× in other directories`;
}

/** Sort recents newest-first, falling back to session count. */
function byRecency(a: SuggestRecent, b: SuggestRecent): number {
  return (b.lastUsed ?? "").localeCompare(a.lastUsed ?? "") || b.sessions - a.sessions;
}

/**
 * Grow a seed selection into a full stack: the seeds, then each seed's
 * `autoSelect` companions, then strongly-detected content companions, then the
 * top historical partner. Conflicts are resolved (first wins) and the result is
 * capped at `MAX_STACK_PARTS`. Pure.
 */
function growStack(
  seeds: string[],
  ctx: {
    known: Map<string, SuggestProfile>;
    conflictMap: Map<string, Set<string>>;
    companionByName: Map<string, SuggestCompanion>;
    pairSuggestions?: Map<string, string[]>;
  },
): string[] {
  const candidates: string[] = [...seeds];
  const push = (name: string) => {
    if (!ctx.known.has(name)) return;
    if (!candidates.includes(name)) candidates.push(name);
  };
  for (const seed of seeds) for (const a of ctx.known.get(seed)?.autoSelect ?? []) push(a);
  for (const [name, c] of ctx.companionByName) {
    if (c.confidence >= COMPANION_AUTO_CONFIDENCE) push(name);
  }
  const primary = seeds[0]!;
  for (const partner of ctx.pairSuggestions?.get(primary) ?? []) push(partner);
  // Conflict resolution runs over the whole candidate list so a companion that
  // fights a seed (or an earlier companion) is dropped, not silently stacked.
  return resolveConflicts(candidates, ctx.conflictMap).slice(0, MAX_STACK_PARTS);
}

/** Filesystem access used by `pathSignals`, injectable so tests stay pure. */
export interface PathProbe {
  exists: (p: string) => boolean;
  list: (p: string) => string[];
}

const REAL_PROBE: PathProbe = {
  exists: (p) => existsSync(p),
  list: (p) => {
    try {
      return readdirSync(p);
    } catch {
      return [];
    }
  },
};

/**
 * Directory-shape detections that `detectProfileV2` doesn't cover: workspace
 * conventions (a shop under `medusa-shops/`, a site under `websites/`) and a
 * few common project markers whose profile exists in this install.
 *
 * Returns ordinary `SuggestSignal`s so callers can `mergeSignals` them with the
 * dependency-based detections. Never throws — an unreadable directory yields
 * fewer signals, not an error.
 */
export function pathSignals(cwd: string, probe: PathProbe = REAL_PROBE): SuggestSignal[] {
  const out: SuggestSignal[] = [];
  const add = (name: string, confidence: number, reason: string) =>
    out.push({ name, confidence, reasons: [reason] });
  const has = (...names: string[]) => names.some((n) => probe.exists(join(cwd, n)));
  const segments = cwd.split(sep);
  const parent = segments[segments.length - 2] ?? "";
  const self = basename(cwd);

  // A shop under medusa-shops/ — the storefront config decides which sub-profile.
  if (parent === "medusa-shops" && self !== "base-template") {
    add("medusa-stack", 0.75, `medusa-shops/${self}`);
    if (has("next.config.js", "next.config.ts", "next.config.mjs", "storefront/next.config.js")) {
      add("medusa-next", 0.7, "next.js storefront");
    } else if (has("vite.config.ts", "vite.config.js", "storefront/vite.config.ts")) {
      add("medusa-vite", 0.7, "vite storefront");
    }
  }
  if (parent === "websites") add("frontend", 0.55, `websites/${self}`);

  if (has("wp-config.php", "wp-content")) add("wordpress", 0.85, "wp-config.php");
  if (has("package.xml") && has("CMakeLists.txt", "setup.py")) add("ros2", 0.8, "ROS package.xml");
  if (has(".n8n", "n8n.config.js")) add("n8n", 0.7, ".n8n/");
  if (has(".obsidian")) add("research", 0.6, "obsidian vault");

  const entries = probe.list(cwd).filter((e) => !e.startsWith("."));
  if (entries.some((e) => e.endsWith(".tf"))) add("ops", 0.6, "terraform files");
  // A directory that is nothing but prose: no build files, several .md.
  const files = entries.filter((e) => e.includes("."));
  const md = files.filter((e) => e.toLowerCase().endsWith(".md"));
  if (md.length >= 3 && md.length === files.length) {
    add("docs-writer", 0.55, `${md.length} markdown files, no code`);
  }
  return out;
}
