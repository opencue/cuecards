import { describe, test, expect } from "bun:test";
import { decodeKey } from "./input";

describe("decodeKey", () => {
  // ── Single control characters ───────────────────────────────────────────
  test("ctrl-c (\\x03)", () => {
    expect(decodeKey("\x03")).toEqual([{ type: "ctrl-c" }]);
  });

  test("enter from \\r", () => {
    expect(decodeKey("\r")).toEqual([{ type: "enter" }]);
  });

  test("enter from \\n", () => {
    expect(decodeKey("\n")).toEqual([{ type: "enter" }]);
  });

  test("tab (\\t)", () => {
    expect(decodeKey("\t")).toEqual([{ type: "tab" }]);
  });

  test("slash", () => {
    expect(decodeKey("/")).toEqual([{ type: "slash" }]);
  });

  test("q lowercase → q event", () => {
    expect(decodeKey("q")).toEqual([{ type: "q" }]);
  });

  test("Q uppercase → q event", () => {
    expect(decodeKey("Q")).toEqual([{ type: "q" }]);
  });

  // ── Arrow keys via CSI bracket ──────────────────────────────────────────
  test("ESC [ A → up", () => {
    expect(decodeKey("\x1b[A")).toEqual([{ type: "up" }]);
  });

  test("ESC [ B → down", () => {
    expect(decodeKey("\x1b[B")).toEqual([{ type: "down" }]);
  });

  test("ESC [ C → right", () => {
    expect(decodeKey("\x1b[C")).toEqual([{ type: "right" }]);
  });

  test("ESC [ D → left", () => {
    expect(decodeKey("\x1b[D")).toEqual([{ type: "left" }]);
  });

  // ── Arrow keys via SS3 (O prefix) ──────────────────────────────────────
  test("ESC O A → up (SS3 variant)", () => {
    expect(decodeKey("\x1bOA")).toEqual([{ type: "up" }]);
  });

  test("ESC O B → down (SS3 variant)", () => {
    expect(decodeKey("\x1bOB")).toEqual([{ type: "down" }]);
  });

  // ── Home / End ──────────────────────────────────────────────────────────
  test("ESC [ H → home", () => {
    expect(decodeKey("\x1b[H")).toEqual([{ type: "home" }]);
  });

  test("ESC [ F → end", () => {
    expect(decodeKey("\x1b[F")).toEqual([{ type: "end" }]);
  });

  // ── Page-up / Page-down ─────────────────────────────────────────────────
  test("ESC [ 5 ~ → page-up", () => {
    expect(decodeKey("\x1b[5~")).toEqual([{ type: "page-up" }]);
  });

  test("ESC [ 6 ~ → page-down", () => {
    expect(decodeKey("\x1b[6~")).toEqual([{ type: "page-down" }]);
  });

  // ── Bare ESC and unknown sequences ──────────────────────────────────────
  test("bare ESC alone → esc event", () => {
    expect(decodeKey("\x1b")).toEqual([{ type: "esc" }]);
  });

  test("ESC followed by non-bracket char → esc only (next char is consumed)", () => {
    // When ESC is followed by something other than '[' or 'O', the decoder
    // advances by 2 (consuming both ESC and the next byte) and emits one esc
    // event. The following char is NOT emitted separately.
    const result = decodeKey("\x1bZ");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "esc" });
  });

  test("ESC [ with unrecognized third char → esc + remaining char", () => {
    // \x1b[ is a CSI introducer; decoder advances 2 (past ESC[) and emits esc,
    // leaving the 3rd char to be decoded as a plain char.
    const result = decodeKey("\x1b[X");
    expect(result[0]).toEqual({ type: "esc" });
    expect(result[1]).toEqual({ type: "char", value: "X" });
  });

  // ── Regular characters ───────────────────────────────────────────────────
  test("regular lowercase letter", () => {
    expect(decodeKey("a")).toEqual([{ type: "char", value: "a" }]);
  });

  test("regular uppercase letter", () => {
    expect(decodeKey("A")).toEqual([{ type: "char", value: "A" }]);
  });

  test("digit", () => {
    expect(decodeKey("3")).toEqual([{ type: "char", value: "3" }]);
  });

  test("space", () => {
    expect(decodeKey(" ")).toEqual([{ type: "char", value: " " }]);
  });

  // ── Multiple keys in one chunk ───────────────────────────────────────────
  test("multiple plain chars in one chunk", () => {
    expect(decodeKey("abc")).toEqual([
      { type: "char", value: "a" },
      { type: "char", value: "b" },
      { type: "char", value: "c" },
    ]);
  });

  test("arrow key followed by a plain char", () => {
    expect(decodeKey("\x1b[Aq")).toEqual([{ type: "up" }, { type: "q" }]);
  });

  test("page-up followed by enter", () => {
    expect(decodeKey("\x1b[5~\r")).toEqual([{ type: "page-up" }, { type: "enter" }]);
  });

  test("ctrl-c in the middle of a buffer terminates only its byte", () => {
    expect(decodeKey("a\x03b")).toEqual([
      { type: "char", value: "a" },
      { type: "ctrl-c" },
      { type: "char", value: "b" },
    ]);
  });

  // ── Buffer input ─────────────────────────────────────────────────────────
  test("Buffer containing 'q' → q event", () => {
    expect(decodeKey(Buffer.from("q"))).toEqual([{ type: "q" }]);
  });

  test("Buffer containing arrow-up bytes", () => {
    expect(decodeKey(Buffer.from("\x1b[A", "utf8"))).toEqual([{ type: "up" }]);
  });

  // ── Edge cases ───────────────────────────────────────────────────────────
  test("empty string → empty array", () => {
    expect(decodeKey("")).toEqual([]);
  });

  test("empty Buffer → empty array", () => {
    expect(decodeKey(Buffer.alloc(0))).toEqual([]);
  });
});
