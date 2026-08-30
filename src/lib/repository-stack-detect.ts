/** Shared repository-to-profile stack detection for every user-facing surface. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Profile } from "../../profiles/_types";
import { detectProfileV2 } from "./auto-detect";
import {
  applyProfileChoiceFeedback,
  readProfileChoiceFeedback,
  type ProfileChoiceUsage,
} from "./profile-choice-feedback";
import { deepMatchProfiles, hasWarmDeepMatch, warmDeepMatchCache } from "./profile-match-llm";
import { listProfiles } from "./profile-loader";
import { resolveMatchContext } from "./profile-match";
import { scanProject, type ProjectInfo } from "./project-scanner";
import { profilesDir } from "./repo-root";
import {
  COMPANION_AUTO_CONFIDENCE,
  mergeSignals,
  pathSignals,
  repositorySupportedProfiles,
  suggestStacks,
  type StackSuggestion,
  type SuggestCombo,
  type SuggestCompanion,
  type SuggestMatch,
  type SuggestProfile,
  type SuggestRecent,
  type SuggestSignal,
} from "./stack-suggest";

export interface RepositoryStackDetectOptions {
  profiles?: SuggestProfile[];
  /** Advisor-enriched detections. Repository-only evidence is merged back in. */
  detected?: SuggestSignal[];
  /** Rules-only detections used for support and safe combination decisions. */
  repositoryDetected?: SuggestSignal[];
  companions?: SuggestCompanion[];
  recents?: SuggestRecent[];
  recentsAreCwdScoped?: boolean;
  combos?: SuggestCombo[];
  pairSuggestions?: Map<string, string[]>;
  featured?: string[];
  defaultSelector?: string;
  limit?: number;
  /** Read a warm semantic rerank; cold entries warm in the background. */
  deepMatch?: boolean;
  /** Injected in tests; omit to use repository-scoped local choice feedback. */
  feedback?: ReadonlyMap<string, ProfileChoiceUsage>;
}

export interface RepositoryStackReport {
  project: ProjectInfo;
  detected: SuggestSignal[];
  repositoryDetected: SuggestSignal[];
  matched: SuggestMatch[];
  supportedProfiles: Set<string>;
  /** Ranked before local choice feedback; used for unbiased offline replay. */
  baseSuggestions: StackSuggestion[];
  suggestions: StackSuggestion[];
  autoSelection: RepositoryStackAutoSelection;
}

export interface RepositoryStackAutoSelection {
  status: "confident" | "uncertain" | "none";
  /** Selector safe to pin without asking; null when the ranker abstains. */
  selector: string | null;
  /** Current top candidate, retained so callers can explain or force it. */
  candidate: string | null;
  score: number | null;
  margin: number | null;
  reason: string;
}

/** Heuristic score floor; calibrated by the production-path fixture eval. */
export const AUTO_SELECTION_MIN_SCORE = 75;
/** Minimum lead over the runner-up before a top suggestion is auto-pinnable. */
export const AUTO_SELECTION_MIN_MARGIN = 10;

export function decideAutoSelection(
  suggestions: readonly StackSuggestion[],
): RepositoryStackAutoSelection {
  const top = suggestions[0];
  if (!top) {
    return {
      status: "none",
      selector: null,
      candidate: null,
      score: null,
      margin: null,
      reason: "no profile suggestion",
    };
  }

  const candidate = top.parts.join("+");
  const runner = suggestions[1];
  const margin = runner ? top.score - runner.score : null;
  if (top.origin !== "detected" && top.origin !== "feedback") {
    return {
      status: "uncertain",
      selector: null,
      candidate,
      score: top.score,
      margin,
      reason: `top suggestion comes from ${top.origin}, not direct repository evidence`,
    };
  }
  if (top.score < AUTO_SELECTION_MIN_SCORE) {
    return {
      status: "uncertain",
      selector: null,
      candidate,
      score: top.score,
      margin,
      reason: `top score ${top.score} is below ${AUTO_SELECTION_MIN_SCORE}`,
    };
  }
  if (margin !== null && margin < AUTO_SELECTION_MIN_MARGIN) {
    return {
      status: "uncertain",
      selector: null,
      candidate,
      score: top.score,
      margin,
      reason: `top margin ${margin} is below ${AUTO_SELECTION_MIN_MARGIN}`,
    };
  }
  return {
    status: "confident",
    selector: candidate,
    candidate,
    score: top.score,
    margin,
    reason: margin === null ? "strong direct repository evidence" : `strong lead of ${margin}`,
  };
}

