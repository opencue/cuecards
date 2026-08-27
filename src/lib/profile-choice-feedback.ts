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
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { configDir } from "./config-paths";
import { repoScopeMatcher, type RepoScopeOptions } from "./repo-scope";
import type { StackSuggestion, SuggestSignal } from "./stack-suggest";

export const PROFILE_CHOICE_FEEDBACK_THRESHOLD = 3;
export const PROFILE_CHOICE_HISTORY_LIMIT = 1_000;
export const PROFILE_CHOICE_HISTORY_MAX_BYTES = 256 * 1024;
export const SCORE_PROFILE_CHOICE = 105;
export const SCORE_PINNED_PROFILE = 140;
export const PROFILE_CHOICE_RECORD_VERSION = 2;
export const PROFILE_CHOICE_RANKER_VERSION = "profile-feedback-v2-decay90";
export const PROFILE_CHOICE_DECAY_HALF_LIFE_DAYS = 90;
export const PROFILE_CHOICE_DECAYED_THRESHOLD = 2.5;
export const PROFILE_CHOICE_REPLAY_MIN_SAMPLE_SIZE = 30;

export interface ProfileChoiceCandidateSnapshot {
  selector: string;
  rank: number;
  score: number;
  origin: string;
}

export interface ProfileChoiceRecord {
  /** Missing on legacy rows. */
  schemaVersion?: number;
  rankerVersion?: string;
  ts: string;
  cwd: string;
  choice: string;
  /** Ranked selectors offered when the choice was made, best first. */
  suggested: string[];
  /** Rank in the displayed card; null means the palette supplied the choice. */
  chosenRank?: number | null;
  /** Hash of safe repository evidence ids; never contains source values. */
  evidenceHash?: string;
  surface?: string;
  /** Pre-feedback candidates used for deterministic offline replay. */
  candidates?: ProfileChoiceCandidateSnapshot[];
}

export interface ProfileChoiceUsage {
  selector: string;
  chosen: number;
  /** Times this selector was the top recommendation but another was chosen. */
  rejected: number;
  /** Exponentially-decayed equivalents used by the current ranker. */
  weightedChosen?: number;
  weightedRejected?: number;
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

export interface ProfileChoiceReplayMetrics {
  evaluated: number;
  topAccepted: number;
  topAcceptanceRate: number | null;
  meanReciprocalRank: number | null;
}

export interface ProfileChoiceReplayReport {
  records: number;
  replayable: number;
  skippedLegacy: number;
  sampleSizeRequired: number;
  sampleSizeSufficient: boolean;
  rankerVersions: Record<string, number>;
  evidenceCohorts: number;
  paired: {
    currentWins: number;
    legacyWins: number;
    ties: number;
  };
  legacy: ProfileChoiceReplayMetrics;
  current: ProfileChoiceReplayMetrics;
  topAcceptanceDelta: number | null;
}

export interface ProfileChoiceAggregateOptions {
  now?: Date;
  /** False reproduces the legacy non-decayed counter. */
  decay?: boolean;
}

export function profileChoiceHistoryPath(): string {
  return join(configDir(), "profile-choice-history.jsonl");
}

/** Stable, non-secret repository-evidence fingerprint for replay cohorts. */
export function profileSuggestionEvidenceHash(
  signals: readonly SuggestSignal[],
): string | null {
  const observations = signals
    .flatMap((signal) =>
      (signal.evidence ?? []).map((item) => `${signal.name}:${item.id}:${item.family}`),
    )
    .sort();
  if (observations.length === 0) return null;
  return createHash("sha256").update(observations.join("\n")).digest("hex").slice(0, 16);
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
  candidates?: readonly StackSuggestion[];
  evidenceHash?: string | null;
  surface?: string;
  rankerVersion?: string;
  now?: string;
  append?: (line: string) => void;
}): boolean {
  const choice = normalizeSelector(opts.choice);
  if (!choice) return false;
  const suggested = [...new Set(opts.suggested.map(normalizeSelector).filter(Boolean))].slice(0, 3);
  const candidates = (opts.candidates ?? [])
    .map((candidate, index): ProfileChoiceCandidateSnapshot | null => {
      const selector = normalizeSelector(candidate.parts);
      if (!selector) return null;
      return {
        selector,
        rank: index + 1,
        score: candidate.score,
        origin: candidate.origin,
      };
    })
    .filter((candidate): candidate is ProfileChoiceCandidateSnapshot => candidate !== null)
    .slice(0, 8);
  const shownRank = suggested.indexOf(choice);
  const record: ProfileChoiceRecord = {
    schemaVersion: PROFILE_CHOICE_RECORD_VERSION,
    rankerVersion: opts.rankerVersion ?? PROFILE_CHOICE_RANKER_VERSION,
    ts: opts.now ?? new Date().toISOString(),
    cwd: opts.cwd,
    choice,
    suggested,
    chosenRank: shownRank >= 0 ? shownRank + 1 : null,
    ...(opts.evidenceHash ? { evidenceHash: opts.evidenceHash } : {}),
    surface: opts.surface ?? "unknown",
    ...(candidates.length > 0 ? { candidates } : {}),
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
  options: ProfileChoiceAggregateOptions = {},
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
    const decay = options.decay !== false;
    const weight = decay ? profileChoiceDecayWeight(record.ts, options.now) : null;
    const chosen = get(choice);
    chosen.chosen += 1;
    if (weight !== null) chosen.weightedChosen = (chosen.weightedChosen ?? 0) + weight;
    if (typeof record.ts === "string" && (chosen.lastChosen ?? "") < record.ts) {
      chosen.lastChosen = record.ts;
    }

    // Only a declined top-1 is a real negative signal. Lower card entries may
    // never have been viewed, so treating all three as rejected would invent
    // feedback the user did not provide.
    const top = Array.isArray(record.suggested)
      ? normalizeSelector(record.suggested.find((item) => typeof item === "string") ?? "")
      : "";
    if (top && top !== choice) {
      const rejected = get(top);
      rejected.rejected += 1;
      if (weight !== null) {
        rejected.weightedRejected = (rejected.weightedRejected ?? 0) + weight;
      }
    }
  }
  return usage;
}

