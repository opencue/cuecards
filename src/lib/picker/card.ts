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
import { asciiIconsEnabled, clipToWidth, stripIconIfAscii } from "./render-util";
import { OVERHEAD_WARN_TOKENS } from "./tally";
import {
  BAR,
  button,
  cardBottom,
  cardInner,
  cardLine,
  cardTop,
  cardWidth,
  fitLine,
  formatAlwaysOn,
  keyHints,
  keyTable,
  meterBar,
  pageDots,
} from "./ui";

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

/** Terminal height below which the card renders without blank spacer lines.
 *  Set above the card's full height (~18 rows) so the squeeze happens *before*
 *  the frame would overflow, not after. */
export const COMPACT_ROWS = 20;

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
 *
 * Layout follows the grouped-inset idiom: the answer sits inside a rounded card
 * whose left border continues clack's gutter, and the actions live below it —
 * one filled pill for the thing you almost always want, a quiet keycap row for
 * everything else.
 */
export function renderCardFrame(state: CardState): string {
  const bar = BAR();
  const cols = state.cols ?? process.stdout.columns ?? 80;
  const compact = (state.rows ?? process.stdout.rows ?? 24) < COMPACT_ROWS;
  const ascii = state.ascii ?? asciiIconsEnabled();
  const icon = (s: string) => stripIconIfAscii(s, ascii);
  const width = cardWidth(cols);
  const inner = cardInner(width);
  const lines: string[] = [];
  /** A blank card row — dropped on a short terminal, where height is scarcer
   *  than calm. */
  const airInCard = () => {
    if (!compact) lines.push(cardLine(width));
  };

  lines.push(bar);
  lines.push(
    `${bar}  ${styleText("cyan", "◆")}  ${styleText("bold", "cue")}  ${styleText(
      "dim",
      clipToWidth(state.cwd, width - 10),
    )}`,
  );
  lines.push(bar);

  if (state.help === true) {
    lines.push(cardTop(width, "keys"));
    airInCard();
    for (const row of keyTable(KEY_HELP)) lines.push(cardLine(width, row));
    airInCard();
    lines.push(cardBottom(width));
    lines.push(bar);
    lines.push(`${bar}  ${keyHints([["?", "close help"]])}`);
    return lines.join("\n");
  }

  const current = state.suggestions[state.index];
  if (!current) {
    lines.push(cardTop(width, "nothing to suggest"));
    airInCard();
    lines.push(
      cardLine(width, styleText("dim", "no profiles are installed for this directory yet")),
    );
    airInCard();
    lines.push(cardBottom(width));
    lines.push(bar);
    lines.push(
      `${bar}  ${button("a browse every profile")}  ${keyHints([["esc", "cancel"]])}`,
    );
    return lines.join("\n");
  }

  // Page dots ride the top border, iOS-style: the count is ambient rather than
  // another line of text competing with the answer.
  lines.push(cardTop(width, "suggested stack", pageDots(state.index, state.suggestions.length)));
  airInCard();

  // The answer itself, given the most visual weight on the screen.
  const stack = current.labels
    .map((l) => styleText("bold", icon(l)))
    .join(styleText("dim", "  +  "));
  lines.push(cardLine(width, stack));
  airInCard();

  for (const reason of current.reasons.slice(0, 3)) {
    lines.push(cardLine(width, styleText("dim", clipToWidth(reason, inner))));
  }

  if (current.totals || (current.alwaysOn ?? 0) > 0) {
    airInCard();
    if (current.totals) lines.push(cardLine(width, styleText("dim", current.totals)));
    const alwaysOn = current.alwaysOn ?? 0;
    if (alwaysOn > 0) {
      // Weight as a meter, not just a number — "how heavy is this" is a
      // comparison, and a bar answers it without the reader doing arithmetic.
      const heavy = alwaysOn > OVERHEAD_WARN_TOKENS;
      const caption = heavy
        ? styleText("yellow", `${formatAlwaysOn(alwaysOn)} · ⚠ heavy, slows the agent`)
        : styleText("dim", formatAlwaysOn(alwaysOn));
      lines.push(cardLine(width, `${meterBar(alwaysOn)}  ${caption}`));
    }
  }

  airInCard();
  lines.push(cardBottom(width));
  lines.push(bar);

  // One filled pill for the action you almost always want, then the two
  // controls that change what it would do: which suggestion, and whether it
  // sticks. The pin reads as a switch — constant label, changing dot.
  // Everything below is offered in a long and a short form so a narrow
  // terminal drops words instead of wrapping the row.
  const budget = cols - 4;
  const actionRow = (pinLabel: string, nextLabel: string): string => {
    const parts: string[] = [button("⏎ launch")];
    if (state.suggestions.length > 1) parts.push(keyHints([["↹", nextLabel]]));
    if (state.pinDisabled !== true) {
      const dot = state.pin ? styleText("green", "●") : styleText("dim", "○");
      parts.push(`${styleText("dim", "p")} ${dot} ${styleText("dim", pinLabel)}`);
    }
    return parts.join(styleText("dim", "   "));
  };
  lines.push(
    `${bar}  ${fitLine(
      budget,
      actionRow("pin to this folder", "next suggestion"),
      actionRow("pin here", "next"),
    )}`,
  );

  lines.push(
    `${bar}  ${fitLine(
      budget,
      keyHints([
        ["e", "edit stack"],
        ["/", "search"],
        ["a", "all profiles"],
        ["?", "keys"],
        ["esc", "quit"],
      ]),
      keyHints([
        ["e", "edit"],
        ["/", "search"],
        ["a", "all"],
        ["?", "keys"],
        ["esc", "quit"],
      ]),
      // Last resort on a very narrow terminal: keep editing, the full
      // catalogue, and the way out. `?` still lists everything else.
      keyHints([
        ["e", "edit"],
        ["a", "all"],
        ["esc", "quit"],
      ]),
    )}`,
  );
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
    const bar = BAR();
    if (this.state === "cancel") return `${bar}  ${styleText("red", "■")}  cancelled`;
    if (this.state === "submit" && this.value === "launch") {
      const current = this.suggestions[this.index];
      const ascii = asciiIconsEnabled();
      const label = (current?.labels ?? []).map((l) => stripIconIfAscii(l, ascii)).join(" + ");
      return `${bar}  ${styleText("green", "◇")}  ${label}`;
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
