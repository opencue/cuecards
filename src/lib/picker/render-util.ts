/**
 * Terminal layout primitives shared by every picker surface (classic list,
 * combine multiselect, v2 card + palette). Pure: no I/O, no TTY, no color.
 *
 * Extracted from `lib/picker`; re-exported there for back-compat.
 */

/**
 * Whether to render profile icons in ASCII-safe mode. Emoji and Private-Use
 * glyphs (vite ⚡, nextjs ▲, vercel 🔺) show as tofu boxes in fonts that lack
 * them. We can't probe a font's glyph coverage from Node — only the locale — so
 * the env var `CUE_ASCII_ICONS=1` is the reliable opt-in; a non-UTF-8 locale
 * flips it on automatically. Default off (icons shown).
 */
export function asciiIconsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (/^(1|true|yes)$/i.test(env.CUE_ASCII_ICONS ?? "")) return true;
  const loc = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  return loc !== "" && !/utf-?8/i.test(loc);
}

/**
 * Strip a leading icon cluster (emoji + variation selectors / ZWJ) from a label
 * when `ascii` is on, so "🔺 vercel" → "vercel". Pure-ASCII labels and labels
 * that are *entirely* non-ASCII (e.g. CJK names) are returned unchanged. Pure.
 */
export function stripIconIfAscii(label: string, ascii: boolean): string {
  if (!ascii) return label;
  const stripped = label.replace(/^[^\x00-\x7F]+\s*/u, "").trimStart();
  return stripped.length > 0 ? stripped : label;
}

/**
 * Approximate the rendered cell width of a string in a monospace terminal.
 * Emoji and CJK glyphs occupy two cells; variation selectors, ZWJ, and skin-
 * tone modifiers occupy none; everything else one. Good enough to column-align
 * rows whose labels carry leading emoji icons — not a full grapheme segmenter.
 * Pure.
 */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    // zero-width: ZWJ, variation selectors, skin-tone modifiers
    if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x1f3fb && cp <= 0x1f3ff)) {
      continue;
    }
    // wide: CJK blocks, fullwidth forms, and the emoji/supplementary planes
    if (
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      cp >= 0x1f000
    ) {
      w += 2;
      continue;
    }
    w += 1;
  }
  return w;
}

/**
 * Clip a string to `max` cells, appending "…" when it doesn't fit. Width-aware
 * (uses `displayWidth`), so a row of emoji labels clips at the right column
 * instead of overflowing. Returns the input unchanged when it already fits.
 */
export function clipToWidth(s: string, max: number): string {
  if (max <= 0) return "";
  if (displayWidth(s) <= max) return s;
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

/**
 * Slice a list down to a scrolling window of at most `max` rows, centered on
 * `activeIndex`. Returns the visible slice plus how many rows are hidden above
 * and below (for "↑/↓ N more" indicators). When everything fits, the whole
 * list is returned with zero hidden. The active row stays centered until the
 * window hits either end, then it pins so the last/first rows stay reachable.
 *
 * Pure + exported so the scroll math is unit-testable without a TTY.
 */
export function windowOptions<T>(
  items: T[],
  activeIndex: number,
  max: number,
): { items: T[]; start: number; hiddenAbove: number; hiddenBelow: number } {
  if (max <= 0 || items.length <= max) {
    return { items, start: 0, hiddenAbove: 0, hiddenBelow: 0 };
  }
  let start = activeIndex - Math.floor(max / 2);
  start = Math.max(0, Math.min(start, items.length - max));
  const end = start + max;
  return {
    items: items.slice(start, end),
    start,
    hiddenAbove: start,
    hiddenBelow: items.length - end,
  };
}
