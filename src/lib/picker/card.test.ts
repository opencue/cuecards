import { describe, expect, test } from "bun:test";

import { COMPACT_ROWS, renderCardFrame, type CardSuggestion } from "./card";
import { displayWidth } from "./render-util";

const rust: CardSuggestion = {
  parts: ["rust", "secops"],
  labels: ["🦀 rust", "🔒 secops"],
  reasons: ["90% match — Cargo.toml", "+ secops (you pair these)"],
  totals: "31 skills · 2 mcps",
  alwaysOn: 6000,
};

const python: CardSuggestion = {
  parts: ["python"],
  labels: ["🐍 python"],
  reasons: ["80% match — pyproject.toml"],
  totals: "12 skills",
};

const base = { cwd: "/home/u/proj", index: 0, pin: true, cols: 80, rows: 40, ascii: false };

/** styleText only emits escapes when stdout is a TTY, which varies by runner. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const plain = (s: string) => s.replace(ANSI, "");

describe("renderCardFrame", () => {
  test("leads with the stack, its reasons and its cost", () => {
    const frame = renderCardFrame({ ...base, suggestions: [rust] });
    expect(frame).toContain("suggested stack");
    expect(frame).toContain("🦀 rust");
    expect(frame).toContain("🔒 secops");
    expect(frame).toContain("90% match — Cargo.toml");
    expect(frame).toContain("31 skills · 2 mcps");
    expect(frame).toContain("/home/u/proj");
  });

  /** The card's top border, where the page indicator rides. */
  const topBorder = (frame: string) =>
    plain(frame).split("\n").find((l) => l.startsWith("╭")) ?? "";

  test("page dots appear only when there is more than one suggestion", () => {
    expect(topBorder(renderCardFrame({ ...base, suggestions: [rust] }))).not.toContain("○");
    const many = renderCardFrame({ ...base, suggestions: [rust, python], index: 1 });
    // One dot per suggestion, filled on the one being shown.
    expect(topBorder(many)).toContain("○ ●");
    expect(many).toContain("🐍 python");
    expect(plain(many)).toContain("↹ next suggestion");
  });

  test("falls back to a numeric page indicator past eight suggestions", () => {
    const many = Array.from({ length: 12 }, () => python);
    expect(topBorder(renderCardFrame({ ...base, suggestions: many, index: 2 }))).toContain("3/12");
  });

  test("shows the pin decision as a switch beside the launch button", () => {
    const on = plain(renderCardFrame({ ...base, suggestions: [rust] }));
    expect(on).toContain("⏎ launch");
    expect(on).toContain("p ● pin to this folder");
    const off = plain(renderCardFrame({ ...base, suggestions: [rust], pin: false }));
    expect(off).toContain("p ○ pin to this folder");
    const disabled = plain(renderCardFrame({ ...base, suggestions: [rust], pinDisabled: true }));
    expect(disabled).toContain("⏎ launch");
    expect(disabled).not.toContain("pin to this folder");
  });

  test("meters the stack weight and only calls out a heavy one", () => {
    const heavy = plain(renderCardFrame({ ...base, suggestions: [{ ...rust, alwaysOn: 32_000 }] }));
    expect(heavy).toContain("~32k always-on");
    expect(heavy).toContain("⚠ heavy, slows the agent");
    expect(heavy).toContain("█");
    const light = plain(renderCardFrame({ ...base, suggestions: [rust] }));
    expect(light).toContain("~6.0k always-on");
    expect(light).not.toContain("⚠ heavy");
    // A light stack still gets a meter — the bar is a comparison, not a warning.
    expect(light).toContain("█");
  });

  test("help overlay replaces the body and lists every key", () => {
    const frame = renderCardFrame({ ...base, suggestions: [rust], help: true });
    for (const key of ["⏎", "e", "/", "a", "p", "?", "esc"]) expect(frame).toContain(key);
    expect(frame).toContain("edit the stack");
    expect(frame).not.toContain("suggested stack");
  });

  test("degrades to a usable frame when there is nothing to suggest", () => {
    const frame = renderCardFrame({ ...base, suggestions: [] });
    expect(frame).toContain("nothing to suggest");
    expect(frame).toContain("a browse every profile");
  });

  test("the card's right border lands in one column on every row", () => {
    const frame = plain(renderCardFrame({ ...base, suggestions: [{ ...rust, alwaysOn: 32_000 }] }));
    const bordered = frame
      .split("\n")
      .filter((l) => l.startsWith("╭") || l.startsWith("╰") || (l.startsWith("│") && l.endsWith("│") && l.length > 2));
    // Width in terminal cells, not code points — the emoji labels are 2 cells wide.
    const widths = new Set(bordered.map(displayWidth));
    expect(bordered.length).toBeGreaterThan(4);
    expect(widths.size).toBe(1);
  });

  test("ascii mode drops the emoji icons", () => {
    const frame = renderCardFrame({ ...base, suggestions: [rust], ascii: true });
    expect(frame).toContain("rust");
    expect(frame).not.toContain("🦀");
  });

  test("clips a long cwd instead of wrapping the header", () => {
    const frame = renderCardFrame({
      ...base,
      cwd: `/home/u/${"very-long-directory-name/".repeat(6)}`,
      suggestions: [rust],
    });
    for (const line of plain(frame).split("\n")) expect(line.length).toBeLessThanOrEqual(80);
    expect(frame).toContain("…");
  });

  test("compact mode drops spacer lines on a short terminal", () => {
    const tall = renderCardFrame({ ...base, suggestions: [rust], rows: 40 });
    const short = renderCardFrame({ ...base, suggestions: [rust], rows: COMPACT_ROWS - 1 });
    expect(short.split("\n").length).toBeLessThan(tall.split("\n").length);
    // The essentials survive the squeeze.
    expect(short).toContain("🦀 rust");
    expect(short).toContain("⏎ launch");
  });

  test("the action rows shed words instead of wrapping a narrow terminal", () => {
    for (const cols of [40, 56, 60, 72, 80, 120]) {
      const frame = plain(renderCardFrame({ ...base, cols, suggestions: [rust, python] }));
      for (const line of frame.split("\n")) expect(displayWidth(line)).toBeLessThanOrEqual(cols);
      expect(frame).toContain("⏎ launch");
      expect(frame).toContain("esc quit");
    }
  });

  test("caps the reason list at three lines", () => {
    const frame = renderCardFrame({
      ...base,
      suggestions: [{ ...rust, reasons: ["one", "two", "three", "four"] }],
    });
    expect(frame).toContain("three");
    expect(frame).not.toContain("four");
  });
});
