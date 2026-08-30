/**
 * Skill activation analytics.
 *
 * Joins the on-disk telemetry log (skill_hit + skill_invoked events) with a
 * resolved profile's declared skills to answer: which skills declared by this
 * profile have actually fired in the last N days, which are dead weight?
 *
 * Used by:
 *   - `cue skill-report` — surfaces the table to the user
 *   - `cue prune --dead` — converts zombie list into profile.yaml edits
 *
 * Reads are best-effort: missing logs, malformed lines, and disabled telemetry
 * yield unknown usage. A skill becomes unused/zombie only after enough
 * observed profile launches without a hit.
 */

import { readEvents } from "./analytics";
import type { ResolvedProfile } from "../../profiles/_types";

export interface SkillUsageRow {
  /** Skill id as declared in the profile (matches what we'd write back). */
  id: string;
  /** Combined hits from skill_hit + skill_invoked events in the window. */
  hits: number;
  /** ISO timestamp of last hit, null when never seen. */
  lastUsed: string | null;
  /** Evidence-aware state: no observation, observed use, or observed non-use. */
  status: "unknown" | "used" | "unused";
  /** Distinct profile launches observed in the usage window. */
  exposures: number;
  /** True only after enough launches were observed with zero hits. */
  zombie: boolean;
}

export const MIN_SKILL_USAGE_EXPOSURES = 3;

export interface SkillReportOptions {
  /** How far back (in days) to count hits. Default 30. */
  windowDays?: number;
  /** Reference time (mostly for tests). Defaults to now. */
  now?: Date;
  /** Inject an event stream (mostly for tests). Defaults to `readEvents`. */
  source?: () => Iterable<{
    event: string;
    profile?: string;
    skill?: string;
    ts: string;
    session_id?: string;
  }>;
  /** Launches required before zero hits become evidence of non-use. Default 3. */
  minExposureSessions?: number;
}

/**
 * Build the per-skill usage table for a profile. A skill is "zombie" when
 * it's declared in the profile but recorded zero hits in the window. The
 * window default (30d) is wide enough to cover monthly habits and narrow
 * enough to flag real dead weight.
 */
export function computeSkillUsage(
  profile: ResolvedProfile,
  opts: SkillReportOptions = {},
): SkillUsageRow[] {
  const windowDays = opts.windowDays ?? 30;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const source = opts.source ?? (() => readEvents(cutoff));
  const minExposureSessions = opts.minExposureSessions ?? MIN_SKILL_USAGE_EXPOSURES;

  // Sum hits by skill id, restricted to events that could plausibly belong
  // to this profile. A composite like `a+b+c` accepts events tagged with
  // the composite itself OR any of its parts (the user may have launched
  // the same skills under any of those names historically). Untagged
  // events (no profile field) also count — better to overcount than to
  // mis-flag a real-use skill as zombie.
  const acceptedProfiles = new Set<string>([profile.name, ...profile.name.split("+")]);
  const hits = new Map<string, { count: number; last: string }>();
  const exposures = new Set<string>();
  for (const e of source()) {
    if (e.event === "start") {
      if (!e.profile || !acceptedProfiles.has(e.profile)) continue;
      exposures.add(e.session_id || `${e.profile}|${e.ts}`);
      continue;
    }
    if (e.event !== "skill_hit" && e.event !== "skill_invoked") continue;
    if (!e.skill) continue;
    if (e.profile && !acceptedProfiles.has(e.profile)) continue;
    const entry = hits.get(e.skill) ?? { count: 0, last: "" };
    entry.count++;
    if (e.ts > entry.last) entry.last = e.ts;
    hits.set(e.skill, entry);
  }

  const declaredIds = (profile.skills?.local ?? []).map((s) =>
    typeof s === "string" ? s : s.id,
  );

  const seen = new Set<string>();
  const rows: SkillUsageRow[] = [];
  for (const id of declaredIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    // Wildcards (e.g. `*/*`) expand to many skills at materialize time, so a
    // raw `*` ref can't be reported on directly. Skip — they'd always look
    // zombie. The expanded ids land via the materialized profile's skill list.
    if (id.includes("*")) continue;
    const h = hits.get(id) ?? { count: 0, last: "" };
    const status: SkillUsageRow["status"] =
      h.count > 0
        ? "used"
        : exposures.size >= minExposureSessions
          ? "unused"
          : "unknown";
    rows.push({
      id,
      hits: h.count,
      lastUsed: h.last || null,
      status,
      exposures: exposures.size,
      zombie: status === "unused",
    });
  }
  rows.sort((a, b) => b.hits - a.hits || a.id.localeCompare(b.id));
  return rows;
}

/** Just the zombies. Sorted alphabetically for predictable removal order. */
export function zombieSkills(rows: ReadonlyArray<SkillUsageRow>): string[] {
  return rows.filter((r) => r.zombie).map((r) => r.id).sort();
}

/**
 * Rough token cost estimate per skill — 4 chars per token. We don't read
 * the SKILL.md files here (no fs dependency in this module); callers that
 * have already loaded sizes can compute exact savings. This helper exists
 * so the report can show "drop these to save ~3k tokens" using a constant
 * approximation when we don't have the real file sizes.
 */
export function estimateTokenSavings(zombieCount: number, avgSkillBytes = 2400): number {
  return Math.round((zombieCount * avgSkillBytes) / 4);
}
