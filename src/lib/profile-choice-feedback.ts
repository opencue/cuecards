/**
 * Local profile-choice feedback for the suggestion card.
 *
 * This is intentionally independent of analytics consent: the picker writes a
 * small JSONL file under cue's config directory and reads only this repository's
 * rows. Nothing is uploaded. Repeated explicit choices can correct a weak
 * detector; a one-off choice never changes ranking.
 */

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { configDir } from "./config-paths";
import { repoScopeMatcher, type RepoScopeOptions } from "./repo-scope";
import type { StackSuggestion } from "./stack-suggest";

export const PROFILE_CHOICE_FEEDBACK_THRESHOLD = 3;
export const PROFILE_CHOICE_HISTORY_LIMIT = 1_000;
export const PROFILE_CHOICE_HISTORY_MAX_BYTES = 256 * 1024;
export const SCORE_PROFILE_CHOICE = 105;
export const SCORE_PINNED_PROFILE = 140;

export interface ProfileChoiceRecord {
  ts: string;
  cwd: string;
  choice: string;
  /** Ranked selectors offered when the choice was made, best first. */
  suggested: string[];
}

export interface ProfileChoiceUsage {
  selector: string;
  chosen: number;
  /** Times this selector was the top recommendation but another was chosen. */
  rejected: number;
  lastChosen?: string;
  /** Explicit selector from this repository's nearest `.cue.profile`. */
  pinned?: boolean;
}

export interface ProfileSuggestionSelectorQuality {
  selector: string;
  shownFirst: number;
  accepted: number;
  overridden: number;
  acceptanceRate: number;
}

export interface ProfileSuggestionQuality {
  /** Valid explicit profile choices, including rows without a suggestion. */
  choices: number;
  /** Choices where a top suggestion existed and could be evaluated. */
  compared: number;
  topAccepted: number;
  topOverridden: number;
  /** Null until at least one suggestion has been accepted or overridden. */
  topAcceptanceRate: number | null;
  selectors: ProfileSuggestionSelectorQuality[];
}

export function profileChoiceHistoryPath(): string {
  return join(configDir(), "profile-choice-history.jsonl");
}

function normalizeSelector(value: string | readonly string[]): string {
  const raw = typeof value === "string" ? value.split("+") : value;
  const parts: string[] = [];
  for (const item of raw) {
    for (const piece of item.split("+")) {
      const part = piece.trim();
      if (part && !parts.includes(part)) parts.push(part);
    }
  }
  return parts.join("+");
}

