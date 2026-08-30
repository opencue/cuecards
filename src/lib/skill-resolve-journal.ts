/**
 * Skill-resolution journal — a local record of how far library skills moved
 * through the surfaced → loaded → invoked → completed funnel.
 *
 * Modeled on `combo-history.ts`: written directly, no consent gate, no hook.
 * It deliberately does NOT go through `analytics.jsonl`, which `recordEvent`
 * gates on `cue telemetry enable` — promotion suggestions ("you've reached for
 * this skill 3× in this repo, keep it") must work out of the box, and a user
 * who declined telemetry has declined *sending* data, not remembering their own
 * directory.
 *
 * The journal is read-only input to a suggestion. Nothing here ever edits a
 * profile or a loadout; that stays a `cue loadout keep` the user runs.
 *
 * All writes are best-effort — a failed append never fails a resolution.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Mirrors `comboHistoryPath()` — same config dir, same XDG handling. */
export function resolveJournalPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "cue", "skill-resolve.jsonl");
}

export type SkillResolutionStage = "surfaced" | "loaded" | "invoked" | "completed";

export interface ResolveRecord {
  ts: string;
  /** Canonical skill id, e.g. "deployment/coolify". */
  id: string;
  cwd: string;
  profile: string;
  /** Observable point reached in the skill-resolution funnel. */
  stage: SkillResolutionStage;
  /** Which tier produced the hit — lets us tell cheap matches from LLM ones. */
  tier?: 1 | 2 | 3;
  score?: number;
}

/** Append one funnel observation. Never throws. */
export function recordResolve(rec: ResolveRecord): void {
  try {
    const path = resolveJournalPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(rec)}\n`);
  } catch {
    /* best-effort */
  }
}

/**
 * Count prior funnel observations per skill id, optionally scoped to one
 * directory. Actual invocations are the default promotion signal.
 *
 * Scoping to cwd is the point: "you keep reaching for the Coolify skill in
 * THIS repo" is an actionable signal; the same count spread across twelve
 * unrelated projects is not.
 */
export function resolveCounts(
  opts: { cwd?: string; stages?: ReadonlySet<SkillResolutionStage> } = {},
): Map<string, number> {
  const counts = new Map<string, number>();
  const stages = opts.stages ?? new Set<SkillResolutionStage>(["invoked"]);
  const path = resolveJournalPath();
  if (!existsSync(path)) return counts;

  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return counts;
  }

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let rec: ResolveRecord;
    try {
      rec = JSON.parse(line) as ResolveRecord;
    } catch {
      continue; // a torn line shouldn't discard the rest of the journal
    }
    if (!rec.id) continue;
    if (opts.cwd && rec.cwd !== opts.cwd) continue;
    // Legacy rows predate funnel stages and represent surfaced resolver hits.
    // They must not silently count as real usage.
    if (!rec.stage || !stages.has(rec.stage)) continue;
    counts.set(rec.id, (counts.get(rec.id) ?? 0) + 1);
  }
  return counts;
}

/** Invocations in this directory before we suggest making the skill permanent. */
export const PROMOTION_THRESHOLD = 3;
