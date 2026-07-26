/**
 * Tests for `cue validate` — profile schema & lint checks.
 *
 * Tests focus on argument-parsing behaviour (no profile loading, no linting):
 *   • Help flags exit 0 with usage text
 *   • Missing selector exits 1 with a diagnostic message
 *   • Conflicting flags (--all + <profile>) exit 1
 *
 * Full lint execution (--all, --profile <name>) is NOT exercised here because
 * it spawns `npx skills add` probes per skill, which is network-gated and
 * takes minutes; those are integration-test concerns.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CUE_BIN = join(import.meta.dir, "../index.ts");

const BUN_SPAWNABLE = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;

function cue(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("bun", ["run", CUE_BIN, ...args], {
    encoding: "utf8",
    timeout: 10000,
  });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe.skipIf(!BUN_SPAWNABLE)("cue validate", () => {
  describe("help flags", () => {
    test("--help exits 0", () => {
      const { status } = cue(["validate", "--help"]);
      expect(status).toBe(0);
    });

    test("--help prints Usage", () => {
      const { stdout } = cue(["validate", "--help"]);
      expect(stdout).toContain("Usage:");
    });

    test("--help documents cue validate <profile> form", () => {
      const { stdout } = cue(["validate", "--help"]);
      expect(stdout).toContain("cue validate");
    });

    test("--help documents --all flag", () => {
      const { stdout } = cue(["validate", "--help"]);
      expect(stdout).toContain("--all");
    });

    test("-h is accepted as shorthand for --help", () => {
      const { status, stdout } = cue(["validate", "-h"]);
      expect(status).toBe(0);
      expect(stdout).toContain("Usage:");
    });
  });

  describe("argument errors", () => {
    test("no arguments exits 1", () => {
      const { status } = cue(["validate"]);
      expect(status).toBe(1);
    });

    test("no arguments prints diagnostic mentioning missing profile or --all", () => {
      const { stderr } = cue(["validate"]);
      expect(stderr).toContain("missing");
    });

    test("--all and a profile name together exit 1 with conflict diagnostic", () => {
      const { status } = cue(["validate", "--all", "core"]);
      expect(status).toBe(1);
    });

    test("conflict message says 'use either'", () => {
      const { stderr } = cue(["validate", "--all", "core"]);
      expect(stderr).toContain("use either");
    });
  });
});
