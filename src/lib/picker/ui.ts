/**
 * Visual primitives shared by the picker surfaces (v2 card + stack palette).
 *
 * The house style borrows from iOS's grouped-inset lists: one rounded card per
 * idea, uppercase muted section headers instead of heavy rules, a filled pill
 * for the single primary action, circular selection marks instead of ASCII
 * brackets, and page dots for "there is more to see here".
 *
 * Everything here is pure — no I/O, no TTY. `styleText` is a no-op when stdout
 * isn't a TTY, so tests assert on plain text.
 */

import { styleText } from "node:util";
import { clipToWidth, displayWidth } from "./render-util";

/** The clack gutter every picker line hangs off. */
export const BAR = (): string => styleText("gray", "│");

const ANSI = /\u001b\[[0-9;]*m/g;

/** Drop SGR escapes so a styled string can be measured and padded correctly. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI, "");
}

/** Rendered cell width of a possibly-styled string. */
export function visibleWidth(s: string): number {
  return displayWidth(stripAnsi(s));
}

/** Right-pad a possibly-styled string to `width` cells (never truncates). */
export function padVisible(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - visibleWidth(s)));
}

/** Clip a possibly-styled string to `width` cells, keeping the styling intact
 *  when it already fits. Styled strings that overflow are clipped plain — an
 *  over-long line is a layout bug we'd rather see unstyled than wrapped. */
export function clipVisible(s: string, width: number): string {
  if (visibleWidth(s) <= width) return s;
  return clipToWidth(stripAnsi(s), width);
}

// ── inset card ─────────────────────────────────────────────────────────────
//
// The card's left border sits in the same column as clack's `│` gutter, so the
// rail appears to thicken into a card rather than doubling up next to one.

/** Widest an inset card grows to, however wide the terminal is. Long lines are
 *  harder to scan than short ones; iOS caps its content width for the same
 *  reason. */
export const CARD_MAX_WIDTH = 74;

/** Outer width of the inset card for a given terminal width. */
export function cardWidth(cols: number): number {
  return Math.max(24, Math.min(CARD_MAX_WIDTH, cols - 2));
}

/** Inner (content) width — the outer width minus both borders and the 2-cell
 *  breathing room on each side. */
export function cardInner(width: number): number {
  return Math.max(8, width - 6);
}

/**
 * Top border, with an optional inline title on the left and a trailing badge
 * (page dots, a count) on the right:
 *
 *     ╭─ suggested stack ─────────────────────────────── ● ○ ○ ─╮
 */
export function cardTop(width: number, title?: string, badge?: string): string {
  if (!title && !badge) {
    return styleText("gray", `╭${"─".repeat(width - 2)}╮`);
  }
  const head = title ? ` ${styleText("bold", title)} ` : "";
  const tail = badge ? ` ${badge} ` : "";
  const fill = Math.max(1, width - 4 - visibleWidth(head) - visibleWidth(tail));
  return (
    styleText("gray", "╭─") +
    head +
    styleText("gray", "─".repeat(fill)) +
    tail +
    styleText("gray", "─╮")
  );
}

/** One content row inside the card, padded so the right border lines up. */
export function cardLine(width: number, content = ""): string {
  const inner = cardInner(width);
  const body = padVisible(clipVisible(content, inner), inner);
  const edge = styleText("gray", "│");
  return `${edge}  ${body}  ${edge}`;
}

/** Bottom border. */
export function cardBottom(width: number): string {
  return styleText("gray", `╰${"─".repeat(width - 2)}╯`);
}

// ── controls ───────────────────────────────────────────────────────────────

/** iOS page control: one dot per suggestion, filled for the current one. Falls
 *  back to `3/12` past `maxDots`, the same way iOS switches to a numeric page
 *  indicator rather than rendering an unreadable row of dots. */
export function pageDots(index: number, total: number, maxDots = 8): string {
  if (total <= 1) return "";
  if (total > maxDots) return styleText("dim", `${index + 1}/${total}`);
  return Array.from({ length: total }, (_, i) =>
    i === index ? styleText("cyan", "●") : styleText("dim", "○"),
  ).join(" ");
}

/**
 * A filled pill for the one action that matters on a screen — the terminal's
 * closest thing to iOS's tinted primary button. Inverse video paints the whole
 * label, so it reads as a solid block rather than another line of text.
 */
