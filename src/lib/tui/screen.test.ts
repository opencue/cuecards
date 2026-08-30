import { describe, expect, test } from "bun:test";
import { getSize, isTty, onResize } from "./screen";

describe("getSize", () => {
  test("returns an object with numeric cols and rows", () => {
    const size = getSize();
    expect(typeof size.cols).toBe("number");
    expect(typeof size.rows).toBe("number");
    expect(size.cols).toBeGreaterThan(0);
    expect(size.rows).toBeGreaterThan(0);
  });

  test("falls back to 80 cols and 24 rows when stdout has no dimensions", () => {
    // In a non-TTY test process, stdout.columns / stdout.rows are typically
    // undefined; ?? 80 / ?? 24 should kick in.
    const origCols = process.stdout.columns;
    const origRows = process.stdout.rows;
    try {
      // @ts-expect-error — intentionally clearing to test fallback path
      process.stdout.columns = undefined;
      // @ts-expect-error
      process.stdout.rows = undefined;
      const size = getSize();
      expect(size.cols).toBe(80);
      expect(size.rows).toBe(24);
    } finally {
      // @ts-expect-error
      process.stdout.columns = origCols;
      // @ts-expect-error
      process.stdout.rows = origRows;
    }
  });

  test("uses process.stdout.columns when it is set to a known value", () => {
    const origCols = process.stdout.columns;
    try {
      // @ts-expect-error
      process.stdout.columns = 120;
      expect(getSize().cols).toBe(120);
    } finally {
      // @ts-expect-error
      process.stdout.columns = origCols;
    }
  });
});

describe("isTty", () => {
  test("returns a boolean", () => {
    expect(typeof isTty()).toBe("boolean");
  });

  test("returns false in the test process (no TTY attached)", () => {
    // bun test runs without a TTY, so both isTTY flags should be falsy.
    expect(isTty()).toBe(false);
  });
});

describe("onResize", () => {
  test("returns a cleanup function that removes the listener", () => {
    const before = process.stdout.listenerCount("resize");
    const off = onResize(() => {});
    expect(process.stdout.listenerCount("resize")).toBe(before + 1);
    off();
    expect(process.stdout.listenerCount("resize")).toBe(before);
  });

  test("registered handler is invoked when stdout emits resize", () => {
    let called = false;
    const off = onResize(() => { called = true; });
    try {
      process.stdout.emit("resize");
      expect(called).toBe(true);
    } finally {
      off();
    }
  });

  test("handler is NOT invoked after the cleanup function is called", () => {
    let callCount = 0;
    const off = onResize(() => { callCount++; });
    off();
    process.stdout.emit("resize");
    expect(callCount).toBe(0);
  });
});