let cachedProfiles: Promise<SuggestProfile[]> | null = null;

/** Load only suggestion metadata; full profile resolution is too expensive here. */
export async function loadSuggestProfiles(): Promise<SuggestProfile[]> {
  if (!cachedProfiles) {
    cachedProfiles = listProfiles()
      .then(async (names) => {
        const rawByName = new Map<string, Profile>();
        await Promise.all(
          names.map(async (name) => {
            try {
              const raw = await readFile(join(profilesDir(), name, "profile.yaml"), "utf8");
              const parsed = parseYaml(raw) as Profile;
              if (parsed && typeof parsed === "object") rawByName.set(name, parsed);
            } catch {
              // Shared or malformed profiles remain selectable without metadata.
            }
          }),
        );

        const ancestorsOf = (name: string): string[] => {
          const ancestors: string[] = [];
          const visit = (current: string, seen: Set<string>) => {
            const inherits = rawByName.get(current)?.inherits;
            const parents = typeof inherits === "string" ? [inherits] : (inherits ?? []);
            for (const parent of parents) {
              if (!parent || seen.has(parent)) continue;
              seen.add(parent);
              ancestors.push(parent);
              visit(parent, seen);
            }
          };
          visit(name, new Set([name]));
          return ancestors;
        };

        return names.map((value): SuggestProfile => {
          const profile = rawByName.get(value);
          if (!profile) return { value };
          return {
            value,
            label: profile.icon ? `${profile.icon} ${value}` : value,
            hint: profile.description,
            recommends: [...(profile.recommends ?? [])],
            autoSelect: [...(profile.autoSelect ?? [])],
            conflicts: [...(profile.conflicts ?? [])],
            inherits: ancestorsOf(value),
          };
        });
      })
      .catch((error: unknown) => {
        cachedProfiles = null;
        throw error;
      });
  }
  return cachedProfiles;
}

function directSignals(cwd: string): SuggestSignal[] {
  return detectProfileV2(cwd).map((item) => ({
    name: item.profile,
    confidence: item.confidence,
    reasons: [...item.reasons],
    evidence: (item.evidence ?? []).map((observation) => ({ ...observation })),
  }));
}

function safePathSignals(cwd: string): SuggestSignal[] {
  try {
    return pathSignals(cwd);
  } catch {
    return [];
  }
}

async function genericMatches(
  cwd: string,
  known: ReadonlySet<string>,
  deepMatch: boolean,
  limit: number,
): Promise<SuggestMatch[]> {
  try {
    const context = resolveMatchContext(cwd);
    if (!context) return [];
    let ranked = context.matches;
    if (deepMatch) {
      if (hasWarmDeepMatch(context.evidence, context.docs)) {
        const deep = await deepMatchProfiles({
          evidence: context.evidence,
          docs: context.docs,
          lexical: context.matches,
        });
        if (deep.classified) ranked = deep.matches;
      } else {
        warmDeepMatchCache(cwd);
      }
    }
    return ranked
      .filter((match) => known.has(match.name))
      .slice(0, limit)
      .map((match) => ({
        name: match.name,
        strength: match.strength,
        reason: match.reason,
        matchedTerms: [...match.matchedTerms],
      }));
  } catch {
    return [];
  }
}

const GENERIC_COMBINATION_PROFILES = new Set([
  "backend",
  "backend-base",
  "core",
  "frontend",
  "full",
  "web-frontend-base",
]);

/** Direct integrations use 0.65 confidence in detectProfileV2. */
const EVIDENCE_COMBINATION_MIN_CONFIDENCE = 0.65;

function compatibleEvidenceProfiles(a: SuggestProfile, b: SuggestProfile): boolean {
  if (a.value === b.value) return true;
  if (GENERIC_COMBINATION_PROFILES.has(a.value) || GENERIC_COMBINATION_PROFILES.has(b.value)) {
    return false;
  }
  if (a.conflicts?.includes(b.value) || b.conflicts?.includes(a.value)) return false;
  if (a.inherits?.includes(b.value) || b.inherits?.includes(a.value)) return false;
  const mutuallyRecommended =
    a.recommends?.includes(b.value) === true && b.recommends?.includes(a.value) === true;
  return !mutuallyRecommended;
}

