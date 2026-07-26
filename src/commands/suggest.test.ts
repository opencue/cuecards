/**
 * Tests for `cue suggest`.
 *
 * The command's only exported surface is `run()`.  We drive it through the
 * fast paths (--help) and through the "no sessions" path by pointing
 * CUE_SUGGEST_SESSIONS_DIR at an empty temp dir so we never touch
 * ~/.claude/projects.  The profile is always supplied explicitly so that
 * the cwd-based auto-detection (which reads ~/.config/cue) is skipped.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "./suggest";

let tmpDir: string;
let savedSessionsDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cue-suggest-"));
  savedSessionsDir = process.env.CUE_SUGGEST_SESSIONS_DIR;
  // Redirect session scanning away from the real ~/.claude/projects.
  process.env.CUE_SUGGEST_SESSIONS_DIR = tmpDir;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (savedSessionsDir === undefined) {
    delete process.env.CUE_SUGGEST_SESSIONS_DIR;
  } else {
    process.env.CUE_SUGGEST_SESSIONS_DIR = savedSessionsDir;
  }
});

async function captureStdout(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const orig = process.stdout.write.bind(process.stdout);
  let out = "";
  (process.stdout as any).write = (chunk: string | Uint8Array) => {
    out += String(chunk);
    return true;
  };
  try {
    const code = await fn();
    return { code, out };
  } finally {
    (process.stdout as any).write = orig;
  }
}

describe("cue suggest --help", () => {
  test("--help returns 0 and prints usage", async () => {
    const { code, out } = await captureStdout(() => run(["--help"]));
    expect(code).toBe(0);
    expect(out).toContain("cue suggest");
    expect(out).toContain("--days");
    expect(out).toContain("--profile");
  });

  test("-h is an alias for --help", async () => {
    const { code, out } = await captureStdout(() => run(["-h"]));
    expect(code).toBe(0);
    expect(out).toContain("cue suggest");
  });
});

describe("cue suggest with explicit profile and empty sessions", () => {
  test("reports no transcripts when sessions dir is empty (default days)", async () => {
    // tmpDir has no .jsonl files → scanSessions returns [] → early exit
    const { code, out } = await captureStdout(() => run(["--profile", "core"]));
    expect(code).toBe(0);
    expect(out).toContain("No session transcripts found");
    expect(out).toContain("7 days");
  });

  test("--days N is reflected in the no-transcripts message", async () => {
    const { code, out } = await captureStdout(() =>
      run(["--profile", "core", "--days", "3"]),
    );
    expect(code).toBe(0);
    expect(out).toContain("No session transcripts found");
    expect(out).toContain("3 days");
  });
});
