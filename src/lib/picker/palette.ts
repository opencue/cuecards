/**
 * The v2 picker's one and only list: a stack builder.
 *
 * Classic cue asked two questions on two screens ("which profile?" then
 * "combine it with?"). This surface asks one: everything selectable lives in a
 * single sectioned list, `space` adds or removes, typing fuzzy-filters, and a
 * sticky footer always shows the stack being built and what it costs.
 *
 * `fuzzyScore`, `filterRows` and `renderPaletteFrame` are pure so the matching
 * and layout rules are unit-testable without a TTY; `StackPalettePrompt` is the
 * live wrapper.
 */

import { Prompt, type PromptOptions } from "@clack/core";
import { styleText } from "node:util";
import { buildConflictMap, resolveConflicts } from "../profile-conflicts";
import { COMBINE_CATEGORY_ORDER, combineCategoryOf } from "./categories";
import {
  asciiIconsEnabled,
  clipToWidth,
  displayWidth,
  stripIconIfAscii,
  windowOptions,
} from "./render-util";
import {
  EMPTY_TALLY,
  formatOverheadBadge,
  formatStackTotals,
  unionTallyCounts,
  type ProfileTally,
} from "./tally";

/** Section title used for the flat ranked list while a filter is active. */
export const MATCHES_SECTION = "matches";

export const SUGGESTED_SECTION = "suggested";
export const DETECTED_SECTION = "detected here";
export const FREQUENT_SECTION = "you use often";
export const FEATURED_SECTION = "featured";

/** Sections that sit above the full catalogue, in render order. */
export const PRIORITY_SECTIONS: readonly string[] = [
  SUGGESTED_SECTION,
  DETECTED_SECTION,
  FREQUENT_SECTION,
  FEATURED_SECTION,
];

export interface PaletteRow {
  value: string;
  label: string;
  /** Short "why is this here" text; shown on the focused row. */
  hint?: string;
  /** Section this row belongs to; headers are emitted when it changes. */
  section: string;
  conflicts?: string[];
  /** Part of the suggested stack — gets a `→` gutter marker and a dim tag. */
  recommended?: boolean;
  /** Red trailing warning, e.g. `full`'s "never use this". */
  danger?: string;
}

export interface PaletteState {
  /** Every row, in section order. */
  rows: PaletteRow[];
  query: string;
  /** Index into the *filtered* row list. */
  cursor: number;
  selected: string[];
  /** Per-profile resources, for row hints and the footer total. */
  tallies?: Map<string, ProfileTally>;
  /** Max list rows visible at once; the list scrolls around the cursor. */
  maxRows?: number;
  ascii?: boolean;
  cols?: number;
  help?: boolean;
}

const KEY_HELP: ReadonlyArray<[string, string]> = [
  ["⏎", "launch the stack you built"],
  ["space", "add / remove the focused profile"],
  ["↑↓", "move"],
  ["type", "fuzzy-search every profile"],
  ["⌫", "delete a search character"],
  ["?", "toggle this help"],
  ["esc", "back to the suggestion"],
];

/** A profile as the palette needs it (a subset of `PickerOption`). */
export interface PaletteProfile {
  value: string;
  label: string;
  hint?: string;
  conflicts?: string[];
}

export interface BuildPaletteArgs {
  /** Every selectable profile, no dividers, no composites. */
  profiles: PaletteProfile[];
  /** Parts of the stack the card was showing — pre-selected and marked. */
  suggested: string[];
  detected?: ReadonlyArray<{ name: string; confidence: number; reasons: string[] }>;
  recents?: ReadonlyArray<{ name: string; sessions: number; lastUsed?: string | null }>;
  featured?: string[];
  /** Detections below this stay in the catalogue instead of being promoted to
   *  the "detected here" section. Defaults to `DETECTED_MIN_CONFIDENCE`. */
  minConfidence?: number;
}

/**
 * Confidence a detection needs to earn a "detected here" row. Mirrors the
 * suggestion engine's floor: below it the signal is noise (a stray tsconfig
 * suggesting `frontend`, `full` at 0.3) and promoting it buries the real rows.
 */
export const DETECTED_MIN_CONFIDENCE = 0.5;

/**
 * Lay the catalogue out for the palette: the suggested stack first, then what
 * this directory looks like, then what the user reaches for, then the curated
 * picks, then everything else grouped by category. Every profile appears
 * exactly once — the first section that claims it wins. Pure.
 */
