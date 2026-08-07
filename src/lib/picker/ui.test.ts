import { describe, expect, test } from "bun:test";

import { displayWidth } from "./render-util";
import {
  cardBottom,
  cardInner,
  cardLine,
  cardTop,
  cardWidth,
  clipVisible,
  formatAlwaysOn,
  keyTable,
  markWidth,
  meterBar,
  METER_FULL_TOKENS,
  padVisible,
  pageDots,
  sectionHeader,
  selectMark,
  stripAnsi,
  visibleWidth,
} from "./ui";

const ESC = String.fromCharCode(27);
/** A cyan-wrapped string, built by hand so the test doesn't depend on whether
 *  the runner's stdout happens to be a TTY. */
const styled = (s: string) => `${ESC}[36m${s}${ESC}[39m`;

describe("width helpers", () => {
  test("measures and strips styling rather than counting escape bytes", () => {
    expect(stripAnsi(styled("rust"))).toBe("rust");
    expect(visibleWidth(styled("rust"))).toBe(4);
    // Emoji are two cells wide even though they are one code point.
    expect(visibleWidth(styled("🦀 rust"))).toBe(7);
  });

  test("pads a styled string to a cell width without disturbing the styling", () => {
    const padded = padVisible(styled("rust"), 10);
    expect(visibleWidth(padded)).toBe(10);
    expect(padded).toContain(styled("rust"));
  });

  test("padding never truncates a string that is already too wide", () => {
    expect(stripAnsi(padVisible(styled("rust-core"), 4))).toBe("rust-core");
  });

  test("clipping keeps the styling when it fits and drops it when it cannot", () => {
    expect(clipVisible(styled("rust"), 10)).toBe(styled("rust"));
    const clipped = clipVisible(styled("rust-core"), 6);
    expect(displayWidth(clipped)).toBeLessThanOrEqual(6);
    expect(clipped).toContain("…");
  });
});

describe("inset card", () => {
  test("caps its width on a wide terminal and shrinks on a narrow one", () => {
    expect(cardWidth(400)).toBe(74);
    expect(cardWidth(60)).toBe(58);
    expect(cardWidth(10)).toBe(24);
  });

  test("every row is the same number of cells wide", () => {
    const w = cardWidth(80);
    const frame = [
      cardTop(w, "suggested stack", pageDots(0, 3)),
      cardLine(w),
      cardLine(w, "🦀 rust  +  🔒 secops"),
      cardLine(w, styled("39 skills · 3 mcps")),
      cardBottom(w),
    ];
    const widths = new Set(frame.map((l) => displayWidth(stripAnsi(l))));
    expect(widths).toEqual(new Set([w]));
  });

  test("over-long content is clipped to the card, never wrapped past it", () => {
    const w = cardWidth(80);
    const line = cardLine(w, "x".repeat(500));
    expect(displayWidth(stripAnsi(line))).toBe(w);
    expect(line).toContain("…");
  });

  test("a title and badge still leave rule between them", () => {
    const top = stripAnsi(cardTop(cardWidth(80), "keys", "1/9"));
    expect(top).toContain("keys");
    expect(top).toContain("1/9");
    expect(top).toContain("─");
    expect(top.startsWith("╭")).toBe(true);
    expect(top.endsWith("╮")).toBe(true);
  });

  test("inner width leaves room for both borders and the side padding", () => {
    const w = cardWidth(80);
    expect(cardInner(w)).toBe(w - 6);
  });
});

describe("pageDots", () => {
  test("says nothing when there is only one page", () => {
    expect(pageDots(0, 1)).toBe("");
    expect(pageDots(0, 0)).toBe("");
  });

  test("fills the dot for the current page", () => {
    expect(stripAnsi(pageDots(1, 3))).toBe("○ ● ○");
  });

  test("switches to a numeric indicator past the dot budget", () => {
    expect(stripAnsi(pageDots(2, 12))).toBe("3/12");
    expect(stripAnsi(pageDots(2, 12, 20))).toContain("○");
  });
});

describe("selectMark", () => {
  test("uses circles by default and brackets in ascii mode", () => {
    expect(stripAnsi(selectMark("on", false))).toBe("●");
    expect(stripAnsi(selectMark("off", false))).toBe("○");
    expect(stripAnsi(selectMark("blocked", false))).toBe("⊘");
    expect(stripAnsi(selectMark("on", true))).toBe("[x]");
    expect(stripAnsi(selectMark("off", true))).toBe("[ ]");
    expect(stripAnsi(selectMark("blocked", true))).toBe("[-]");
  });

  test("markWidth matches what selectMark actually renders", () => {
    for (const ascii of [true, false]) {
      for (const state of ["on", "off", "blocked"] as const) {
        expect(displayWidth(stripAnsi(selectMark(state, ascii)))).toBe(markWidth(ascii));
      }
    }
  });
});

describe("meterBar", () => {
  test("is the requested width whatever the value", () => {
    for (const v of [0, 1, 5_000, 20_000, 500_000]) {
      expect(displayWidth(stripAnsi(meterBar(v, 12)))).toBe(12);
    }
  });

  test("grows with the cost and pegs at full", () => {
    const filled = (v: number) => stripAnsi(meterBar(v, 12)).replace(/░/g, "").length;
    expect(filled(0)).toBe(0);
    expect(filled(10_000)).toBeGreaterThan(filled(4_000));
    expect(filled(METER_FULL_TOKENS)).toBe(12);
    expect(filled(METER_FULL_TOKENS * 5)).toBe(12);
  });

  test("a non-zero cost always shows at least one cell", () => {
    expect(stripAnsi(meterBar(100, 12)).startsWith("█")).toBe(true);
  });
});

describe("formatAlwaysOn", () => {
  test("keeps a decimal below 10k and drops it above", () => {
    expect(formatAlwaysOn(6_000)).toBe("~6.0k always-on");
    expect(formatAlwaysOn(13_400)).toBe("~13k always-on");
  });

  test("says nothing when the cost is unknown", () => {
    expect(formatAlwaysOn(0)).toBe("");
    expect(formatAlwaysOn(-1)).toBe("");
  });
});

describe("sectionHeader", () => {
  test("uppercases the name and trails the count", () => {
    expect(stripAnsi(sectionHeader("detected here", 3))).toBe("DETECTED HERE  3");
    expect(stripAnsi(sectionHeader("featured"))).toBe("FEATURED");
  });
});

describe("keyTable", () => {
  test("aligns the descriptions into one column", () => {
    const out = keyTable(
      [
        ["⏎", "launch"],
        ["space", "toggle"],
      ],
      9,
    ).map(stripAnsi);
    const starts = out.map((l) => l.indexOf(l.trimStart().split(" ").pop()!));
    expect(new Set(starts).size).toBe(1);
    expect(out[0]).toContain("launch");
  });
});
