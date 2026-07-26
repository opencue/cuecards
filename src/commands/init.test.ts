/**
 * Tests for src/commands/init.ts — only the exported pure helper
 * `onboardedMarkerPath()`. The fully interactive path (no `--profile`, no
 * `--yes`) is still skipped here: it drives @clack/prompts interactively and
 * has no hermetically testable surface. The non-interactive `--profile`/
 * `--yes` path DOES have one now — see `init-noninteractive.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { homedir } from "node:os";

import { onboardedMarkerPath } from "./init";

describe("onboardedMarkerPath", () => {
  let savedXDG: string | undefined;

  beforeEach(() => {
    savedXDG = process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    if (savedXDG === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedXDG;
    }
  });

  test("uses XDG_CONFIG_HOME when set to a non-empty path", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-test-cue";
    expect(onboardedMarkerPath()).toBe("/tmp/xdg-test-cue/cue/.onboarded");
  });

  test("falls back to ~/.config/cue/.onboarded when XDG_CONFIG_HOME is unset", () => {
    delete process.env.XDG_CONFIG_HOME;
    const expected = join(homedir(), ".config", "cue", ".onboarded");
    expect(onboardedMarkerPath()).toBe(expected);
  });

  test("treats empty XDG_CONFIG_HOME the same as unset (fallback to homedir)", () => {
    process.env.XDG_CONFIG_HOME = "";
    const expected = join(homedir(), ".config", "cue", ".onboarded");
    expect(onboardedMarkerPath()).toBe(expected);
  });

  test("always ends with the literal segment .onboarded", () => {
    delete process.env.XDG_CONFIG_HOME;
    expect(onboardedMarkerPath().endsWith(".onboarded")).toBe(true);
  });

  test("always contains the literal segment cue in the path", () => {
    delete process.env.XDG_CONFIG_HOME;
    // configDir() appends /cue to the XDG base — verify it's there
    const parts = onboardedMarkerPath().split("/");
    expect(parts).toContain("cue");
  });

  test("returns a stable value across repeated calls with the same env", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-stable";
    const a = onboardedMarkerPath();
    const b = onboardedMarkerPath();
    expect(a).toBe(b);
  });

  test("different XDG values produce different paths", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-a";
    const pathA = onboardedMarkerPath();

    process.env.XDG_CONFIG_HOME = "/tmp/xdg-b";
    const pathB = onboardedMarkerPath();

    expect(pathA).not.toBe(pathB);
    expect(pathA).toContain("xdg-a");
    expect(pathB).toContain("xdg-b");
  });
});