export function buildPaletteRows(args: BuildPaletteArgs): PaletteRow[] {
  const byValue = new Map(args.profiles.map((o) => [o.value, o]));
  const claimed = new Set<string>();
  const rows: PaletteRow[] = [];
  const push = (value: string, section: string, over: Partial<PaletteRow> = {}): void => {
    const opt = byValue.get(value);
    if (!opt || claimed.has(value)) return;
    claimed.add(value);
    rows.push({
      value: opt.value,
      label: opt.label,
      hint: opt.hint,
      section,
      conflicts: opt.conflicts,
      danger: opt.value === "full" ? "never use this" : undefined,
      ...over,
    });
  };

  const minConfidence = args.minConfidence ?? DETECTED_MIN_CONFIDENCE;
  for (const v of args.suggested) push(v, SUGGESTED_SECTION, { recommended: true });
  for (const d of args.detected ?? []) {
    if (d.confidence < minConfidence) continue;
    push(d.name, DETECTED_SECTION, { hint: d.reasons.slice(0, 2).join(", ") });
  }
  for (const r of args.recents ?? []) {
    // Composite recents ("a+b") contribute their parts; the palette lists
    // single profiles and the user re-stacks them here.
    for (const part of r.name.split("+")) {
      push(part, FREQUENT_SECTION, {
        hint: `${r.sessions}× session${r.sessions === 1 ? "" : "s"}`,
      });
    }
  }
  for (const f of args.featured ?? []) {
    for (const part of f.split("+")) push(part, FEATURED_SECTION);
  }

  // Everything else, bucketed into category sections (stable order).
  const rest = args.profiles.filter((o) => !claimed.has(o.value));
  const buckets = new Map<string, PaletteProfile[]>();
  for (const o of rest) {
    const cat = combineCategoryOf(o.value);
    const list = buckets.get(cat);
    if (list) list.push(o);
    else buckets.set(cat, [o]);
  }
  for (const cat of COMBINE_CATEGORY_ORDER) {
    for (const o of buckets.get(cat) ?? []) push(o.value, cat);
  }
  // A category outside the known order (defensive — combineCategoryOf maps
  // unknowns to "other", which is in the list).
  for (const [cat, list] of buckets) {
    if ((COMBINE_CATEGORY_ORDER as readonly string[]).includes(cat)) continue;
    for (const o of list) push(o.value, cat);
  }
  return rows;
}

/**
 * Score how well `candidate` matches `query`. Higher is better; `null` means no
 * match at all. Case-insensitive subsequence matching with bonuses for exact
 * hits, prefixes, contiguous runs and word-boundary starts — so "rc" finds
 * `rust-core` while "rust" still ranks `rust` above `rust-core`. Pure.
 */
export function fuzzyScore(query: string, candidate: string): number | null {
  const q = query.trim().toLowerCase();
  const c = candidate.toLowerCase();
  if (q.length === 0) return 0;
  if (c === q) return 1000;
  if (c.startsWith(q)) return 900 - c.length;
  const idx = c.indexOf(q);
  if (idx >= 0) return 700 - idx * 2 - c.length;

  // Subsequence walk: every query char must appear in order.
  let ci = 0;
  let score = 300 - c.length;
  let prevHit = -2;
  for (const ch of q) {
    const found = c.indexOf(ch, ci);
    if (found < 0) return null;
    if (found === prevHit + 1) score += 15; // contiguous run
    if (found === 0 || c[found - 1] === "-" || c[found - 1] === " ") score += 10; // word start
    prevHit = found;
    ci = found + 1;
  }
  return score;
}

/**
 * Apply a query to the row list. An empty query returns the rows untouched
 * (sections intact); a non-empty query returns a flat list ranked by
 * `fuzzyScore`, re-labelled into a single `matches` section — while searching,
 * relevance beats grouping. Ties keep the original order. Pure.
 */
export function filterRows(rows: PaletteRow[], query: string): PaletteRow[] {
  if (query.trim().length === 0) return rows;
  const scored: Array<{ row: PaletteRow; score: number; i: number }> = [];
  rows.forEach((row, i) => {
    const byValue = fuzzyScore(query, row.value);
    const byLabel = fuzzyScore(query, row.label);
    const score = Math.max(byValue ?? Number.NEGATIVE_INFINITY, byLabel ?? Number.NEGATIVE_INFINITY);
    if (score > Number.NEGATIVE_INFINITY) scored.push({ row, score, i });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ row }) => ({ ...row, section: MATCHES_SECTION }));
}