function pinnedSelectorForCwd(cwd: string | undefined): string | null {
  if (!cwd) return null;
  let dir = resolve(cwd);
  while (true) {
    try {
      const firstLine = readFileSync(join(dir, ".cue.profile"), "utf8").split(/\r?\n/, 1)[0] ?? "";
      const selector = normalizeSelector(firstLine);
      if (selector) return selector;
    } catch {
      // Keep walking until the repository root.
    }
    if (existsSync(join(dir, ".git"))) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Append one best-effort local feedback row. */
export function recordProfileChoice(opts: {
  cwd: string;
  choice: string | readonly string[];
  suggested: ReadonlyArray<string | readonly string[]>;
  now?: string;
  append?: (line: string) => void;
}): boolean {
  const choice = normalizeSelector(opts.choice);
  if (!choice) return false;
  const suggested = [...new Set(opts.suggested.map(normalizeSelector).filter(Boolean))].slice(0, 3);
  const record: ProfileChoiceRecord = {
    ts: opts.now ?? new Date().toISOString(),
    cwd: opts.cwd,
    choice,
    suggested,
  };
  try {
    (opts.append ?? defaultAppend)(`${JSON.stringify(record)}\n`);
    return true;
  } catch {
    return false;
  }
}

/** Aggregate bounded JSONL rows, optionally scoped to cwd/repository. */
export function aggregateProfileChoiceFeedback(
  lines: readonly string[],
  scope: RepoScopeOptions = {},
): Map<string, ProfileChoiceUsage> {
  const isInScope = repoScopeMatcher(scope);
  const usage = new Map<string, ProfileChoiceUsage>();
  const rows = lines.slice(-PROFILE_CHOICE_HISTORY_LIMIT);
  const get = (selector: string): ProfileChoiceUsage => {
    const found = usage.get(selector);
    if (found) return found;
    const created = { selector, chosen: 0, rejected: 0 };
    usage.set(selector, created);
    return created;
  };

  for (const line of rows) {
    if (!line.trim()) continue;
    let record: Partial<ProfileChoiceRecord>;
    try {
      record = JSON.parse(line) as Partial<ProfileChoiceRecord>;
    } catch {
      continue;
    }
    const cwd = typeof record.cwd === "string" ? record.cwd : undefined;
    if (isInScope && !isInScope(cwd)) continue;
    const choice = typeof record.choice === "string" ? normalizeSelector(record.choice) : "";
    if (!choice) continue;
    const chosen = get(choice);
    chosen.chosen += 1;
    if (typeof record.ts === "string" && (chosen.lastChosen ?? "") < record.ts) {
      chosen.lastChosen = record.ts;
    }

    // Only a declined top-1 is a real negative signal. Lower card entries may
    // never have been viewed, so treating all three as rejected would invent
    // feedback the user did not provide.
    const top = Array.isArray(record.suggested)
      ? normalizeSelector(record.suggested.find((item) => typeof item === "string") ?? "")
      : "";
    if (top && top !== choice) get(top).rejected += 1;
  }
  return usage;
}

/**
 * Score how often the first picker suggestion was accepted versus overridden.
 * Rows are repository-scoped using the same rules as ranking feedback, so the
 * report measures exactly the history that can affect this picker.
 */
export function analyzeProfileSuggestionQuality(
  lines: readonly string[],
  scope: RepoScopeOptions = {},
): ProfileSuggestionQuality {
  const isInScope = repoScopeMatcher(scope);
  const selectors = new Map<
    string,
    Omit<ProfileSuggestionSelectorQuality, "acceptanceRate">
  >();
  let choices = 0;
  let compared = 0;
  let topAccepted = 0;
  let topOverridden = 0;

  for (const line of lines.slice(-PROFILE_CHOICE_HISTORY_LIMIT)) {
    if (!line.trim()) continue;
    let record: Partial<ProfileChoiceRecord>;
    try {
      record = JSON.parse(line) as Partial<ProfileChoiceRecord>;
    } catch {
      continue;
    }
    const cwd = typeof record.cwd === "string" ? record.cwd : undefined;
    if (isInScope && !isInScope(cwd)) continue;
    const choice =
      typeof record.choice === "string" ? normalizeSelector(record.choice) : "";
    if (!choice) continue;
    choices += 1;

    const top = Array.isArray(record.suggested)
      ? normalizeSelector(
          record.suggested.find((item) => typeof item === "string") ?? "",
        )
      : "";
    if (!top) continue;
    compared += 1;
    const selector = selectors.get(top) ?? {
      selector: top,
      shownFirst: 0,
      accepted: 0,
      overridden: 0,
    };
    selector.shownFirst += 1;
    if (choice === top) {
      selector.accepted += 1;
      topAccepted += 1;
    } else {
      selector.overridden += 1;
      topOverridden += 1;
    }
    selectors.set(top, selector);
  }

  return {
    choices,
    compared,
    topAccepted,
    topOverridden,
    topAcceptanceRate: compared > 0 ? topAccepted / compared : null,
    selectors: [...selectors.values()]
      .map((selector) => ({
        ...selector,
        acceptanceRate: selector.accepted / selector.shownFirst,
      }))
      .sort(
        (a, b) =>
          b.shownFirst - a.shownFirst ||
          b.acceptanceRate - a.acceptanceRate ||
          a.selector.localeCompare(b.selector),
      ),
  };
}

function readProfileChoiceHistoryLines(path: string): string[] {
  if (!existsSync(path)) return [];
  try {
    const size = statSync(path).size;
    const length = Math.min(size, PROFILE_CHOICE_HISTORY_MAX_BYTES);
    const buffer = Buffer.alloc(length);
    const fd = openSync(path, "r");
    try {
      readSync(fd, buffer, 0, length, Math.max(0, size - length));
    } finally {
      closeSync(fd);
    }
    let contents = buffer.toString("utf8");
    if (size > length) {
      const firstNewline = contents.indexOf("\n");
      contents = firstNewline >= 0 ? contents.slice(firstNewline + 1) : "";
    }
    return contents.split("\n");
  } catch {
    return [];
  }
}

export function readProfileChoiceFeedback(
  path: string = profileChoiceHistoryPath(),
  scope: RepoScopeOptions = {},
): Map<string, ProfileChoiceUsage> {
  const feedback = aggregateProfileChoiceFeedback(readProfileChoiceHistoryLines(path), scope);
  const pinned = pinnedSelectorForCwd(scope.cwd);
  if (pinned) {
    const existing = feedback.get(pinned);
    feedback.set(pinned, {
      selector: pinned,
      chosen: existing?.chosen ?? 0,
      rejected: existing?.rejected ?? 0,
      ...(existing?.lastChosen ? { lastChosen: existing.lastChosen } : {}),
      pinned: true,
    });
  }
  return feedback;
}

export function readProfileSuggestionQuality(
  path: string = profileChoiceHistoryPath(),
  scope: RepoScopeOptions = {},
): ProfileSuggestionQuality {
  return analyzeProfileSuggestionQuality(readProfileChoiceHistoryLines(path), scope);
}

/**
 * Promote/demote only after repeated evidence. A repeatedly chosen selector is
 * allowed to outrank detection; a repeatedly declined top-1 is penalized but
 * remains visible so repository evidence cannot be erased by history.
 */
export function applyProfileChoiceFeedback(
  suggestions: readonly StackSuggestion[],
  feedback: ReadonlyMap<string, ProfileChoiceUsage>,
  knownProfiles: ReadonlySet<string>,
  limit = suggestions.length,
  supportedProfiles?: ReadonlySet<string>,
): StackSuggestion[] {
  type RankedSuggestion = StackSuggestion & { order: number; pinned: boolean };
  const ranked: RankedSuggestion[] = suggestions.map((suggestion, index) => ({
    ...suggestion,
    parts: [...suggestion.parts],
    reasons: [...suggestion.reasons],
    order: index,
    pinned: false,
  }));
  const bySelector = new Map(ranked.map((item) => [item.parts.join("+"), item]));

  for (const item of feedback.values()) {
    const parts = item.selector.split("+").filter(Boolean);
    if (parts.length === 0 || parts.some((part) => !knownProfiles.has(part))) continue;
    if (
      supportedProfiles !== undefined &&
      !item.pinned &&
      parts.some((part) => !supportedProfiles.has(part))
    ) {
      continue;
    }
    const existing = bySelector.get(item.selector);
    if (item.pinned) {
      const reason = "pinned in .cue.profile";
      if (existing) {
        existing.pinned = true;
        existing.score = Math.max(existing.score, SCORE_PINNED_PROFILE);
        existing.origin = "feedback";
        existing.reasons = [reason, ...existing.reasons.filter((value) => value !== reason)].slice(0, 3);
      } else {
        const added: RankedSuggestion = {
          parts,
          score: SCORE_PINNED_PROFILE,
          reasons: [reason],
          origin: "feedback" as const,
          order: ranked.length,
          pinned: true,
        };
        ranked.push(added);
        bySelector.set(item.selector, added);
      }
    } else if (item.chosen >= PROFILE_CHOICE_FEEDBACK_THRESHOLD) {
      const score = SCORE_PROFILE_CHOICE + Math.min(20, item.chosen - PROFILE_CHOICE_FEEDBACK_THRESHOLD);
      const reason = `you chose this ${item.chosen}× here`;
      if (existing) {
        existing.score = Math.max(existing.score, score);
        existing.origin = "feedback";
        existing.reasons = [reason, ...existing.reasons.filter((value) => value !== reason)].slice(0, 3);
      } else {
        const added: RankedSuggestion = {
          parts,
          score,
          reasons: [reason],
          origin: "feedback" as const,
          order: ranked.length,
          pinned: false,
        };
        ranked.push(added);
        bySelector.set(item.selector, added);
      }
    } else if (
      existing &&
      item.chosen === 0 &&
      item.rejected >= PROFILE_CHOICE_FEEDBACK_THRESHOLD
    ) {
      existing.score -= Math.min(24, item.rejected * 4);
    }
  }

  return ranked
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.score - a.score ||
        Number(b.origin === "feedback") - Number(a.origin === "feedback") ||
        a.order - b.order,
    )
    .slice(0, Math.max(0, limit))
    .map(({ order: _order, pinned: _pinned, ...suggestion }) => suggestion);
}

function defaultAppend(line: string): void {
  const path = profileChoiceHistoryPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, line);
}
