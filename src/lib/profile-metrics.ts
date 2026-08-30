/**
 * profile-metrics — honest token + usage accounting for profiles.
 *
 * Two facts the old per-command estimators got wrong:
 *
 *  1. Skill *bodies* are lazy. Claude Code injects each skill's name +
 *     description into context and loads the SKILL.md body only when the
 *     Skill tool invokes it. So the always-on cost of a skill is its
 *     frontmatter, not its whole body. Summing bodies (the old behaviour)
 *     over-counts the per-message budget by ~6×.
 *
 *  2. The materialized CLAUDE.md is the dominant always-on cost (~7–8K
 *     tokens), not the ~250 the old estimator assumed.
 *
 * Usage was also double-broken: `score` substring-grepped transcripts (false
 * positives) and `audit` filtered analytics by exact profile name (false
 * zeros, because a `core+skill-writer` session logs skills under whichever
 * selector was active). Here we read the analytics `skill_hit` stream and
 * match on shared profile *components*, so `skill-writer` and
 * `core+skill-writer` sessions count toward the same skill.
 */

import { readFileSync, existsSync, } from "node:fs";
import { join } from "node:path";
import { configDir } from "./config-paths";
import { repoRoot } from "./repo-root";

export const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}


/** Split a SKILL.md into its YAML frontmatter and body. */
function splitFrontmatter(text: string): { frontmatter: string; body: string } {
  if (!text.startsWith("---")) return { frontmatter: "", body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: "", body: text };
  return {
    frontmatter: text.slice(0, end),
    body: text.slice(end + 4),
  };
}

/**
 * Always-on token cost of a skill: its frontmatter (name + description +
 * tags), which is what Claude Code surfaces in the skill list every message.
 * The body is excluded — it's lazy-loaded on invocation.
 */
export function skillAlwaysOnTokens(id: string): number {
  try {
    const text = readFileSync(join(SKILLS_ROOT, id, "SKILL.md"), "utf8");
    const { frontmatter } = splitFrontmatter(text);
    return estimateTokens(frontmatter);
  } catch {
    return 0;
  }
}

/** Lazy token cost of a skill: the body, loaded only when invoked. */
export function skillBodyTokens(id: string): number {
  try {
    const text = readFileSync(join(SKILLS_ROOT, id, "SKILL.md"), "utf8");
    const { body } = splitFrontmatter(text);
    return estimateTokens(body);
  } catch {
    return 0;
  }
}

/**
 * Always-on tokens of the materialized CLAUDE.md for a selector, measured
 * directly when the runtime exists. Returns null when not materialized yet,
 * so callers can fall back to an estimate.
 */
export function materializedClaudeMdTokens(selector: string): number | null {
  const path = join(configDir(), "runtime", selector, "claude", "CLAUDE.md");
  try {
    return estimateTokens(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Profile components, e.g. "core+skill-writer" → ["core", "skill-writer"]. */
function components(selector: string): Set<string> {
  return new Set(selector.split("+").map((s) => s.trim()).filter(Boolean));
}

interface SkillHit {
  event?: string;
  profile?: string;
  skill?: string;
  ts?: string;
}

/**
 * Skills fired (per analytics `skill_hit` events) within `windowDays` for any
 * session whose active selector shares a component with `selector`. Returns
 * the set of skill ids seen. This is the trustworthy usage signal.
 */
export function firedSkills(selector: string, windowDays = 30): Set<string> {
  const fired = new Set<string>();
  const path = join(configDir(), "analytics.jsonl");
  if (!existsSync(path)) return fired;
  const want = components(selector);
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return fired;
  }
  for (const line of raw.split("\n")) {
    if (!line.includes('"skill_hit"')) continue;
    let ev: SkillHit;
    try {
      ev = JSON.parse(line) as SkillHit;
    } catch {
      continue;
    }
    if (ev.event !== "skill_hit" || !ev.skill) continue;
    if (ev.ts && Date.parse(ev.ts) < cutoff) continue;
    // Match when the firing session's selector shares any component with the
    // queried selector — unifies standalone and composite sessions.
    const evComps = ev.profile ? components(ev.profile) : new Set<string>();
    const shares = [...evComps].some((c) => want.has(c));
    if (evComps.size === 0 || shares) fired.add(ev.skill);
  }
  return fired;
}
