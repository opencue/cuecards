/**
 * E2e tests for the cue CLI entrypoint (src/index.ts).
 *
 * Tests dispatch, global flags, version printing, and the similarity-based
 * "Did you mean?" suggestion when an unknown command is entered.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CUE_BIN = join(import.meta.dir, "index.ts");

// Skip when bun is not on PATH (some CI sandboxes).
const BUN_SPAWNABLE =
  spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;

function cue(
  args: string[],
): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("bun", ["run", CUE_BIN, ...args], {
    encoding: "utf8",
    timeout: 15000,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      // Exclude ambient CUE env vars so tests behave as on a fresh checkout.
    },
  });
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

describe.skipIf(!BUN_SPAWNABLE)("global flags", () => {
  test("--help exits 0 and prints command groups", () => {
    const res = cue(["--help"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("cue");
    expect(res.stdout).toContain("Usage:");
  });

  test("-h is an alias for --help", () => {
    const res = cue(["-h"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("cue");
  });

  test("help subcommand works the same as --help", () => {
    const res = cue(["help"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("cue");
  });

  test("--help --all is generated from the full command registry", () => {
    const res = cue(["--help", "--all"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("All commands");
    expect(res.stdout).toContain("lint-skill");
    expect(res.stdout).toContain("eval-behavior");
  });

  test("setup --help is side-effect-free and does not start onboarding", () => {
    const res = cue(["setup", "--help"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Usage: cue setup");
    expect(res.stdout).not.toContain("Which profile for this directory?");
    expect(res.stdout).not.toContain("Detected:");
  });

  test("use --help prints focused usage without dumping the profile catalogue", () => {
    const res = cue(["use", "--help"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Usage: cue use");
    expect(res.stderr).not.toContain("Available:");
  });

  test("--version exits 0 and prints a semver string", () => {
    const res = cue(["--version"]);
    expect(res.status).toBe(0);
    // Must look like x.y.z (package version from package.json).
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("-v is an alias for --version", () => {
    const res = cue(["-v"]);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("version subcommand prints the same version as --version", () => {
    const v1 = cue(["--version"]).stdout.trim();
    const v2 = cue(["version"]).stdout.trim();
    expect(v2).toBe(v1);
  });
});

describe.skipIf(!BUN_SPAWNABLE)("unknown command handling", () => {
  test("exits 1 for a completely unknown command", () => {
    const res = cue(["totally-unknown-command-xyz"]);
    expect(res.status).toBe(1);
  });

  test("stderr contains 'unknown command' for an unrecognised subcommand", () => {
    const res = cue(["totally-unknown-command-xyz"]);
    expect(res.stderr).toContain("unknown command");
  });

  test("stderr names the unrecognised command", () => {
    const res = cue(["totally-unknown-command-xyz"]);
    expect(res.stderr).toContain("totally-unknown-command-xyz");
  });

  test("suggests similar commands when a close typo is entered ('lis' → 'list')", () => {
    // "lis" is a substring of "list" → similarity() returns 0.8, above the 0.3 threshold.
    const res = cue(["lis"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("list");
  });

  test("does not suggest anything for a completely dissimilar input", () => {
    const res = cue(["zzzzzzzzz"]);
    expect(res.status).toBe(1);
    // "Did you mean?" section should be absent when no command scores above 0.3.
    expect(res.stderr).not.toContain("Did you mean");
  });
});

describe.skipIf(!BUN_SPAWNABLE)("large machine-readable output", () => {
  test("list --json flushes the complete catalogue before exit", () => {
    const res = cue(["list", "--json"]);
    expect(res.status).toBe(0);
    const rows = JSON.parse(res.stdout) as Array<{ name: string }>;
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.some((row) => row.name === "aas-backend-auth")).toBe(true);

    // A direct spawn can drain stdout quickly enough to hide process.exit()
    // truncation. A real shell pipeline applies backpressure and used to stop
    // at Bun's 8192-byte buffer boundary.
    const piped = spawnSync(
      "bash",
      ["-lc", `bun run ${JSON.stringify(CUE_BIN)} list --json | wc -c`],
      { encoding: "utf8", timeout: 15000 },
    );
    expect(piped.status).toBe(0);
    expect(Number(piped.stdout.trim())).toBeGreaterThan(8192);
  });
});
