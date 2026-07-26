/**
 * The v2 picker's opening surface: a card that answers "what should I launch
 * here?" instead of showing a 90-row list.
 *
 * `renderCardFrame` is pure (state in → string out) so every layout rule is
 * unit-testable without a TTY; `CardPrompt` is the thin live wrapper that maps
 * keypresses onto that state and resolves with the chosen action.
 */

import { Prompt, type PromptOptions } from "@clack/core";
import { styleText } from "node:util";
import { asciiIconsEnabled, clipToWidth, displayWidth, stripIconIfAscii } from "./render-util";
import { formatOverheadBadge } from "./tally";

/** What the user asked the card to do. */
export type CardAction = "launch" | "edit" | "search" | "all";

/** One suggestion, flattened for display. */
export interface CardSuggestion {
  /** Profile values, e.g. `["rust", "secops"]`. */
  parts: string[];
  /** Display labels (icons included), parallel to `parts`. */
  labels: string[];
  /** Why this is suggested — 1-3 short lines. */
  reasons: string[];
  /** "31 skills · 2 mcps", or "" while the tally is still loading. */
  totals?: string;
  /** Combined always-on token estimate; drives the heavy-stack warning. */
  alwaysOn?: number;
}

export interface CardState {
  cwd: string;
  suggestions: CardSuggestion[];
  /** Index of the shown suggestion. */
  index: number;
  /** Whether launching also writes `.cue.profile` here. */
  pin: boolean;
  /** Pinning unavailable (e.g. account alias launches) — hides the affordance. */
  pinDisabled?: boolean;
  /** Render the key-help overlay instead of the body. */
  help?: boolean;
  /** Force ASCII icon mode. Defaults to `asciiIconsEnabled()`. */
  ascii?: boolean;
  /** Terminal width; used to clip long lines. Defaults to 80. */
  cols?: number;
  /** Terminal height; below `COMPACT_ROWS` the card drops its spacer lines. */
  rows?: number;
}

/** Terminal height below which the card renders without blank spacer lines. */
export const COMPACT_ROWS = 16;

const KEY_HELP: ReadonlyArray<[string, string]> = [
  ["⏎", "launch this stack"],
  ["↹ / ↑↓", "show another suggestion"],
  ["e", "edit the stack (add or swap profiles)"],
  ["/", "search all profiles"],
  ["a", "browse every profile"],
  ["p", "pin / don't pin to this directory"],
  ["?", "toggle this help"],
  ["esc", "cancel"],
];

/**
 * Render one frame of the suggestion card. Pure — `styleText` is a no-op when
 * stdout isn't a TTY, so tests assert on plain text.
 */
export function renderCardFrame(state: CardState): string {
  const BAR = styleText("gray", "│");
  const cols = state.cols ?? process.stdout.columns ?? 80;
  const compact = (state.rows ?? process.stdout.rows ?? 24) < COMPACT_ROWS;
  const ascii = state.ascii ?? asciiIconsEnabled();
  const icon = (s: string) => stripIconIfAscii(s, ascii);
  // Room for the "│  " gutter plus a right margin.
  const width = Math.max(20, cols - 6);
  const lines: string[] = [];
  const blank = () => {
    if (!compact) lines.push(BAR);
  };

  lines.push(BAR);
  lines.push(
    `${BAR}  ${styleText("cyan", "◆")}  ${styleText("bold", "cue")} ${styleText(
      "dim",
      clipToWidth(state.cwd, width - 6),
    )}`,
  );

  if (state.help === true) {
    blank();
    for (const [key, what] of KEY_HELP) {
      const k = styleText("cyan", key.padEnd(8));
      lines.push(`${BAR}  ${k}${styleText("dim", what)}`);
    }
    lines.push(BAR);
    lines.push(`${BAR}  ${styleText("dim", "? close help")}`);
    return lines.join("\n");
  }

  const current = state.suggestions[state.index];
  if (!current) {
    blank();
    lines.push(`${BAR}  ${styleText("yellow", "no profiles available")}`);
    lines.push(BAR);
    lines.push(`${BAR}  ${styleText("dim", "a browse every profile · esc cancel")}`);
    return lines.join("\n");
  }

  blank();
  const counter =
    state.suggestions.length > 1 ? `${state.index + 1}/${state.suggestions.length}` : "";
  const heading = styleText("blueBright", styleText("bold", "suggested stack"));
  const pad = counter
    ? " ".repeat(Math.max(2, width - displayWidth("suggested stack") - displayWidth(counter)))
    : "";
  lines.push(`${BAR}  ${heading}${pad}${counter ? styleText("dim", counter) : ""}`);
  blank();

  const stack = current.labels.map(icon).join(styleText("dim", "  +  "));
  lines.push(`${BAR}    ${clipToWidth(stack, width - 2)}`);
  blank();

  for (const reason of current.reasons.slice(0, 3)) {
    lines.push(`${BAR}    ${styleText("dim", clipToWidth(reason, width - 2))}`);
  }
  if (current.totals) {
    lines.push(`${BAR}    ${styleText("dim", clipToWidth(current.totals, width - 2))}`);
  }
  const badge = formatOverheadBadge(current.alwaysOn ?? 0);
  if (badge) lines.push(`${BAR}    ${styleText("yellow", clipToWidth(badge, width - 2))}`);

  lines.push(BAR);
  // Lead with the one key that matters, and say exactly what it does — the pin
  // decision lives here now instead of in a follow-up confirm.
  const launchText =
    state.pinDisabled === true
      ? "⏎ launch"
      : state.pin
        ? "⏎ launch · pins to this directory"
        : "⏎ launch · no pin";
  lines.push(
    `${BAR}  ${styleText("cyan", launchText)}${
      state.suggestions.length > 1 ? styleText("dim", "   ↹ next suggestion") : ""
    }`,
  );
  const secondary = [
    "e edit",
    "/ search",
    "a all profiles",
    state.pinDisabled === true ? "" : state.pin ? "p don't pin" : "p pin",
    "? help",
    "esc cancel",
  ]
    .filter((s) => s.length > 0)
    .join(" · ");
  lines.push(`${BAR}  ${styleText("dim", clipToWidth(secondary, width))}`);
  return lines.join("\n");
}

