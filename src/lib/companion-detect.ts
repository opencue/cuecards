/**
 * Content-aware combine-companion detection.
 *
 * The profile picker's "Combine X with…" multiselect is fed by static
 * `recommends:` lists and historical pairings — both blind to what's actually
 * in the directory. This module scans the cwd for CONTENT signals (image/video
 * assets, markdown drafts, a registered brand folder) and emits companion
 * profiles to surface (and auto-check) in that multiselect.
 *
 * Sibling to `auto-detect.ts`: same best-effort, 0–1 confidence, max-merge
 * discipline — but keyed on directory *content* rather than framework configs.
 * Pure + injectable (`listEntries`) so the rules are unit-testable without a
 * real filesystem.
 */

import { readdirSync } from "node:fs";
import { basename, extname } from "node:path";

import { DEP_PROFILE_RULES, type DetectionResultV2 } from "./auto-detect";

export interface CompanionSignal {
  /** Companion profile to surface in the combine multiselect. */
  profile: string;
  /** 0–1. Companions at/above the picker's auto-check threshold start checked. */
  confidence: number;
  /** Human-readable trigger, shown as the row hint (e.g. "12 image assets"). */
  reason: string;
}

export interface CompanionDetectInput {
  cwd: string;
  /** Only profiles installed in this cue install are eligible. */
  knownProfiles: ReadonlySet<string>;
  /** Registered postizz brand folder names (basenames under brands/). */
  brands?: ReadonlySet<string>;
  /**
   * Injectable shallow directory listing (entry names only, non-recursive).
   * Defaults to a best-effort `readdirSync(cwd)`; a missing/unreadable dir
   * yields an empty list, so detection silently produces no signals.
   */
  listEntries?: (cwd: string) => string[];
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm"]);
const CONTENT_DIRS = new Set(["content", "posts", "drafts"]);
// Markdown that isn't a draft — excluded from the draft count (case-folded stem).
const NON_DRAFT_MD = new Set([
  "readme",
  "agents",
  "claude",
  "changelog",
  "contributing",
  "license",
]);

// Tunables. Require ≥3 images before reading a directory as "image work" (one
// stray screenshot shouldn't trigger it); confidence climbs with the count,
// capped. Image/video/brand land at/above the picker's 0.7 auto-check line;
// markdown sits just below, so it surfaces but stays unchecked until toggled.
const MIN_IMAGES = 3;
const IMAGE_CONF_BASE = 0.7;
const IMAGE_CONF_STEP = 0.05;
const IMAGE_CONF_CAP = 0.9;
const VIDEO_CONF = 0.7;
const MIN_MD_DRAFTS = 2;
const MD_CONF = 0.6;
const BRAND_CONF = 0.8;

function defaultListEntries(cwd: string): string[] {
  try {
    return readdirSync(cwd);
  } catch {
    return [];
  }
}

/**
 * Scan `cwd` for content signals and return companion profiles to surface in
 * the combine multiselect — de-duped per profile (max confidence, merged
 * reasons), filtered to installed profiles, sorted by confidence DESC.
 */
export function detectCompanions(input: CompanionDetectInput): CompanionSignal[] {
  const list = (input.listEntries ?? defaultListEntries)(input.cwd);

  // Aggregate per profile: keep the strongest signal, accumulate its reasons.
  const acc = new Map<string, { confidence: number; reasons: string[] }>();
  const add = (profile: string, confidence: number, reason: string): void => {
    const entry = acc.get(profile) ?? { confidence: 0, reasons: [] };
    entry.confidence = Math.max(entry.confidence, confidence);
    if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
    acc.set(profile, entry);
  };

  let images = 0;
  let videos = 0;
  let mdDrafts = 0;
  let hasContentDir = false;
  for (const name of list) {
    const lower = name.toLowerCase();
    const ext = extname(lower);
    if (IMAGE_EXTS.has(ext)) {
      images++;
    } else if (VIDEO_EXTS.has(ext)) {
      videos++;
    } else if (ext === ".md") {
      if (!NON_DRAFT_MD.has(lower.slice(0, -3))) mdDrafts++;
    }
    // A `content/` (etc.) entry could be a dir or a file; either way it reads
    // as a drafts workspace for our purposes — a shallow listing can't cheaply
    // distinguish, and the false-positive cost (one extra unchecked row) is nil.
    if (CONTENT_DIRS.has(lower)) hasContentDir = true;
  }

  // ── images → higgsfield (confidence scales with count) ──
  if (images >= MIN_IMAGES) {
    const conf = Math.min(IMAGE_CONF_CAP, IMAGE_CONF_BASE + IMAGE_CONF_STEP * (images - MIN_IMAGES));
    add("higgsfield", conf, `${images} image assets`);
  }
  // ── video → higgsfield ──
  if (videos >= 1) {
    add("higgsfield", VIDEO_CONF, `${videos} video file${videos === 1 ? "" : "s"}`);
  }
  // ── markdown drafts / content dir → blog-writer ──
  if (mdDrafts >= MIN_MD_DRAFTS || hasContentDir) {
    add("blog-writer", MD_CONF, "markdown drafts");
  }
  // ── registered brand folder → postizz ──
  const brand = basename(input.cwd);
  if (input.brands?.has(brand)) {
    add("postizz", BRAND_CONF, `registered brand: ${brand}`);
  }

  return [...acc.entries()]
    .filter(([profile]) => input.knownProfiles.has(profile))
    .map(([profile, { confidence, reasons }]) => ({
      profile,
      confidence,
      reason: reasons.join(", "),
    }))
    .sort((a, b) => b.confidence - a.confidence || a.profile.localeCompare(b.profile));
}

/**
 * Floor applied to dep-detected service companions. In the *main picker* a
 * service dep deliberately sits below the auto-pick line (it must never
 * hijack Enter), but in the combine multiselect a direct package.json
 * dependency is a strong "you'll want this alongside" signal — and a
 * pre-checked row costs one keystroke to drop. 0.75 clears the picker's
 * COMBINE_AUTO_CHECK_CONFIDENCE (0.7) so these rows start checked.
 */
const SERVICE_COMPANION_CONF = 0.75;

/**
 * Convert dep-based profile detections (see `DEP_PROFILE_RULES`) into combine
 * companions: a repo with `stripe` in package.json gets the stripe profile
 * offered — pre-checked — when the user picks any primary. Only rules marked
 * `companion: true` qualify (primary stacks like react-native are excluded),
 * and only profiles installed in this cue install survive.
 */
export function serviceCompanions(
  detections: ReadonlyArray<DetectionResultV2>,
  knownProfiles: ReadonlySet<string>,
): CompanionSignal[] {
  const eligible = new Set(
    DEP_PROFILE_RULES.filter((r) => r.companion === true).map((r) => r.profile),
  );
  return detections
    .filter((d) => eligible.has(d.profile) && knownProfiles.has(d.profile))
    .map((d) => ({
      profile: d.profile,
      confidence: Math.max(d.confidence, SERVICE_COMPANION_CONF),
      reason: d.reasons.join(", "),
    }));
}
