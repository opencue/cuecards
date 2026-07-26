import { describe, expect, test } from "bun:test";

import { COMPACT_ROWS, renderCardFrame, type CardSuggestion } from "./card";

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

  test("shows a counter only when there is more than one suggestion", () => {
    expect(renderCardFrame({ ...base, suggestions: [rust] })).not.toContain("1/1");
    const many = renderCardFrame({ ...base, suggestions: [rust, python], index: 1 });
    expect(many).toContain("2/2");
    expect(many).toContain("🐍 python");
    expect(many).toContain("↹ next suggestion");
  });

  test("states the pin decision on the launch key", () => {
    expect(renderCardFrame({ ...base, suggestions: [rust] })).toContain(
      "⏎ launch · pins to this directory",
    );
    expect(renderCardFrame({ ...base, suggestions: [rust], pin: false })).toContain("⏎ launch · no pin");
    const disabled = renderCardFrame({ ...base, suggestions: [rust], pinDisabled: true });
    expect(disabled).toContain("⏎ launch");
    expect(disabled).not.toContain("pins to this directory");
    expect(disabled).not.toContain("p pin");
  });

  test("warns about a heavy stack, stays quiet about a light one", () => {
    expect(renderCardFrame({ ...base, suggestions: [{ ...rust, alwaysOn: 32_000 }] })).toContain(
      "⚠ heavy: ~32k always-on",
    );
    expect(renderCardFrame({ ...base, suggestions: [rust] })).not.toContain("⚠ heavy");
  });

  test("help overlay replaces the body and lists every key", () => {
    const frame = renderCardFrame({ ...base, suggestions: [rust], help: true });
    for (const key of ["⏎", "e", "/", "a", "p", "?", "esc"]) expect(frame).toContain(key);
    expect(frame).toContain("edit the stack");
    expect(frame).not.toContain("suggested stack");
  });

  test("degrades to a usable frame when there is nothing to suggest", () => {
    const frame = renderCardFrame({ ...base, suggestions: [] });
    expect(frame).toContain("no profiles available");
    expect(frame).toContain("a browse every profile");
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

  test("caps the reason list at three lines", () => {
    const frame = renderCardFrame({
      ...base,
      suggestions: [{ ...rust, reasons: ["one", "two", "three", "four"] }],
    });
    expect(frame).toContain("three");
    expect(frame).not.toContain("four");
  });
});
