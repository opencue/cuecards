/**
 * E2e tests for `cue clean`.
 *
 * Uses spawnSync so the child process loads the module fresh with controlled
 * env vars (RUNTIME_ROOT is a module-level const that captures XDG_CONFIG_HOME
 * at load time — unit-test env mutation cannot affect it).
 */

import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CUE_BIN = join(import.meta.dir, "../index.ts");

const BUN_SPAWNABLE = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;

function cue(
  args: string[],
  extraEnv: Record<string, string> = {},
): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("bun", ["run", CUE_BIN, ...args], {
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, ...extraEnv },
  });
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

describe.skipIf(!BUN_SPAWNABLE)("cue clean", () => {
  // ---------------------------------------------------------------------------
  // --help flag
  // ---------------------------------------------------------------------------

  test("--help exits 0", () => {
    const res = cue(["clean", "--help"]);
    expect(res.status).toBe(0);
  });

  test("--help outputs cue clean in the usage text", () => {
    const res = cue(["clean", "--help"]);
    expect(res.stdout).toContain("cue clean");
  });

  test("--help mentions --force flag", () => {
    const res = cue(["clean", "--help"]);
    expect(res.stdout).toContain("--force");
  });

  test("--help mentions dry run behavior", () => {
    const res = cue(["clean", "--help"]);
    // The help text describes running without --force as a dry run
    expect(res.stdout.toLowerCase()).toMatch(/dry.?run/);
  });

  // ---------------------------------------------------------------------------
  // Dry-run with empty dirs: nothing to clean
  // ---------------------------------------------------------------------------

  test("dry-run with empty config and profiles dirs reports nothing to clean", () => {
    const tmpXDG = mkdtempSync(join(tmpdir(), "cue-clean-xdg-"));
    const tmpProfiles = mkdtempSync(join(tmpdir(), "cue-clean-profiles-"));
    try {
      const res = cue(["clean"], {
        XDG_CONFIG_HOME: tmpXDG,
        CUE_PROFILES_DIR: tmpProfiles,
      });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Nothing to clean");
    } finally {
      rmSync(tmpXDG, { recursive: true, force: true });
      rmSync(tmpProfiles, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // Stale runtime detection (dry-run, no actual deletion)
  // ---------------------------------------------------------------------------

  test("dry-run with a stale runtime dir reports it as reclaimable", () => {
    const tmpXDG = mkdtempSync(join(tmpdir(), "cue-clean-xdg-"));
    const tmpProfiles = mkdtempSync(join(tmpdir(), "cue-clean-profiles-"));
    try {
      // Create a runtime dir for "orphaned-profile" which does NOT exist in
      // the (empty) profiles dir, so it counts as stale.
      const runtimeDir = join(tmpXDG, "cue", "runtime", "orphaned-profile");
      mkdirSync(runtimeDir, { recursive: true });

      const res = cue(["clean"], {
        XDG_CONFIG_HOME: tmpXDG,
        CUE_PROFILES_DIR: tmpProfiles,
      });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("orphaned-profile");
      // Dry-run should NOT actually delete the directory
      const { existsSync } = require("node:fs");
      expect(existsSync(runtimeDir)).toBe(true);
    } finally {
      rmSync(tmpXDG, { recursive: true, force: true });
      rmSync(tmpProfiles, { recursive: true, force: true });
    }
  });

  test("dry-run output includes reclaimable size summary", () => {
    const tmpXDG = mkdtempSync(join(tmpdir(), "cue-clean-xdg-"));
    const tmpProfiles = mkdtempSync(join(tmpdir(), "cue-clean-profiles-"));
    try {
      mkdirSync(join(tmpXDG, "cue", "runtime", "stale-x"), { recursive: true });

      const res = cue(["clean"], {
        XDG_CONFIG_HOME: tmpXDG,
        CUE_PROFILES_DIR: tmpProfiles,
      });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("reclaimable");
    } finally {
      rmSync(tmpXDG, { recursive: true, force: true });
      rmSync(tmpProfiles, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // --force: actually deletes stale entries
  // ---------------------------------------------------------------------------

  test("--force deletes a stale runtime directory", () => {
    const tmpXDG = mkdtempSync(join(tmpdir(), "cue-clean-xdg-"));
    const tmpProfiles = mkdtempSync(join(tmpdir(), "cue-clean-profiles-"));
    try {
      const runtimeDir = join(tmpXDG, "cue", "runtime", "stale-y");
      mkdirSync(runtimeDir, { recursive: true });

      const res = cue(["clean", "--force"], {
        XDG_CONFIG_HOME: tmpXDG,
        CUE_PROFILES_DIR: tmpProfiles,
      });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Cleaned");

      const { existsSync } = require("node:fs");
      expect(existsSync(runtimeDir)).toBe(false);
    } finally {
      rmSync(tmpXDG, { recursive: true, force: true });
      rmSync(tmpProfiles, { recursive: true, force: true });
    }
  });

  test("--force with a known profile does not delete it as stale", () => {
    const tmpXDG = mkdtempSync(join(tmpdir(), "cue-clean-xdg-"));
    const tmpProfiles = mkdtempSync(join(tmpdir(), "cue-clean-profiles-"));
    try {
      // Create a profile.yaml so it appears in the profiles dir
      const profileDir = join(tmpProfiles, "live-profile");
      mkdirSync(profileDir, { recursive: true });
      require("node:fs").writeFileSync(
        join(profileDir, "profile.yaml"),
        "name: live-profile\ndescription: kept\n",
      );
      // Create matching runtime dir
      const runtimeDir = join(tmpXDG, "cue", "runtime", "live-profile");
      mkdirSync(runtimeDir, { recursive: true });

      cue(["clean", "--force"], {
        XDG_CONFIG_HOME: tmpXDG,
        CUE_PROFILES_DIR: tmpProfiles,
      });

      // Profile is still known → its runtime must NOT have been deleted
      const { existsSync } = require("node:fs");
      expect(existsSync(runtimeDir)).toBe(true);
    } finally {
      rmSync(tmpXDG, { recursive: true, force: true });
      rmSync(tmpProfiles, { recursive: true, force: true });
    }
  });
});