/**
 * Live card prompt. Resolves with the action the user chose; the caller reads
 * `index` for which suggestion was showing and `pin` for the pin decision.
 * Cancels (esc / ctrl-c) resolve with @clack's cancel symbol, with `hardCancel`
 * set for ctrl-c so the caller can exit rather than fall back to a menu.
 */
export class CardPrompt extends Prompt<CardAction> {
  suggestions: CardSuggestion[];
  cwd: string;
  index = 0;
  pin: boolean;
  pinDisabled: boolean;
  help = false;
  /** True when the user pressed ctrl-c rather than esc. */
  hardCancel = false;

  constructor(opts: {
    cwd: string;
    suggestions: CardSuggestion[];
    pin: boolean;
    pinDisabled?: boolean;
    /** Streams, injectable so the key handling is testable without a TTY. */
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
  }) {
    super(
      {
        render(this: CardPrompt) {
          return this.renderFrame();
        },
        input: opts.input,
        output: opts.output,
      } as unknown as PromptOptions<CardAction, Prompt<CardAction>>,
      false,
    );
    this.cwd = opts.cwd;
    this.suggestions = opts.suggestions;
    this.pin = opts.pin;
    this.pinDisabled = opts.pinDisabled === true;
    // Enter submits whatever `value` holds; launching is the default action.
    this.value = "launch";

    this.on("key", (char, key) => {
      const name = key?.name;
      if (key?.ctrl === true && (name === "c" || char === "c")) {
        this.hardCancel = true;
        return;
      }
      if (name === "return") return; // base Prompt submits with value = "launch"
      if (name === "tab" || name === "down" || name === "right") {
        this.cycle(key?.shift === true && name === "tab" ? -1 : 1);
        return;
      }
      if (name === "up" || name === "left") {
        this.cycle(-1);
        return;
      }
      if (char === "?") {
        this.help = !this.help;
        return;
      }
      if (char === "p" && !this.pinDisabled) {
        this.pin = !this.pin;
        return;
      }
      if (this.help) {
        // While the overlay is up every other key just closes it, so a stray
        // keypress can't launch something from behind the help screen.
        this.help = false;
        return;
      }
      if (char === "e" || name === "space") return this.finish("edit");
      if (char === "/") return this.finish("search");
      if (char === "a") return this.finish("all");
    });
  }

  /** Enter can't launch what doesn't exist — with no suggestion the only ways
   *  out are the palette (`a` / `e` / `/`) and esc. */
  protected override _shouldSubmit(): boolean {
    return this.suggestions.length > 0;
  }

  private cycle(delta: number): void {
    const n = this.suggestions.length;
    if (n <= 1) return;
    this.help = false;
    this.index = (this.index + delta + n) % n;
  }

  /** Leave the prompt with a non-launch action (mirrors clack's ConfirmPrompt). */
  private finish(action: CardAction): void {
    this.value = action;
    this.state = "submit";
    this.close();
  }

  renderFrame(this: CardPrompt): string {
    const BAR = styleText("gray", "│");
    if (this.state === "cancel") return `${BAR}  ${styleText("red", "■")}  cancelled`;
    if (this.state === "submit" && this.value === "launch") {
      const current = this.suggestions[this.index];
      const ascii = asciiIconsEnabled();
      const label = (current?.labels ?? []).map((l) => stripIconIfAscii(l, ascii)).join(" + ");
      return `${BAR}  ${styleText("green", "◇")}  ${label}`;
    }
    if (this.state === "submit") return "";
    return renderCardFrame({
      cwd: this.cwd,
      suggestions: this.suggestions,
      index: this.index,
      pin: this.pin,
      pinDisabled: this.pinDisabled,
      help: this.help,
      cols: (this.output as { columns?: number } | undefined)?.columns,
      rows: (this.output as { rows?: number } | undefined)?.rows,
    });
  }
}