function compatibleEvidenceEntries(
  a: { signal: SuggestSignal; profile: SuggestProfile },
  b: { signal: SuggestSignal; profile: SuggestProfile },
): boolean {
  if (a.profile.value === b.profile.value) return true;
  const aFamilies = new Set((a.signal.evidence ?? []).map((item) => item.family));
  const bFamilies = (b.signal.evidence ?? []).map((item) => item.family);
  if (aFamilies.size > 0 && bFamilies.length > 0) {
    if (bFamilies.some((family) => aFamilies.has(family))) return false;
  } else {
    // Backward compatibility for injected/legacy signals without provenance.
    const reasons = new Set(a.signal.reasons);
    if (b.signal.reasons.some((reason) => reasons.has(reason))) return false;
  }
  return compatibleEvidenceProfiles(a.profile, b.profile);
}

/** Turn independent, high-confidence repository detections into safe companions. */
function evidenceCompanions(
  detected: readonly SuggestSignal[],
  profiles: readonly SuggestProfile[],
): SuggestCompanion[] {
  const byName = new Map(profiles.map((profile) => [profile.value, profile]));
  const candidates = detected
    .filter((signal) => signal.confidence >= EVIDENCE_COMBINATION_MIN_CONFIDENCE)
    .map((signal) => ({ signal, profile: byName.get(signal.name) }))
    .filter(
      (entry): entry is { signal: SuggestSignal; profile: SuggestProfile } =>
        entry.profile !== undefined,
    )
    .filter((entry) => !GENERIC_COMBINATION_PROFILES.has(entry.profile.value));

  return candidates
    .filter((entry) =>
      candidates.every((other) => compatibleEvidenceEntries(entry, other)),
    )
    .map(({ signal }) => ({
      profile: signal.name,
      confidence: Math.max(signal.confidence, COMPANION_AUTO_CONFIDENCE),
      reason: signal.reasons.slice(0, 2).join(", ") || "repository evidence",
    }));
}

/** Detect and rank complete profile stacks for one repository. */
export async function detectRepositoryStacks(
  cwd: string,
  options: RepositoryStackDetectOptions = {},
): Promise<RepositoryStackReport> {
  const project = scanProject(cwd);
  const profiles = options.profiles ?? (await loadSuggestProfiles());
  const known = new Set(profiles.map((profile) => profile.value));
  const repositoryDetected = mergeSignals(
    options.repositoryDetected ?? directSignals(cwd),
    safePathSignals(cwd),
  ).filter((signal) => known.has(signal.name));
  const detected = mergeSignals(options.detected, repositoryDetected).filter((signal) =>
    known.has(signal.name),
  );
  const limit = options.limit ?? 8;
  const matched = await genericMatches(cwd, known, options.deepMatch !== false, limit);
  const companionsByName = new Map<string, SuggestCompanion>();
  for (const companion of [
    ...(options.companions ?? []),
    ...evidenceCompanions(repositoryDetected, profiles),
  ]) {
    const previous = companionsByName.get(companion.profile);
    if (!previous || previous.confidence < companion.confidence) {
      companionsByName.set(companion.profile, companion);
    }
  }
  const companions = [...companionsByName.values()];
  const supportedProfiles = repositorySupportedProfiles(
    repositoryDetected,
    matched,
    companions,
  );
  const baseSuggestions = suggestStacks({
    profiles,
    detected,
    companions,
    recents: options.recents,
    recentsAreCwdScoped: options.recentsAreCwdScoped,
    combos: options.combos,
    pairSuggestions: options.pairSuggestions,
    featured: options.featured,
    matched,
    defaultSelector: options.defaultSelector,
    supportedProfiles,
    limit,
  });
  const feedback = options.feedback ?? readProfileChoiceFeedback(undefined, { cwd });
  const suggestions = applyProfileChoiceFeedback(
    baseSuggestions,
    feedback,
    known,
    limit,
    supportedProfiles,
  );
  const autoSelection = decideAutoSelection(suggestions);

  return {
    project,
    detected,
    repositoryDetected,
    matched,
    supportedProfiles,
    baseSuggestions,
    suggestions,
    autoSelection,
  };
}
