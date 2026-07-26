/**
 * Tests for `cue upgrade` — registry-based skill/profile upgrade check.
 *
 * Only the --help path is tested heretically: the main upgrade flow requires
 * network access (curl to opencue.github.io) and writes to the repo's
 * profiles/_cache directory — both ruled out by the hermetic-test constraint.
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

describe.skipIf(!BUN_SPAWNABLE)("cue upgrade --help", () => {
  test("exits 0", () => {
    const { status } = cue(["upgrade", "--help"]);
    expect(status).toBe(0);
  });

  test("stdout names the command", () => {
    const { stdout } = cue(["upgrade", "--help"]);
    expect(stdout).toContain("cue upgrade");
  });

  test("documents the --apply flag", () => {
    const { stdout } = cue(["upgrade", "--help"]);
    expect(stdout).toContain("--apply");
  });

  test("documents the --sync flag", () => {
    const { stdout } = cue(["upgrade", "--help"]);
    expect(stdout).toContain("--sync");
  });
});
