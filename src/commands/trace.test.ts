/**
 * E2e tests for `cue trace`.
 *
 * The only testable path without hanging is the early-exit when no session
 * file is found.  PROJECTS_DIR is a module-level constant built from
 * homedir(), so we override $HOME in the subprocess environment so that
 * homedir() returns a temp dir that has no .claude/projects tree.
 *
 * The in-process parseLine() helper is the real logic worth testing, but it
 * is not exported.  Exporting it would immediately enable rich unit coverage
 * of all JSON event shapes (tool_use, assistant, human/user).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const CUE_BIN = join(import.meta.dir, "../index.ts");

// Guard: skip when bun cannot be spawned (unusual sandbox / PATH issues).
const BUN_SPAWNABLE =
  spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cue-trace-"));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe.skipIf(!BUN_SPAWNABLE)("cue trace — no-session path", () => {
  test("exits 1 with error message when no .claude/projects dir exists", () => {
    // Set HOME to an empty temp dir so homedir() in the subprocess resolves
    // PROJECTS_DIR to a path that does not exist → findLatestSession() → null
    // → run() writes error and exits 1 immediately (no SIGINT wait).
    const res = spawnSync("bun", ["run", CUE_BIN, "trace"], {
      encoding: "utf8",
      timeout: 8000,
      env: { ...process.env, HOME: tmpDir },
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("No active session found");
  });
});