export function button(label: string, tone: "primary" | "muted" = "primary"): string {
  const text = ` ${label} `;
  return tone === "primary"
    ? styleText(["inverse", "cyan"], text)
    : styleText(["inverse", "gray"], text);
}

/**
 * Section header in the grouped-list idiom: uppercase, muted, with the row
 * count trailing. No rule — whitespace does the separating, which reads calmer
 * than a screen full of dashes.
 */
export function sectionHeader(name: string, count?: number): string {
  const label = styleText("bold", styleText("blueBright", name.toUpperCase()));
  return count === undefined ? label : `${label}  ${styleText("dim", String(count))}`;
}

/** Selection state of a list row. */
export type MarkState = "on" | "off" | "blocked";

/**
 * The selection mark. Circles read as "tap to toggle" the way iOS's selection
 * circles do, and a filled dot is far easier to spot down a column than `[x]`.
 * ASCII mode keeps the bracket form for fonts without the geometric shapes.
 */
export function selectMark(state: MarkState, ascii: boolean): string {
  if (ascii) {
    return state === "on"
      ? styleText("green", "[x]")
      : state === "blocked"
        ? styleText("dim", "[-]")
        : styleText("dim", "[ ]");
  }
  return state === "on"
    ? styleText("green", "●")
    : state === "blocked"
      ? styleText("dim", "⊘")
      : styleText("dim", "○");
}

/** Cell width `selectMark` occupies, so callers can budget the row. */
export function markWidth(ascii: boolean): number {
  return ascii ? 3 : 1;
}

/** Always-on token cost at which the meter reads full. Roughly the point where
 *  a stack has eaten a serious slice of the startup budget. */
export const METER_FULL_TOKENS = 20_000;

/**
 * A weight meter for a stack's always-on cost — the same information the
 * `⚠ heavy` badge carries, but readable at a glance and present even when the
 * stack is light. Colour tracks `tokenLevelEmoji`'s bands.
 */
export function meterBar(alwaysOn: number, width = 12): string {
  const ratio = Math.max(0, Math.min(1, alwaysOn / METER_FULL_TOKENS));
  const filled = Math.max(alwaysOn > 0 ? 1 : 0, Math.round(ratio * width));
  // `tokenLevelEmoji`'s four bands collapsed onto the three colours a terminal
  // reliably distinguishes: 🟢 green, 🟡/🟠 yellow, 🔴 red.
  const color = alwaysOn > 15_000 ? "red" : alwaysOn > 5_000 ? "yellow" : "green";
  return (
    styleText(color, "█".repeat(filled)) + styleText("gray", "░".repeat(Math.max(0, width - filled)))
  );
}

/** "~14k always-on" — the meter's caption. Returns "" for an unknown cost. */
export function formatAlwaysOn(alwaysOn: number): string {
  if (alwaysOn <= 0) return "";
  const k = alwaysOn >= 10_000 ? String(Math.round(alwaysOn / 1000)) : (alwaysOn / 1000).toFixed(1);
  return `~${k}k always-on`;
}

/**
 * A quiet keycap row: `space add · ↑↓ move · esc back`. Keys keep their normal
 * weight so they stand out from the dim descriptions around them.
 */
export function keyHints(pairs: ReadonlyArray<[string, string]>): string {
  // The key is left unstyled so it keeps the terminal's default (bright)
  // foreground next to its dim description — the contrast is what makes the
  // row scannable without adding another colour.
  return pairs
    .map(([key, what]) => `${key} ${styleText("dim", what)}`)
    .join(styleText("dim", "  ·  "));
}

/**
 * Pick the first candidate that fits `width`, falling back to a clip of the
 * last one. Footers degrade rather than wrap: a wrapped action row reflows the
 * whole list on a keystroke, which reads as the screen flickering.
 */
export function fitLine(width: number, ...candidates: string[]): string {
  for (const c of candidates) if (visibleWidth(c) <= width) return c;
  return clipVisible(candidates[candidates.length - 1] ?? "", width);
}

/** A two-column key/description list, used by the `?` help overlays. */
export function keyTable(pairs: ReadonlyArray<[string, string]>, keyCol = 9): string[] {
  return pairs.map(
    ([key, what]) =>
      `${styleText("cyan", padVisible(key, keyCol))}${styleText("dim", what)}`,
  );
}
