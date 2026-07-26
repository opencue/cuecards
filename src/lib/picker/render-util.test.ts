import { describe, test, expect } from "bun:test";
import {
  asciiIconsEnabled,
  clipToWidth,
  displayWidth,
  stripIconIfAscii,
  windowOptions,
} from "./render-util";

describe("asciiIconsEnabled", () => {
  test("returns false when no relevant env vars are set", () => {
    expect(asciiIconsEnabled({})).toBe(false);
  });

  test("CUE_ASCII_ICONS=1 enables ASCII mode", () => {
    expect(asciiIconsEnabled({ CUE_ASCII_ICONS: "1" })).toBe(true);
  });

  test("CUE_ASCII_ICONS=true enables ASCII mode", () => {
    expect(asciiIconsEnabled({ CUE_ASCII_ICONS: "true" })).toBe(true);
  });

  test("CUE_ASCII_ICONS=yes enables ASCII mode", () => {
    expect(asciiIconsEnabled({ CUE_ASCII_ICONS: "yes" })).toBe(true);
  });

  test("CUE_ASCII_ICONS is case-insensitive", () => {
    expect(asciiIconsEnabled({ CUE_ASCII_ICONS: "YES" })).toBe(true);
    expect(asciiIconsEnabled({ CUE_ASCII_ICONS: "True" })).toBe(true);
  });

  test("CUE_ASCII_ICONS=0 does not enable ASCII mode", () => {
    expect(asciiIconsEnabled({ CUE_ASCII_ICONS: "0" })).toBe(false);
  });

  test("non-UTF-8 locale enables ASCII mode", () => {
    expect(asciiIconsEnabled({ LANG: "en_US.ISO-8859-1" })).toBe(true);
  });

  test("UTF-8 locale does not enable ASCII mode", () => {
    expect(asciiIconsEnabled({ LANG: "en_US.UTF-8" })).toBe(false);
  });

  test("utf8 (mixed case) locale does not enable ASCII mode", () => {
    expect(asciiIconsEnabled({ LANG: "en_US.utf8" })).toBe(false);
  });

  test("LC_ALL overrides LANG for locale check", () => {
    expect(asciiIconsEnabled({ LC_ALL: "C", LANG: "en_US.UTF-8" })).toBe(true);
  });

  test("empty locale string is treated as not-set (no ASCII mode)", () => {
    // An empty locale means we can't conclude non-UTF-8
    expect(asciiIconsEnabled({ LANG: "" })).toBe(false);
  });
});

describe("stripIconIfAscii", () => {
  test("ascii=false: returns label unchanged", () => {
    expect(stripIconIfAscii("🔺 vercel", false)).toBe("🔺 vercel");
  });

  test("ascii=true: strips leading emoji", () => {
    expect(stripIconIfAscii("🔺 vercel", true)).toBe("vercel");
  });

  test("ascii=true: strips leading multi-codepoint emoji (ZWJ sequence)", () => {
    // 🌟 followed by space
    expect(stripIconIfAscii("⚡ vite", true)).toBe("vite");
  });

  test("ascii=true: pure ASCII label is returned unchanged", () => {
    expect(stripIconIfAscii("backend", true)).toBe("backend");
  });

  test("ascii=true: entirely non-ASCII label is returned unchanged (CJK)", () => {
    const cjk = "日本語プロファイル";
    expect(stripIconIfAscii(cjk, true)).toBe(cjk);
  });

  test("ascii=true: strips multiple leading emoji glyphs", () => {
    expect(stripIconIfAscii("🟢✨ label", true)).toBe("label");
  });
});

