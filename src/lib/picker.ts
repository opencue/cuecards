/**
 * picker — interactive profile chooser.
 *
 * Two surfaces:
 *   - renderProfileList(): pure formatter (testable)
 *   - runPicker(): interactive TUI driven by @clack/prompts; opens stdin/stdout
 *
 * Picker writes the chosen profile to ./.cue.profile unless --no-pin is passed.
 * Cancel (esc / Ctrl-C) → exit code 130 (caller handles).
 *
 * The classic two-screen flow (filter-select → combine multiselect) lives in
 * picker/classic.ts; this file is a thin re-export barrel plus two small pure
 * functions (renderProfileList, groupByCategory are duplicated via re-export for
 * back-compat) and the runPicker dispatcher.
 */

import type { PickerInput, PickerOption, PickerOutput, RenderOptions } from "./picker/types";
import { pickerV2Enabled, runPickerV2 } from "./picker/flow";
import { runPickerClassic } from "./picker/classic";

// ── back-compat re-exports ────────────────────────────────────────────────────
// These used to live directly in this file; call sites and tests import them
// from "./picker", so re-export instead of churning every import path.
export { buildConflictMap, resolveConflicts } from "./profile-conflicts";
export {
  DIVIDER_PREFIX,
  SHOW_ALL,
  SKIP_COMBINE,
  compressCombo,
  dedupeSelectorParts,
} from "./picker/selector";
export {
  asciiIconsEnabled,
  displayWidth,
  stripIconIfAscii,
  windowOptions,
} from "./picker/render-util";
export {
  EMPTY_TALLY,
  OVERHEAD_WARN_TOKENS,
  formatCombinedPreview,
  formatOverheadBadge,
  formatTallyDelta,
  unionTallyCounts,
} from "./picker/tally";
export type { ProfileTally, TallyCounts } from "./picker/tally";
export type {
  PickerInput,
  PickerOption,
  PickerOutput,
  PickerRecent,
  PickerCombo,
  RenderOptions,
} from "./picker/types";
export { COMBINE_CATEGORY_ORDER, combineCategoryOf } from "./picker/categories";

// Optional always-on combine companions flow through the single
// `buildUniversalSuggestions` path as the `pinned` origin — re-exported here so
// existing `import { UNIVERSAL_COMPANIONS } from "./picker"` call sites keep
// resolving. The canonical definition lives in `./pair-suggestions`.
export { UNIVERSAL_COMPANIONS } from "./pair-suggestions";

// ── classic-flow re-exports ───────────────────────────────────────────────────
// Everything below used to live inline in this file and was migrated to
// picker/classic.ts. Re-exported here to keep the public surface stable.
export type {
  AsciiMSOption,
  BuildCompanionArgs,
  CombineFrameState,
} from "./picker/classic";
export {
  FEATURED_HINT,
  FREQUENT_HINT,
  UNIVERSAL_HINT,
  HISTORY_HINT,
  COMBINE_AUTO_CHECK_CONFIDENCE,
  MAX_FREQUENT_AUTOCHECK,
  CATEGORY_RULE_COL,
  groupByCategory,
  buildCompanionOptions,
  renderCombineFrame,
  applyShowAllExpansion,
  filterOptions,
  FilterSelectPrompt,
  runPickerClassic,
} from "./picker/classic";

// ── local functions ───────────────────────────────────────────────────────────

export function renderProfileList(opts: PickerOption[], render: RenderOptions): string {
  const lines: string[] = [];
  lines.push(`▍cue · pick a profile for ${render.cwd}`);
  lines.push("");
  for (const opt of opts) {
    lines.push(`  ${opt.label.padEnd(14)} ${opt.hint}`);
  }
  if (render.includeFooter !== false) {
    lines.push("  ─────");
    lines.push("  + new profile from this cwd...");
    lines.push("  ⓘ details (d) · pick once, no pin (n) · cancel (esc)");
  }
  return lines.join("\n");
}

/**
 * Interactive profile chooser. Delegates to the v2 suggestion-first flow (a
 * ranked stack card backed by one unified palette) unless the user opts back
 * into the classic two-screen picker with `CUE_PICKER=classic`.
 */
export async function runPicker(input: PickerInput): Promise<PickerOutput> {
  if (pickerV2Enabled()) return runPickerV2(input);
  return runPickerClassic(input);
}