export function profileChoiceDecayWeight(ts: unknown, now = new Date()): number {
  if (typeof ts !== "string") return 1;
  const time = Date.parse(ts);
  if (!Number.isFinite(time)) return 1;
  const ageDays = Math.max(0, now.getTime() - time) / 86_400_000;
  return 2 ** (-ageDays / PROFILE_CHOICE_DECAY_HALF_LIFE_DAYS);
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
      ...(existing?.weightedChosen !== undefined
        ? { weightedChosen: existing.weightedChosen }
        : {}),
      ...(existing?.weightedRejected !== undefined
        ? { weightedRejected: existing.weightedRejected }
        : {}),
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
    } else {
      const chosenWeight = item.weightedChosen ?? item.chosen;
      const rejectedWeight = item.weightedRejected ?? item.rejected;
      const hasDecayedWeight =
        item.weightedChosen !== undefined || item.weightedRejected !== undefined;
      const threshold = hasDecayedWeight
        ? PROFILE_CHOICE_DECAYED_THRESHOLD
        : PROFILE_CHOICE_FEEDBACK_THRESHOLD;
      if (chosenWeight >= threshold) {
        const score = SCORE_PROFILE_CHOICE + Math.min(20, Math.round(chosenWeight - threshold));
        const weightedSuffix = item.weightedChosen === undefined
          ? ""
          : ` · ${chosenWeight.toFixed(1)} recent-weight`;
        const reason = `you chose this ${item.chosen}× here${weightedSuffix}`;
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
        rejectedWeight >= threshold
      ) {
        existing.score -= Math.min(24, Math.round(rejectedWeight * 4));
      }
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

function replayMetrics(evaluated: number, topAccepted: number, reciprocalRank: number): ProfileChoiceReplayMetrics {
  return {
    evaluated,
    topAccepted,
    topAcceptanceRate: evaluated === 0 ? null : topAccepted / evaluated,
    meanReciprocalRank: evaluated === 0 ? null : reciprocalRank / evaluated,
  };
}

/** Replay recorded pre-feedback candidates through the legacy and current rankers. */
export function replayProfileChoiceFeedback(
  lines: readonly string[],
  scope: RepoScopeOptions = {},
): ProfileChoiceReplayReport {
  const isInScope = repoScopeMatcher(scope);
  const rows: Array<{ line: string; record: Partial<ProfileChoiceRecord> }> = [];
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
    if (typeof record.choice !== "string" || !normalizeSelector(record.choice)) continue;
    rows.push({ line, record });
  }

  const history: string[] = [];
  let replayable = 0;
  let legacyTopAccepted = 0;
  let currentTopAccepted = 0;
  let legacyReciprocalRank = 0;
  let currentReciprocalRank = 0;
  let currentWins = 0;
  let legacyWins = 0;
  let ties = 0;
  const rankerVersions = new Map<string, number>();
  const evidenceCohorts = new Set<string>();

  for (const { line, record } of rows) {
    const candidates = Array.isArray(record.candidates)
      ? record.candidates
          .filter(
            (candidate): candidate is ProfileChoiceCandidateSnapshot =>
              candidate !== null &&
              typeof candidate === "object" &&
              typeof candidate.selector === "string" &&
              typeof candidate.rank === "number" &&
              typeof candidate.score === "number" &&
              Number.isFinite(candidate.score),
          )
          .sort((a, b) => a.rank - b.rank)
      : [];
    const eventTime = typeof record.ts === "string" ? Date.parse(record.ts) : Number.NaN;
    if (
      record.schemaVersion !== PROFILE_CHOICE_RECORD_VERSION ||
      candidates.length === 0 ||
      !Number.isFinite(eventTime)
    ) {
      history.push(line);
      continue;
    }

    replayable += 1;
    const rankerVersion = typeof record.rankerVersion === "string"
      ? record.rankerVersion
      : "unknown";
    rankerVersions.set(rankerVersion, (rankerVersions.get(rankerVersion) ?? 0) + 1);
    if (typeof record.evidenceHash === "string" && record.evidenceHash) {
      evidenceCohorts.add(record.evidenceHash);
    }
    const base: StackSuggestion[] = candidates.map((candidate) => ({
      parts: candidate.selector.split("+").filter(Boolean),
      score: candidate.score,
      reasons: ["recorded pre-feedback candidate"],
      origin: "detected",
    }));
    const choice = normalizeSelector(record.choice ?? "");
    const eventCwd = typeof record.cwd === "string" ? record.cwd : undefined;
    // `scope` selects which events to report. Ranking feedback must still stay
    // local to the repository where each individual choice was recorded;
    // otherwise `--all` lets one repository's habits reorder another's replay.
    const eventScope: RepoScopeOptions = eventCwd
      ? { cwd: eventCwd, ...(scope.repoRootOf ? { repoRootOf: scope.repoRootOf } : {}) }
      : scope;
    const legacyFeedback = aggregateProfileChoiceFeedback(history, eventScope, { decay: false });
    const currentFeedback = aggregateProfileChoiceFeedback(history, eventScope, {
      now: new Date(eventTime),
    });
    const known = new Set(
      [...base.flatMap((candidate) => candidate.parts), ...legacyFeedback.keys(), ...currentFeedback.keys()]
        .flatMap((selector) => selector.split("+"))
        .filter(Boolean),
    );
    const limit = Math.max(base.length, known.size);
    const legacyRanked = applyProfileChoiceFeedback(base, legacyFeedback, known, limit);
    const currentRanked = applyProfileChoiceFeedback(base, currentFeedback, known, limit);
    const legacyRank = legacyRanked.findIndex((item) => item.parts.join("+") === choice);
    const currentRank = currentRanked.findIndex((item) => item.parts.join("+") === choice);
    const legacyAccepted = legacyRank === 0;
    const currentAccepted = currentRank === 0;
    if (legacyAccepted) legacyTopAccepted += 1;
    if (currentAccepted) currentTopAccepted += 1;
    if (currentAccepted && !legacyAccepted) currentWins += 1;
    else if (legacyAccepted && !currentAccepted) legacyWins += 1;
    else ties += 1;
    if (legacyRank >= 0) legacyReciprocalRank += 1 / (legacyRank + 1);
    if (currentRank >= 0) currentReciprocalRank += 1 / (currentRank + 1);
    history.push(line);
  }

  const legacy = replayMetrics(replayable, legacyTopAccepted, legacyReciprocalRank);
  const current = replayMetrics(replayable, currentTopAccepted, currentReciprocalRank);
  return {
    records: rows.length,
    replayable,
    skippedLegacy: rows.length - replayable,
    sampleSizeRequired: PROFILE_CHOICE_REPLAY_MIN_SAMPLE_SIZE,
    sampleSizeSufficient: replayable >= PROFILE_CHOICE_REPLAY_MIN_SAMPLE_SIZE,
    rankerVersions: Object.fromEntries(
      [...rankerVersions.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
    evidenceCohorts: evidenceCohorts.size,
    paired: { currentWins, legacyWins, ties },
    legacy,
    current,
    topAcceptanceDelta:
      legacy.topAcceptanceRate === null || current.topAcceptanceRate === null
        ? null
        : current.topAcceptanceRate - legacy.topAcceptanceRate,
  };
}

export function readProfileChoiceReplay(
  path: string = profileChoiceHistoryPath(),
  scope: RepoScopeOptions = {},
): ProfileChoiceReplayReport {
  return replayProfileChoiceFeedback(readProfileChoiceHistoryLines(path), scope);
}

function defaultAppend(line: string): void {
  const path = profileChoiceHistoryPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, line);
}
