/**
 * Profile-selector string handling: the `"a+b+c"` composite format, the picker's
 * control sentinels, and the normalization every write path funnels through.
 *
 * Extracted from `lib/picker`; re-exported there for back-compat.
 */

/** Sentinel-value prefix used by divider (non-selectable header) rows. */
export const DIVIDER_PREFIX = "__divider_";

/** Sentinel for the combine multiselect's "use <primary> alone" escape hatch. */
export const SKIP_COMBINE = "__skip_combine__";

/**
 * Sentinel for the "show all profiles" expand row. Toggling it reveals every
 * non-curated profile as a combine companion (one-way). Stripped from the
 * returned selection like `SKIP_COMBINE` — it's a control, not a profile.
 */
export const SHOW_ALL = "__show_all__";

const CONTROL_SENTINELS = new Set<string>([SHOW_ALL, SKIP_COMBINE]);

/**
 * Flatten composite picks (`"a+b"`) to their parts and drop duplicates,
 * preserving first-seen order. The combine picker's primary may already be a
 * composite, so a companion inside it — or one picked twice — must not double
 * up in the final selector, the runtime dir name, or the summary. Pure.
 *
 * Control sentinels (SHOW_ALL / SKIP_COMBINE) are dropped here as a write-
 * boundary backstop: the upstream filters are the primary defense, but this is
 * the last transform before the selector is joined and persisted to
 * `.cue.profile`, so a sentinel must never survive it even if a path regresses.
 */
export function dedupeSelectorParts(picks: string[]): string[] {
  const out: string[] = [];
  for (const pick of picks) {
    for (const part of pick.split("+")) {
      if (part.length > 0 && !CONTROL_SENTINELS.has(part) && !out.includes(part)) out.push(part);
    }
  }
  return out;
}

/**
 * Collapse a profile combo to "first +N more" once it exceeds `max` parts, so
 * a confirm row never wraps. `<= max` parts render in full. Pure.
 */
export function compressCombo(parts: string[], max = 3): string {
  if (parts.length <= max) return parts.join(" + ");
  return `${parts[0]} +${parts.length - 1} more`;
}
