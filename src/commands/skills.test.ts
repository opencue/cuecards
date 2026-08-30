/**
 * Tests for src/commands/skills.ts
 *
 * Only `run` is exported from this file, so we drive it via spawnSync (same
 * pattern as ai-score.e2e.test.ts).  We exercise only hermetic code paths
 * where guard clauses fire before any filesystem or network I/O:
 *
 *   - --help / -h   writes help text, exits 0
 *   - changelog     guard clause: empty id → stderr usage, exits 1
 *   - why           guard clause: empty id → stderr usage, exits 1
 *   - rate           guard clause: no args / bad vote → stderr usage, exits 1
 *   - update        guard clause: no target + no --all → stdout usage, exits 0
 *
 * We skip process-interactive paths (add, rank, triggers) that shell out to
 * npx or read ~/.claude / ~/.config/cue — those would be flaky by nature.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CUE_BIN = join(import.meta.dir, "../index.ts");

// Guard: skip the whole suite if bun can't be spawned.  CI installs bun; some
// sandboxes / containers may not.
const BUN_SPAWNABLE = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;

function cue(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("bun", ["run", CUE_BIN, ...args], {
    encoding: "utf8",
    timeout: 20_000,
    // Strip any pinned profile so the subprocess has a clean slate.
    // Guard clauses under test fire before profile resolution, so this is
    // belt-and-suspenders isolation rather than a hard dependency.
    env: { ...process.env, CUE_PROFILE: "" },
  });
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

describe.skipIf(!BUN_SPAWNABLE)("cue skills", () => {
  // ---------------------------------------------------------------------------
  // --help / -h
  // ---------------------------------------------------------------------------

  describe("help flag", () => {
    test("--help prints the subcommand table and exits 0", () => {
      const res = cue(["skills", "--help"]);
      expect(res.status).toBe(0);
      // The command name and at least three listed subcommands must appear.
      expect(res.stdout).toContain("cue skills");
      expect(res.stdout).toContain("list");
      expect(res.stdout).toContain("search");
      expect(res.stdout).toContain("add-to-profile");
    });

    test("-h is a synonym for --help", () => {
      const res = cue(["skills", "-h"]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("cue skills");
    });
  });

  // ---------------------------------------------------------------------------
  // Guard clauses — fire before any I/O
  // ---------------------------------------------------------------------------

  describe("guard clauses", () => {
    test("changelog without <id> writes usage to stderr and exits 1", () => {
      const res = cue(["skills", "changelog"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Usage");
      expect(res.stderr).toContain("changelog");
    });

    test("why without <id> writes usage to stderr and exits 1", () => {
      const res = cue(["skills", "why"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Usage");
      expect(res.stderr).toContain("why");
    });

    test("rate with no arguments writes usage to stderr and exits 1", () => {
      const res = cue(["skills", "rate"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Usage");
    });

    test("rate with an invalid vote (not up|down) writes usage to stderr and exits 1", () => {
      // id is non-empty so the guard path must be triggered by the bad vote.
      const res = cue(["skills", "rate", "meta/some-skill", "sideways"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Usage");
    });

    test("update with no arguments writes usage to stdout and exits 0", () => {
      // cmdUpdate early-returns with the usage block when neither a skill-id
      // nor --all is supplied — no filesystem access occurs.
      const res = cue(["skills", "update"]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("cue skills update");
      // The usage block includes an example with a skill-id placeholder.
      expect(res.stdout).toContain("skill-id");
    });
  });
});
