/**
 * Guard: every profile name referenced by the auto-detect signals and the
 * discover/ai keyword maps must correspond to a real profile directory under
 * profiles/.
 *
 * Phantom names used to slip in and silently no-op: `launch.ts` filters
 * detections down to known profile names (so a phantom suggestion is dropped
 * with no feedback), and `cue discover install` skips writing skills into a
 * profile.yaml that doesn't exist. This test fails fast if any suggestion ever
 * points at a profile that isn't on disk — it caught `python-api`, `rust-cli`,
 * `ecc`, and a bare `medusa` when it was written.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { DEP_PROFILE_RULES } from "./auto-detect";
import { STACK_PROFILES, PROFILE_KEYWORDS as DISCOVER_KEYWORDS } from "../commands/discover";
import { PROFILE_KEYWORDS as AI_KEYWORDS } from "../commands/ai";

const PROFILES_DIR = resolve(import.meta.dir, "../../profiles");

function realProfiles(): Set<string> {
  return new Set(
    readdirSync(PROFILES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
      .map((e) => e.name)
      .filter((name) => existsSync(join(PROFILES_DIR, name, "profile.yaml"))),
  );
}

describe("profile-name references resolve to real profiles", () => {
  const real = realProfiles();

  test("profiles/ fixture is populated", () => {
    expect(real.size).toBeGreaterThan(10);
  });

  test("auto-detect DEP_PROFILE_RULES reference only real profiles", () => {
    const missing = [...new Set(DEP_PROFILE_RULES.map((r) => r.profile))].filter((p) => !real.has(p));
    expect(missing).toEqual([]);
  });

  test("discover STACK_PROFILES reference only real profiles", () => {
    const missing = [...STACK_PROFILES].filter((p) => !real.has(p));
    expect(missing).toEqual([]);
  });

  test("discover PROFILE_KEYWORDS keys are real profiles", () => {
    const missing = Object.keys(DISCOVER_KEYWORDS).filter((p) => !real.has(p));
    expect(missing).toEqual([]);
  });

  test("ai PROFILE_KEYWORDS keys are real profiles", () => {
    const missing = Object.keys(AI_KEYWORDS).filter((p) => !real.has(p));
    expect(missing).toEqual([]);
  });
});