/** Column the section-header count is aligned to. */
export const SECTION_RULE_COL = 30;

/**
 * Render one frame of the palette. Pure — same state in, same string out.
 */
export function renderPaletteFrame(state: PaletteState): string {
  const BAR = styleText("gray", "│");
  const cols = state.cols ?? process.stdout.columns ?? 80;
  const width = Math.max(24, cols - 6);
  const ascii = state.ascii ?? asciiIconsEnabled();
  const icon = (s: string) => stripIconIfAscii(s, ascii);
  const lines: string[] = [];

  lines.push(BAR);
  const filterTag =
    state.query.length > 0
      ? styleText("cyan", ` ${state.query}▏`)
      : styleText("dim", " type to search");
  lines.push(`${BAR}  ${styleText("cyan", "◆")}  ${styleText("bold", "build your stack")}${filterTag}`);

  if (state.help === true) {
    lines.push(BAR);
    for (const [key, what] of KEY_HELP) {
      lines.push(`${BAR}  ${styleText("cyan", key.padEnd(8))}${styleText("dim", what)}`);
    }
    lines.push(BAR);
    lines.push(`${BAR}  ${styleText("dim", "? close help")}`);
    return lines.join("\n");
  }

  const visible = filterRows(state.rows, state.query);
  const conflictMap = buildConflictMap(state.rows);
  const effective = new Set(resolveConflicts(state.selected, conflictMap));

  lines.push(BAR);
  if (visible.length === 0) {
    lines.push(`${BAR}  ${styleText("yellow", `nothing matches "${state.query}"`)}`);
  }

  // Per-section totals (across the whole filtered list, not just the window) so
  // a header count doesn't change as you scroll.
  const sectionTotals = new Map<string, number>();
  for (const r of visible) sectionTotals.set(r.section, (sectionTotals.get(r.section) ?? 0) + 1);

  const labelCol = Math.min(
    24,
    visible.reduce((m, r) => Math.max(m, displayWidth(icon(r.label))), 0),
  );
  const max = state.maxRows && state.maxRows > 0 ? state.maxRows : visible.length;
  const cursor = Math.max(0, Math.min(state.cursor, visible.length - 1));
  const win = windowOptions(visible, cursor, max);
  if (win.hiddenAbove > 0) lines.push(`${BAR}  ${styleText("dim", `↑ ${win.hiddenAbove} more`)}`);

  let lastSection: string | undefined;
  win.items.forEach((row, offset) => {
    const idx = win.start + offset;
    if (row.section !== lastSection) {
      if (lastSection !== undefined) lines.push(BAR);
      const count = String(sectionTotals.get(row.section) ?? 0);
      const rule = styleText(
        "gray",
        "─".repeat(Math.max(3, SECTION_RULE_COL - displayWidth(row.section) - 2)),
      );
      lines.push(
        `${BAR}  ${styleText("bold", styleText("blueBright", row.section))} ${rule} ${styleText("dim", count)}`,
      );
      lastSection = row.section;
    }
    lines.push(renderRow(row, idx === cursor, effective, conflictMap, { icon, labelCol, state, width }));
  });
  if (win.hiddenBelow > 0) lines.push(`${BAR}  ${styleText("dim", `↓ ${win.hiddenBelow} more`)}`);

  // Sticky footer: what you're about to launch, and what it costs.
  lines.push(BAR);
  const chosen = [...effective];
  if (chosen.length === 0) {
    lines.push(`${BAR}  ${styleText("dim", "nothing selected yet — space adds the focused profile")}`);
  } else {
    const labelOf = (v: string) => icon(state.rows.find((r) => r.value === v)?.label ?? v);
    lines.push(`${BAR}  ${styleText("green", clipToWidth(chosen.map(labelOf).join(" + "), width))}`);
    const tallies = state.tallies;
    if (tallies) {
      const picked = chosen.map((v) => tallies.get(v));
      const totals = formatStackTotals(unionTallyCounts(picked.map((t) => t ?? EMPTY_TALLY)));
      const pending = picked.some((t) => t === undefined) ? " …" : "";
      if (totals) lines.push(`${BAR}  ${styleText("dim", `${totals}${pending}`)}`);
      const badge = formatOverheadBadge(
        picked.reduce((sum, t) => sum + (t?.alwaysOn ?? 0), 0),
      );
      if (badge) lines.push(`${BAR}  ${styleText("yellow", clipToWidth(badge, width))}`);
    }
  }

  lines.push(BAR);
  const enterText =
    chosen.length > 0 ? `⏎ launch ${chosen.length} selected` : "⏎ pick at least one profile";
  lines.push(
    `${BAR}  ${styleText(chosen.length > 0 ? "cyan" : "dim", enterText)}${styleText(
      "dim",
      " · space toggle · ↑↓ move · ? help · esc back",
    )}`,
  );
  return lines.join("\n");
}