describe("displayWidth", () => {
  test("empty string → 0", () => {
    expect(displayWidth("")).toBe(0);
  });

  test("ASCII string → length in chars", () => {
    expect(displayWidth("hello")).toBe(5);
  });

  test("single emoji → 2 cells", () => {
    expect(displayWidth("🔺")).toBe(2);
  });

  test("CJK character → 2 cells", () => {
    expect(displayWidth("日")).toBe(2);
  });

  test("mixed ASCII and emoji", () => {
    // "hi🔺" = 2 + 2 = 4
    expect(displayWidth("hi🔺")).toBe(4);
  });

  test("ZWJ zero-width joiner contributes 0", () => {
    // ZWJ character alone
    expect(displayWidth("‍")).toBe(0);
  });

  test("variation selector contributes 0", () => {
    expect(displayWidth("️")).toBe(0);
  });

  test("skin-tone modifier contributes 0", () => {
    expect(displayWidth("\u{1F3FB}")).toBe(0);
  });
});

describe("clipToWidth", () => {
  test("string that fits is returned as-is", () => {
    expect(clipToWidth("hello", 10)).toBe("hello");
  });

  test("string that exactly fits is returned as-is", () => {
    expect(clipToWidth("hello", 5)).toBe("hello");
  });

  test("string too long is clipped with ellipsis", () => {
    const result = clipToWidth("hello world", 7);
    expect(result.endsWith("…")).toBe(true);
    expect(displayWidth(result)).toBeLessThanOrEqual(7);
  });

  test("max=0 returns empty string", () => {
    expect(clipToWidth("hello", 0)).toBe("");
  });

  test("emoji label clips at correct cell boundary", () => {
    // "🔺abc" is 2+1+1+1=5 cells; clip to 4 should produce "🔺ab…"
    const result = clipToWidth("🔺abc", 4);
    expect(result.endsWith("…")).toBe(true);
    expect(displayWidth(result)).toBeLessThanOrEqual(4);
  });

  test("max=1 returns only ellipsis character", () => {
    const result = clipToWidth("hello", 1);
    expect(result).toBe("…");
  });
});

describe("windowOptions", () => {
  const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  test("returns all items when count <= max", () => {
    const r = windowOptions(items, 5, 20);
    expect(r.items).toEqual(items);
    expect(r.hiddenAbove).toBe(0);
    expect(r.hiddenBelow).toBe(0);
    expect(r.start).toBe(0);
  });

  test("returns all items when max = length", () => {
    const r = windowOptions(items, 0, 10);
    expect(r.items).toHaveLength(10);
    expect(r.hiddenAbove).toBe(0);
    expect(r.hiddenBelow).toBe(0);
  });

  test("max=0 returns all items (no window)", () => {
    const r = windowOptions(items, 3, 0);
    expect(r.items).toEqual(items);
    expect(r.hiddenAbove).toBe(0);
    expect(r.hiddenBelow).toBe(0);
  });

  test("centers window on active index", () => {
    // activeIndex=5, max=5 → start=3, items=[3..7]
    const r = windowOptions(items, 5, 5);
    expect(r.items).toEqual([3, 4, 5, 6, 7]);
    expect(r.start).toBe(3);
    expect(r.hiddenAbove).toBe(3);
    expect(r.hiddenBelow).toBe(2);
  });

  test("pins to start when active is near beginning", () => {
    const r = windowOptions(items, 1, 5);
    expect(r.items).toEqual([0, 1, 2, 3, 4]);
    expect(r.start).toBe(0);
    expect(r.hiddenAbove).toBe(0);
    expect(r.hiddenBelow).toBe(5);
  });

  test("pins to end when active is near the end", () => {
    const r = windowOptions(items, 9, 5);
    expect(r.items).toEqual([5, 6, 7, 8, 9]);
    expect(r.start).toBe(5);
    expect(r.hiddenAbove).toBe(5);
    expect(r.hiddenBelow).toBe(0);
  });

  test("window has exactly max items", () => {
    const r = windowOptions(items, 5, 3);
    expect(r.items).toHaveLength(3);
  });

  test("hiddenAbove + window + hiddenBelow = total items", () => {
    const r = windowOptions(items, 5, 4);
    expect(r.hiddenAbove + r.items.length + r.hiddenBelow).toBe(items.length);
  });
});
