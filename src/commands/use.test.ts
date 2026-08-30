/**
 * Tests for `cue use <profile>` — pin a profile to the current directory.
 *
 * Tests cover the error paths that don't touch the filesystem:
 *   • No selector → usage error (reads profile list, exits before writing)
 *   • Unknown profile → "not found" error (validates selector, exits before writing)
 *
 * The pin-write path (happy path with a real profile + no-profiles-dir) is not
 * tested here because it would write .cue.profile into a directory; that surface
 * is exercised by src/lib/profile-loader.test.ts through the underlying loader.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CUE_BIN = join(import.meta.dir, "../index.ts");

const BUN_SPAWNABLE = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;

function cue(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("bun", ["run", CUE_BIN, ...args], {
    encoding: "utf8",
    timeout: 15000,
  });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe.skipIf(!BUN_SPAWNABLE)("cue use", () => {
  test("no selector exits 1", () => {
    const { status } = cue(["use"]);
    expect(status).toBe(1);
  });

  test("no selector prints usage to stderr", () => {
    const { stderr } = cue(["use"]);
    expect(stderr).toContain("Usage:");
    expect(stderr).toContain("cue use");
  });

  test("no selector points to the concise profile catalogue", () => {
    const { stderr } = cue(["use"]);
    expect(stderr).toContain("cue list");
    expect(stderr).not.toContain("Available:");
  });

  test("unknown profile exits 1", () => {
    const { status } = cue(["use", "xyz-nonexistent-profile-abc"]);
    expect(status).toBe(1);
  });

  test("unknown profile prints 'not found' to stderr", () => {
    const { stderr } = cue(["use", "xyz-nonexistent-profile-abc"]);
    expect(stderr).toContain("not found");
    expect(stderr).toContain("xyz-nonexistent-profile-abc");
  });

  test("unknown profile points to discovery without dumping every profile", () => {
    const { stderr } = cue(["use", "xyz-nonexistent-profile-abc"]);
    expect(stderr).toContain("cue list --all");
    expect(stderr).not.toContain("Available:");
  });
});
