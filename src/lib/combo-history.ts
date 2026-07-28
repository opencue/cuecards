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
import { repoScopeMatcher, type RepoScopeOptions } from "./repo-scope";

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
  /**
   * Directory the combo was confirmed in. Optional: rows written before this
   * field existed carry no attribution, and `readCombos` treats them as
   * foreign rather than guessing which repo they came from.
   */
  cwd?: string;
}

/**
 * Append a combo to the history log. No-op (returns false) when there's fewer
 * than two distinct parts — a single-profile pick isn't a combo. Deduplicates
 * parts (preserving order) so "a+a+b" records as "a+b". `now` is injected for
 * testability. Returns whether a line was written.
 *
 * `append` is injectable so tests don't touch the real config dir. `cwd` is the
 * launch directory, stored so `readCombos` can scope suggestions to the repo
 * you're actually in; omitting it records an unattributed row.
 */
export function recordCombo(
  parts: string[],
  now: string,
  append: (line: string) => void = defaultAppend,
  cwd?: string,
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
    ...(cwd ? { cwd } : {}),
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
  /** Times this stack was confirmed anywhere. */
  count: number;
  lastUsed?: string;
  /**
   * Of `count`, how many were confirmed in the scoping directory (see
   * `ReadCombosOptions.cwd`). `undefined` when no scope was requested — the
   * caller then has no per-repo signal and should treat the stack as it always
   * did. `0` means the stack is real but foreign to this directory.
   */
  here?: number;
}

/** Scope `here` counts to one repository. See `lib/repo-scope`. */
export type ReadCombosOptions = RepoScopeOptions;

/**
 * Aggregate the combo log into distinct stacks with a use count and the most
 * recent timestamp. Feeds the v2 picker's suggestion engine ("you launched this
 * stack 4× here"). Malformed lines are skipped; a missing log yields []. Never
 * throws.
 *
 * With `opts.cwd` set, stacks confirmed in that directory sort first regardless
 * of how heavily a foreign stack was used — the whole point of scoping is that
 * what you do in *this* repo outranks what you do everywhere else.
 */
export function readCombos(
  path: string = comboHistoryPath(),
  opts: ReadCombosOptions = {},
): ComboUsage[] {
  // undefined when the caller asked for no scoping — `here` then stays absent.
  const isInScope = repoScopeMatcher(opts);
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
    // An unattributed (pre-cwd) row is never claimed for the current repo.
    const rowCwd = typeof record.cwd === "string" ? record.cwd : undefined;
    const isHere = isInScope?.(rowCwd) ?? false;
    if (existing) {
      existing.count += 1;
      if (isHere) existing.here = (existing.here ?? 0) + 1;
      if (ts && (existing.lastUsed ?? "") < ts) existing.lastUsed = ts;
    } else {
      byProfile.set(selector, {
        parts,
        count: 1,
        lastUsed: ts,
        ...(isInScope === undefined ? {} : { here: isHere ? 1 : 0 }),
      });
    }
  }
  return [...byProfile.values()].sort(
    (a, b) =>
      (b.here ?? 0) - (a.here ?? 0) ||
      b.count - a.count ||
      (b.lastUsed ?? "").localeCompare(a.lastUsed ?? ""),
  );
}

function defaultAppend(line: string): void {
  const path = comboHistoryPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, line);
}
