/**
 * Shared picker types. Kept in their own module so the v2 surfaces (card,
 * palette, flow) and `lib/picker` (classic) can both import them without a
 * cycle. `lib/picker` re-exports everything here for back-compat.
 */

import type { CompanionSignal } from "../companion-detect";
import type { UniversalSuggestion } from "../pair-suggestions";
import type { ProfileTally } from "./tally";

export interface PickerOption {
  value: string;
  label: string;
  hint: string;
  /** Semantic catalog group copied from profile metadata. */
  catalogGroup?: string;
  /** Hidden from the unfiltered catalogue, but included in fuzzy search. */
  searchOnly?: boolean;
  /** When true, sort this option above every other (used for the Default entry). */
  top?: boolean;
  /** When true, this is a non-selectable visual header. Selecting it re-prompts. */
  divider?: boolean;
  /**
   * Other profile `value`s that pair well with this one. Drives the post-pick
   * multiselect ("combine google-analytics with…"). Only names that resolve to
   * real options in the same list are offered.
   */
  recommends?: string[];
  /**
   * Companion profile `value`s that start CHECKED when this option is the
   * combine primary, regardless of cwd detection (the profile's `autoSelect:`).
   * Stronger than `recommends`; still opt-out (the user can uncheck).
   */
  autoSelect?: string[];
  /**
   * Other profile `value`s that are mutually exclusive with this one. In the
   * combine multiselect, checking this option auto-disables every conflict
   * (and vice versa). Used to stop e.g. medusa-vite + medusa-next being
   * stacked together.
   */
  conflicts?: string[];
  /** Resolved ancestors, used to avoid proposing ancestor+specialization stacks. */
  inherits?: string[];
  /**
   * Pre-check this option when the combine multiselect opens. Set by
   * launch.ts when cwd autodetection has high confidence in a recommended
   * partner (e.g. detect a Medusa storefront → auto-check medusa-vite).
   */
  preselect?: boolean;
}

export interface RenderOptions {
  cwd: string;
  includeFooter?: boolean;
}

/** A profile the user launched before, with recency + frequency. */
export interface PickerRecent {
  name: string;
  sessions: number;
  /** ISO timestamp; `null` when the analytics row carried no last-used date. */
  lastUsed?: string | null;
}

/** A multi-profile stack the user confirmed before (from combo-history). */
export interface PickerCombo {
  parts: string[];
  count: number;
  lastUsed?: string;
}

export interface PickerInput {
  cwd: string;
  options: PickerOption[];
  /** Skip writing .cue.profile if true. */
  noPin?: boolean;
  /**
   * Optional hook invoked after the user picks a profile (and pin confirm),
   * but before the outro line. Returned strings are emitted as `log.message`
   * inside the picker box, so they line up visually with the rest of the
   * prompt. Each string may contain its own newlines for multi-line entries.
   *
   * Failures inside the callback are caught and surfaced as a yellow warning
   * line — the picker still completes and returns the chosen profile.
   */
  details?: (profile: string) => Promise<string[]> | string[];
  /**
   * Pair affinity mined from local session history: for a given primary
   * profile, the list of partner profiles the user has frequently picked
   * alongside it. The combine multiselect surfaces these as additional
   * companion rows (beyond `recommends`) and pre-checks them.
   *
   * Keyed by primary profile `value`. Empty / missing keys = no historical
   * signal for that profile, fall back to recommends-only.
   */
  pairSuggestions?: Map<string, string[]>;
  /**
   * Raw cwd-autodetect results. The classic picker uses these for the
   * "switch profile?" nudge; the v2 suggestion engine ranks stacks from them.
   */
  detected?: ReadonlyArray<{ name: string; reasons: string[]; confidence: number }>;
  /** Rules-only repository detections used to gate history and AI suggestions. */
  repositoryDetected?: ReadonlyArray<{
    name: string;
    reasons: string[];
    confidence: number;
  }>;
  /**
   * Content-detected combine companions (see `lib/companion-detect`). Flat and
   * primary-independent: signals come from the cwd's contents (image/video
   * assets → higgsfield, markdown drafts → blog-writer, a registered brand
   * folder → postizz), not from which profile the user picks.
   */
  companions?: CompanionSignal[];
  /**
   * Cross-profile combine suggestions offered under *every* primary: the curated
   * featured set plus the user's most-frequently-picked profiles, mined from
   * session history (see `buildUniversalSuggestions`).
   */
  universalSuggestions?: UniversalSuggestion[];
  /**
   * Optional resolver for a single profile value's own resources, used to drive
   * per-row "N skills" hints and live combined-total previews. Called once per
   * offered profile; failures degrade gracefully (that row simply shows no
   * counts). Omitted in tests → no preview.
   */
  resourceTally?: (profileValue: string) => Promise<ProfileTally> | ProfileTally;
  /**
   * Profiles launched here before, most-recent-first (v2 suggestion engine).
   * `launch.ts` passes the cwd-scoped list when this directory has history and
   * the global list otherwise — same rule the classic Recent section uses.
   */
  recents?: PickerRecent[];
  /** True when `recents` is cwd-scoped rather than global (drives the reason text). */
  recentsAreCwdScoped?: boolean;
  /** Stacks the user confirmed before (v2 suggestion engine). */
  combos?: PickerCombo[];
  /** Curated `_featured.yaml` selectors (v2 suggestion engine). */
  featured?: string[];
  /** The resolved Default selector, e.g. `"core"` or `"core+ecc"` (v2 fallback). */
  defaultSelector?: string;
}

export interface PickerOutput {
  profile: string;
  pinned: boolean;
}
