/**
 * Combo history — a local, telemetry-independent record of multi-profile picks.
 *
 * When the picker confirms a combine (≥2 profiles), `recordCombo` appends one
 * line to `~/.config/cue/combo-history.jsonl`. Unlike `analytics.jsonl` (gated
 * on telemetry consent) and `session-log.jsonl` (written by the session-summary
 * Stop hook), this file is written directly by the picker with no consent gate
 * and no hook — so "remember the combos I pick" works out of the box.
 *
 * `pair-suggestions` folds these lines into its affinity map, so a combo picked
 * once resurfaces (unchecked, hinted) the next time its primary is chosen.
 *
 * All writes are best-effort: a failure to append never blocks a launch.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Resolved path mirrors `pair-suggestions.sessionLogPath` (same config dir). */
export function comboHistoryPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "cue", "combo-history.jsonl");
}

/** One recorded combo. `profile` is the full composite selector ("a+b+c") so
 *  `computeAffinityMap` (which reads `.profile`) can consume it unchanged. */
export interface ComboRecord {
  ts: string;
  profile: string;
  /** Convenience field — the first part, the profile the user picked first. */
  primary: string;
}

/**
 * Append a combo to the history log. No-op (returns false) when there's fewer
 * than two distinct parts — a single-profile pick isn't a combo. Deduplicates
 * parts (preserving order) so "a+a+b" records as "a+b". `now` is injected for
 * testability. Returns whether a line was written.
 *
 * `append` is injectable so tests don't touch the real config dir.
 */
export function recordCombo(
  parts: string[],
  now: string,
  append: (line: string) => void = defaultAppend,
): boolean {
  const deduped: string[] = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (part.length > 0 && !deduped.includes(part)) deduped.push(part);
  }
  if (deduped.length < 2) return false;
  const record: ComboRecord = {
    ts: now,
    profile: deduped.join("+"),
    primary: deduped[0]!,
  };
  try {
    append(JSON.stringify(record) + "\n");
    return true;
  } catch {
    return false; // best-effort — never block a launch on a logging failure
  }
}

/** Read the combo-history lines (newline-split, blank-tolerant). Missing file or
 *  read error → []. Exposed so `pair-suggestions` can fold these into affinity. */
export function readComboHistoryLines(path: string = comboHistoryPath()): string[] {
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8").split("\n");
  } catch {
    return [];
  }
}

/** One previously-confirmed stack, aggregated across the history log. */
export interface ComboUsage {
  parts: string[];
  count: number;
  lastUsed?: string;
}

/**
 * Aggregate the combo log into distinct stacks with a use count and the most
 * recent timestamp, newest-and-most-used first. Feeds the v2 picker's
 * suggestion engine ("you launched this stack 4×"). Malformed lines are
 * skipped; a missing log yields []. Never throws.
 */
export function readCombos(path: string = comboHistoryPath()): ComboUsage[] {
  const byProfile = new Map<string, ComboUsage>();
  for (const line of readComboHistoryLines(path)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let record: Partial<ComboRecord>;
    try {
      record = JSON.parse(trimmed) as Partial<ComboRecord>;
    } catch {
      continue;
    }
    const selector = typeof record.profile === "string" ? record.profile : "";
    const parts = selector.split("+").filter((p) => p.length > 0);
    if (parts.length < 2) continue;
    const existing = byProfile.get(selector);
    const ts = typeof record.ts === "string" ? record.ts : undefined;
    if (existing) {
      existing.count += 1;
      if (ts && (existing.lastUsed ?? "") < ts) existing.lastUsed = ts;
    } else {
      byProfile.set(selector, { parts, count: 1, lastUsed: ts });
    }
  }
  return [...byProfile.values()].sort(
    (a, b) => b.count - a.count || (b.lastUsed ?? "").localeCompare(a.lastUsed ?? ""),
  );
}

function defaultAppend(line: string): void {
  const path = comboHistoryPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, line);
}
