/**
 * Tests for `cue workspace` command entrypoint.
 *
 * Uses spawnSync so each case runs in a clean, isolated process with no
 * ambient CUE env vars. Keeps tests hermetic — no real ~/.config/cue reads
 * affect the assertions.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CUE_BIN = join(import.meta.dir, "../index.ts");

// Skip when bun is not on PATH (some CI sandboxes).
const BUN_SPAWNABLE =
  spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;

function cueWorkspace(
  extraArgs: string[],
): { status: number; stdout: string; stderr: string } {
  const res = spawnSync(
    "bun",
    ["run", CUE_BIN, "workspace", ...extraArgs],
    {
      encoding: "utf8",
      timeout: 15000,
      env: {
        // Inherit PATH so bun can be found; strip all cue env vars for hermeticity.
        PATH: process.env.PATH,
        HOME: process.env.HOME,
      },
    },
  );
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

describe.skipIf(!BUN_SPAWNABLE)("cue workspace --help", () => {
  test("returns 0 and prints usage header", () => {
    const res = cueWorkspace(["--help"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("cue workspace");
  });

  test("-h is an alias for --help", () => {
    const res = cueWorkspace(["-h"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("cue workspace");
  });
});

describe.skipIf(!BUN_SPAWNABLE)("cue workspace secrets (no active profile required)", () => {
  test("no-arg form prints secrets usage and exits 0", () => {
    const res = cueWorkspace(["secrets"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("cue workspace secrets");
  });

  test("--help form prints secrets usage and exits 0", () => {
    const res = cueWorkspace(["secrets", "--help"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("cue workspace secrets");
  });

  test("secrets set with missing name/value exits 1 with usage hint", () => {
    const res = cueWorkspace(["secrets", "set"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("set");
  });

  test("secrets get with missing name exits 1 with usage hint", () => {
    const res = cueWorkspace(["secrets", "get"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("get");
  });

  test("secrets delete with missing name exits 1 with usage hint", () => {
    const res = cueWorkspace(["secrets", "delete"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("delete");
  });

  test("secrets unknown-subcommand exits 1 and names the unknown command", () => {
    const res = cueWorkspace(["secrets", "unknowncmd"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("unknowncmd");
  });
});
