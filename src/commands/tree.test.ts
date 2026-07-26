/**
 * Tests for `cue tree`.
 *
 * Uses the real profiles directory (same approach as debug.test.ts) since
 * the profiles are checked in.  CUE_DISABLE_KITTY_IMAGES=1 prevents the
 * kitty terminal probe (TTY check already guards against it in non-TTY test
 * runners, but the env var makes the skip immediate and unconditional).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { run } from "./tree";

let savedKitty: string | undefined;

beforeEach(() => {
  savedKitty = process.env.CUE_DISABLE_KITTY_IMAGES;
  process.env.CUE_DISABLE_KITTY_IMAGES = "1";
  // Ensure the profile loader uses the repo's own profiles directory.
  delete process.env.CUE_PROFILES_DIR;
  delete process.env.SOUL_PROFILES_DIR;
});

afterEach(() => {
  if (savedKitty === undefined) {
    delete process.env.CUE_DISABLE_KITTY_IMAGES;
  } else {
    process.env.CUE_DISABLE_KITTY_IMAGES = savedKitty;
  }
});

function captureStdout(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const orig = process.stdout.write.bind(process.stdout);
  let out = "";
  (process.stdout as any).write = (chunk: string | Uint8Array) => {
    out += String(chunk);
    return true;
  };
  return fn()
    .then((code) => ({ code, out }))
    .finally(() => {
      (process.stdout as any).write = orig;
    });
}

describe("cue tree --json", () => {
  test("core profile: returns 0 and valid JSON", async () => {
    const { code, out } = await captureStdout(() => run(["--json", "core"]));
    expect(code).toBe(0);
    const data = JSON.parse(out);
    expect(data.profile).toBe("core");
    expect(Array.isArray(data.chain)).toBe(true);
    expect(data.chain).toContain("core");
    expect(Array.isArray(data.skills)).toBe(true);
    expect(Array.isArray(data.mcps)).toBe(true);
    expect(Array.isArray(data.plugins)).toBe(true);
  });

  test("gstack profile: inherits from core and has it in the chain", async () => {
    const { code, out } = await captureStdout(() => run(["--json", "gstack"]));
    expect(code).toBe(0);
    const data = JSON.parse(out);
    expect(data.profile).toBe("gstack");
    expect(data.chain).toContain("core");
    // gstack adds skills on top of core
    expect(data.skills.length).toBeGreaterThan(0);
  });

  test("core profile: chain length is 1 (no parent)", async () => {
    const { code, out } = await captureStdout(() => run(["--json", "core"]));
    expect(code).toBe(0);
    const data = JSON.parse(out);
    // core is the root profile — its chain is just itself
    expect(data.chain).toEqual(["core"]);
  });
});
