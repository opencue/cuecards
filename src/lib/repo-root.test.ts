import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { profilesDir, repoRoot } from "./repo-root";

// repo-root.ts lives at src/lib/, so the env-free fallback is two levels up —
// the same place this test file resolves to.
const EXPECTED_FALLBACK = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const ENV_KEYS = [
  "CUE_REPO_ROOT",
  "SOUL_REPO_ROOT",
  "CUE_PROFILES_DIR",
  "SOUL_PROFILES_DIR",
] as const;

describe("repo-root lazy getters", () => {
  // Capture + clear the resolution env so each test starts from the
  // fresh-checkout baseline, then restore (cue test env must not leak).
  const prior: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      prior[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  });

  test("repoRoot falls back to the package root when env is unset", () => {
    expect(repoRoot()).toBe(EXPECTED_FALLBACK);
  });

  test("repoRoot honors an in-process CUE_REPO_ROOT override", () => {
    // The whole point of the getter: setting the env AFTER import takes effect.
    // A baked `const` would have ignored this.
    process.env.CUE_REPO_ROOT = "/tmp/other-tree";
    expect(repoRoot()).toBe("/tmp/other-tree");
  });

  test("SOUL_REPO_ROOT is honored as a legacy fallback", () => {
    process.env.SOUL_REPO_ROOT = "/tmp/legacy-tree";
    expect(repoRoot()).toBe("/tmp/legacy-tree");
  });

  test("CUE_REPO_ROOT takes precedence over SOUL_REPO_ROOT", () => {
    process.env.CUE_REPO_ROOT = "/tmp/cue";
    process.env.SOUL_REPO_ROOT = "/tmp/soul";
    expect(repoRoot()).toBe("/tmp/cue");
  });

  test("profilesDir tracks repoRoot live across re-assignment (not baked)", () => {
    process.env.CUE_REPO_ROOT = "/tmp/x";
    expect(profilesDir()).toBe(join("/tmp/x", "profiles"));
    // Re-assign within the same process: a getter reflects it, a const would not.
    process.env.CUE_REPO_ROOT = "/tmp/y";
    expect(profilesDir()).toBe(join("/tmp/y", "profiles"));
  });

  test("CUE_PROFILES_DIR overrides profilesDir directly", () => {
    process.env.CUE_PROFILES_DIR = "/tmp/custom-profiles";
    expect(profilesDir()).toBe("/tmp/custom-profiles");
  });

  test("SOUL_PROFILES_DIR is honored as a legacy fallback for profilesDir", () => {
    process.env.SOUL_PROFILES_DIR = "/tmp/legacy-profiles";
    expect(profilesDir()).toBe("/tmp/legacy-profiles");
  });

  test("CUE_PROFILES_DIR takes precedence over SOUL_PROFILES_DIR", () => {
    process.env.CUE_PROFILES_DIR = "/tmp/cue-profiles";
    process.env.SOUL_PROFILES_DIR = "/tmp/soul-profiles";
    expect(profilesDir()).toBe("/tmp/cue-profiles");
  });
});