/** One list row: checkbox, label, per-row delta, conflict/recommendation tags. */
function renderRow(
  row: PaletteRow,
  isCursor: boolean,
  effective: Set<string>,
  conflictMap: Map<string, Set<string>>,
  ctx: {
    icon: (s: string) => string;
    labelCol: number;
    state: PaletteState;
    width: number;
  },
): string {
  const BAR = styleText("gray", "│");
  const isSel = effective.has(row.value);
  const arrow = isCursor
    ? styleText("cyan", "›")
    : row.recommended === true
      ? styleText("magenta", "→")
      : " ";

  // Blocked by an already-selected conflict: render disabled with the reason,
  // so a toggle that "doesn't take" explains itself.
  if (!isSel) {
    const partners = conflictMap.get(row.value);
    if (partners) {
      for (const sel of effective) {
        if (partners.has(sel)) {
          return `${BAR}  ${arrow} ${styleText("dim", "[—]")} ${styleText(
            "dim",
            `${ctx.icon(row.label)} (conflicts with ${sel})`,
          )}`;
        }
      }
    }
  }

  const box = isSel ? styleText("green", "[x]") : styleText("dim", "[ ]");
  const rawLabel = ctx.icon(row.label);
  const labelStyled = isSel || isCursor ? rawLabel : styleText("dim", rawLabel);
  const tally = ctx.state.tallies?.get(row.value);
  const delta = tally && tally.skills.length > 0 ? `${tally.skills.length} skills` : "";
  // The focused row's description can be a paragraph (some profiles carry a
  // 200-character blurb). Clip it to what's left on the line so one row can't
  // wrap across the screen and shove the rest of the list out of view.
  const gutter = 9; // "│  › [x] "
  const used = gutter + Math.max(displayWidth(rawLabel), ctx.labelCol) + displayWidth(delta) + 4;
  const hint =
    row.hint && isCursor
      ? styleText("dim", ` (${clipToWidth(row.hint, Math.max(16, ctx.width - used))})`)
      : "";
  const recTag = row.recommended === true ? styleText("dim", "  suggested") : "";
  const hasTrailer = delta !== "" || Boolean(row.danger);
  const pad = hasTrailer
    ? " ".repeat(Math.max(2, ctx.labelCol + 2 - displayWidth(rawLabel)))
    : "";
  const deltaStr = delta ? styleText("dim", delta) : "";
  const dangerTag = row.danger ? styleText("red", `${delta ? " · " : ""}${row.danger}`) : "";
  return `${BAR}  ${arrow} ${box} ${labelStyled}${pad}${deltaStr}${dangerTag}${hint}${recTag}`;
}

/**
 * Live palette prompt. Resolves with the conflict-free selection, or @clack's
 * cancel symbol on esc (the caller reads that as "go back to the card").
 * `hardCancel` marks ctrl-c so the caller can exit outright.
 */
export class StackPalettePrompt extends Prompt<string[]> {
  rows: PaletteRow[];
  query: string;
  cursor = 0;
  selected: string[];
  tallies: Map<string, ProfileTally>;
  help = false;
  hardCancel = false;
  /** Invoked when a row without a loaded tally is toggled, so the caller can
   *  fetch it and re-render. Best-effort; failures are swallowed. */
  onNeedTally?: (value: string) => void;

