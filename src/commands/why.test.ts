/**
 * Tests for `cue why <resource>` — trace why a skill/MCP/plugin is loaded.
 *
 * The error paths that exit before loading a profile are safe to test
 * hermetically: missing positional argument exits 1 immediately.
 *
 * The happy-path (resource found in active profile) requires a real
 * .cue.profile + profile YAML on disk; that surface is covered by
 * profile-loader integration tests.
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

describe.skipIf(!BUN_SPAWNABLE)("cue why", () => {
  test("no positional argument exits 1", () => {
    const { status } = cue(["why"]);
    expect(status).toBe(1);
  });

  test("no positional argument prints usage to stderr", () => {
    const { stderr } = cue(["why"]);
    expect(stderr).toContain("Usage:");
    expect(stderr).toContain("cue why");
  });

  test("flag-only args without a resource name exit 1 with usage", () => {
    // --json is a flag, not a resource name — run() must return 1
    const { status, stderr } = cue(["why", "--json"]);
    expect(status).toBe(1);
    expect(stderr).toContain("Usage:");
  });
});
