/**
 * Tests for `cue watch-live` — auto-rematerialization file watcher.
 *
 * Only the --help path is tested here. The main run() body sets up fs.watch()
 * listeners, then blocks indefinitely awaiting SIGINT via a never-resolving
 * Promise — it cannot be driven to completion in a unit or e2e test without
 * process-level signal injection. No pure helpers are exported from this module.
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

describe.skipIf(!BUN_SPAWNABLE)("cue watch-live", () => {
  test("--help exits 0", () => {
    const { status } = cue(["watch-live", "--help"]);
    expect(status).toBe(0);
  });

  test("--help names the command", () => {
    const { stdout } = cue(["watch-live", "--help"]);
    expect(stdout).toContain("cue watch-live");
  });

  test("--help mentions the --profile flag", () => {
    const { stdout } = cue(["watch-live", "--help"]);
    expect(stdout).toContain("--profile");
  });

  test("--help mentions Ctrl+C to stop", () => {
    const { stdout } = cue(["watch-live", "--help"]);
    expect(stdout).toContain("Ctrl+C");
  });
});
