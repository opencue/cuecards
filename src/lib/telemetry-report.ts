/**
 * Telemetry reports.
 *
 * Reads `~/.config/cue/analytics.jsonl` and produces three views:
 *
 *   - top:     skills ranked by invocation count
 *   - zombies: skills declared in a profile but invoked 0 times in the window
 *   - misses:  redacted user prompts ranked by frequency, with the trigger
 *              phrases that matched but didn't fire
 *
 * All reports take a time window (default 30 days). All return data
 * structures the caller renders; no I/O beyond reading analytics.jsonl.
 */

import { readEvents } from "./analytics";

export interface TopSkillEntry {
  skill: string;
  invocations: number;
  lastInvokedTs: string | null;
}

export interface ZombieSkillEntry {
  skill: string;
  reason: "never-invoked" | "stale";
  lastInvokedTs: string | null;
}

export interface MissEntry {
  promptRedacted: string;
  count: number;
  matchedSkills: string[];
}

export interface ReportSnapshot {
  windowDays: number;
  totalInvocations: number;
  totalMisses: number;
  top: TopSkillEntry[];
  zombies: ZombieSkillEntry[];
  misses: MissEntry[];
}

export interface PromotionCandidate {
  skill: string;
  profile: string;
  invocations: number;
}

function sinceFromDays(days: number): Date {
  return new Date(Date.now() - days * 24 * 3600 * 1000);
}

export function topSkills(windowDays = 30, limit = 10): TopSkillEntry[] {
  const since = sinceFromDays(windowDays);
  const events = readEvents(since).filter((e) => (e.event === "skill_invoked" || e.event === "skill_hit") && e.skill);

  const counts = new Map<string, { hits: number; last: string }>();
  for (const e of events) {
    const skill = e.skill!;
    const entry = counts.get(skill) ?? { hits: 0, last: "" };
    entry.hits++;
    if (e.ts > entry.last) entry.last = e.ts;
    counts.set(skill, entry);
  }

  return [...counts.entries()]
    .map(([skill, d]) => ({ skill, invocations: d.hits, lastInvokedTs: d.last || null }))
    .sort((a, b) => b.invocations - a.invocations)
    .slice(0, limit);
}

/**
 * `declaredSkills` is the set of skill *names* (matched against
 * `skill_invoked.skill`) currently declared by the user's profile(s).
 * The caller is responsible for building this set; we keep this module
 * I/O-free beyond the analytics log.
 */
export function zombies(declaredSkills: Set<string>, windowDays = 30): ZombieSkillEntry[] {
  const since = sinceFromDays(windowDays);
  const events = readEvents(since).filter((e) => (e.event === "skill_invoked" || e.event === "skill_hit") && e.skill);

  const seen = new Map<string, string>(); // skill → most-recent ts
  for (const e of events) {
    const cur = seen.get(e.skill!);
    if (!cur || e.ts > cur) seen.set(e.skill!, e.ts);
  }

  const out: ZombieSkillEntry[] = [];
  for (const skill of declaredSkills) {
    const last = seen.get(skill);
    if (!last) {
      out.push({ skill, reason: "never-invoked", lastInvokedTs: null });
    }
  }
  return out.sort((a, b) => a.skill.localeCompare(b.skill));
}

export function missLeaderboard(windowDays = 30, limit = 20): MissEntry[] {
  const since = sinceFromDays(windowDays);
  const events = readEvents(since).filter((e) => e.event === "skill_miss" && e.prompt_redacted);

  const counts = new Map<string, { count: number; skills: Set<string> }>();
  for (const e of events) {
    const key = e.prompt_redacted!;
    const entry = counts.get(key) ?? { count: 0, skills: new Set<string>() };
    entry.count++;
    for (const s of e.matched_skills ?? []) entry.skills.add(s);
    counts.set(key, entry);
  }

  return [...counts.entries()]
    .map(([prompt, d]) => ({
      promptRedacted: prompt,
      count: d.count,
      matchedSkills: [...d.skills].sort(),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Promotion candidates: skills that fired in a profile, but the profile
 * does not declare them. Signal that smart-loader is soft-loading them
 * repeatedly — promote into the profile so they ship as real `Skill()`
 * entries instead.
 *
 * Caller passes a map of profile-name → declared skills set. Returns
 * entries sorted by invocation count desc.
 */
export function promotionCandidates(
  declaredByProfile: Map<string, Set<string>>,
  windowDays = 30,
  minInvocations = 3,
): PromotionCandidate[] {
  const since = sinceFromDays(windowDays);
  const events = readEvents(since).filter((e) => (e.event === "skill_invoked" || e.event === "skill_hit") && e.skill && e.profile);

  const counts = new Map<string, { skill: string; profile: string; n: number }>();
  for (const e of events) {
    const key = `${e.profile}|${e.skill!}`;
    const cur = counts.get(key) ?? { skill: e.skill!, profile: e.profile!, n: 0 };
    cur.n++;
    counts.set(key, cur);
  }

  const out: PromotionCandidate[] = [];
  for (const { skill, profile, n } of counts.values()) {
    if (n < minInvocations) continue;
    const declared = declaredByProfile.get(profile);
    if (declared && declared.has(skill)) continue;
    out.push({ skill, profile, invocations: n });
  }
  return out.sort((a, b) => b.invocations - a.invocations);
}

export function compositeReport(
  declaredSkills: Set<string>,
  windowDays = 30,
): ReportSnapshot {
  const since = sinceFromDays(windowDays);
  const events = readEvents(since);
  const totalInvocations = events.filter((e) => (e.event === "skill_invoked" || e.event === "skill_hit")).length;
  const totalMisses = events.filter((e) => e.event === "skill_miss").length;

  return {
    windowDays,
    totalInvocations,
    totalMisses,
    top: topSkills(windowDays, 10),
    zombies: zombies(declaredSkills, windowDays),
    misses: missLeaderboard(windowDays, 10),
  };
}