  constructor(opts: {
    rows: PaletteRow[];
    selected?: string[];
    query?: string;
    tallies?: Map<string, ProfileTally>;
    /** Row value the cursor should start on (e.g. the first "all profiles" row). */
    cursorAt?: string;
    onNeedTally?: (value: string) => void;
    /** Streams, injectable so the key handling is testable without a TTY. */
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
  }) {
    super(
      {
        render(this: StackPalettePrompt) {
          return this.renderFrame();
        },
        input: opts.input,
        output: opts.output,
      } as unknown as PromptOptions<string[], Prompt<string[]>>,
      false,
    );
    this.rows = opts.rows;
    this.query = opts.query ?? "";
    this.selected = [...(opts.selected ?? [])];
    this.tallies = opts.tallies ?? new Map();
    this.onNeedTally = opts.onNeedTally;
    if (opts.cursorAt) {
      const at = this.visibleRows().findIndex((r) => r.value === opts.cursorAt);
      if (at >= 0) this.cursor = at;
    }
    this.syncValue();

    this.on("key", (char, key) => {
      const name = key?.name;
      if (key?.ctrl === true && (name === "c" || char === "c")) {
        this.hardCancel = true;
        return;
      }
      if (name === "return") return;
      if (char === "?") {
        this.help = !this.help;
        return;
      }
      if (this.help) {
        this.help = false;
        return;
      }
      if (name === "up" || name === "down") {
        this.move(name === "up" ? -1 : 1);
        return;
      }
      if (name === "pageup" || name === "pagedown") {
        this.move(name === "pageup" ? -10 : 10);
        return;
      }
      if (name === "space") {
        this.toggle();
        return;
      }
      if (name === "backspace") {
        if (this.query.length > 0) {
          this.query = this.query.slice(0, -1);
          this.clampCursor();
        }
        return;
      }
      // Printable, single-character keys type into the filter. Space is claimed
      // by the toggle above, and profile names never contain one.
      if (char && char.length === 1 && char >= " " && key?.ctrl !== true && key?.meta !== true) {
        this.query += char;
        this.cursor = 0;
      }
    });
  }

  /** Rows currently on screen (after the filter). */
  visibleRows(): PaletteRow[] {
    return filterRows(this.rows, this.query);
  }

  private move(delta: number): void {
    const n = this.visibleRows().length;
    if (n === 0) return;
    this.cursor = Math.max(0, Math.min(n - 1, this.cursor + delta));
  }

  private clampCursor(): void {
    const n = this.visibleRows().length;
    this.cursor = n === 0 ? 0 : Math.max(0, Math.min(n - 1, this.cursor));
  }

  private toggle(): void {
    const row = this.visibleRows()[this.cursor];
    if (!row) return;
    if (this.selected.includes(row.value)) {
      this.selected = this.selected.filter((v) => v !== row.value);
    } else {
      this.selected = [...this.selected, row.value];
      if (!this.tallies.has(row.value)) this.onNeedTally?.(row.value);
    }
    this.syncValue();
  }

  private syncValue(): void {
    this.value = resolveConflicts(this.selected, buildConflictMap(this.rows));
  }

  /** Enter is a no-op until at least one profile is selected. */
  protected override _shouldSubmit(): boolean {
    return (this.value ?? []).length > 0;
  }

  private visibleWindow(): number {
    const rows = (this.output as { rows?: number } | undefined)?.rows ?? process.stdout.rows ?? 24;
    // Reserve the header (3), section spacers (2), footer (4) and scroll
    // markers (2); floor at 5 so a short terminal still lists something.
    return Math.max(5, rows - 11);
  }

  renderFrame(this: StackPalettePrompt): string {
    const BAR = styleText("gray", "│");
    if (this.state === "cancel") return `${BAR}  ${styleText("dim", "◇")}  back`;
    if (this.state === "submit") {
      const ascii = asciiIconsEnabled();
      const labels = (this.value ?? []).map((v) =>
        stripIconIfAscii(this.rows.find((r) => r.value === v)?.label ?? v, ascii),
      );
      return `${BAR}  ${styleText("green", "◇")}  ${labels.join(" + ")}`;
    }
    return renderPaletteFrame({
      rows: this.rows,
      query: this.query,
      cursor: this.cursor,
      selected: this.selected,
      tallies: this.tallies,
      help: this.help,
      maxRows: this.visibleWindow(),
      cols: (this.output as { columns?: number } | undefined)?.columns,
    });
  }
}
