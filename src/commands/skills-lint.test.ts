/**
 * E2e tests for `cue skills-lint`.
 *
 * The core lint logic (lintSkill) is a private function and SKILLS_ROOT is a
 * non-injectable module-level constant, so we can't drive it purely as a unit
 * test. Instead we shell out to the real CLI and assert on exit code + output.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CUE_BIN = join(import.meta.dir, "../index.ts");
const BUN_SPAWNABLE = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;

function cue(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("bun", ["run", CUE_BIN, ...args], {
    encoding: "utf8",
    timeout: 20000,
  });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe.skipIf(!BUN_SPAWNABLE)("cue skills-lint", () => {
  test("no args → exit 1 with usage hint on stderr", () => {
    const res = cue(["skills-lint"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Usage:");
    expect(res.stderr).toContain("skills lint");
  });

  test("non-existent skill id with --json → exit 1, JSON array with S0 error", () => {
    const res = cue(["skills-lint", "--json", "zzz-nonexistent/skill-xyzzy-abc123"]);
    expect(res.status).toBe(1);
    const data = JSON.parse(res.stdout) as Array<{
      code: string;
      severity: string;
      skill: string;
      message: string;
    }>;
    expect(Array.isArray(data)).toBe(true);
    const s0 = data.find((i) => i.code === "S0");
    expect(s0).toBeDefined();
    expect(s0!.severity).toBe("error");
    expect(s0!.skill).toBe("zzz-nonexistent/skill-xyzzy-abc123");
    expect(s0!.message).toContain("not found");
  });

  test("--json output is valid JSON starting with an array", () => {
    const res = cue(["skills-lint", "--json", "zzz-nonexistent/skill-abc"]);
    expect(() => JSON.parse(res.stdout)).not.toThrow();
    const parsed = JSON.parse(res.stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });

  test("without --json, non-existent skill prints human-readable output to stdout", () => {
    const res = cue(["skills-lint", "zzz-nonexistent/skill-no-json"]);
    expect(res.status).toBe(1);
    // Human output contains the issue code and skill id
    expect(res.stdout).toContain("S0");
    expect(res.stdout).toContain("zzz-nonexistent/skill-no-json");
  });

  test("each issue in --json output has the required fields", () => {
    const res = cue(["skills-lint", "--json", "zzz-nonexistent/another-skill-xyz"]);
    const data = JSON.parse(res.stdout) as Array<Record<string, unknown>>;
    for (const issue of data) {
      expect(typeof issue.code).toBe("string");
      expect(typeof issue.severity).toBe("string");
      expect(typeof issue.skill).toBe("string");
      expect(typeof issue.message).toBe("string");
    }
  });
});
