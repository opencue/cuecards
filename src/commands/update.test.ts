/**
 * Tests for `cue update`.
 *
 * Points CUE_REPO_ROOT at a temp dir that has no .git directory.  Every
 * gitPull() call returns "not a git repo" immediately without touching the
 * network or the real working tree.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "./update";

let tmpDir: string;
let savedRepoRoot: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cue-update-"));
  savedRepoRoot = process.env.CUE_REPO_ROOT;
  // repoRoot() checks CUE_REPO_ROOT first; with it pointing at tmpDir (no .git)
  // all gitPull() calls short-circuit to "not a git repo".
  process.env.CUE_REPO_ROOT = tmpDir;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (savedRepoRoot === undefined) {
    delete process.env.CUE_REPO_ROOT;
  } else {
    process.env.CUE_REPO_ROOT = savedRepoRoot;
  }
});

async function captureStdout(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const orig = process.stdout.write.bind(process.stdout);
  let out = "";
  (process.stdout as any).write = (c: any) => {
    out += String(c);
    return true;
  };
  try {
    const code = await fn();
    return { code, out };
  } finally {
    (process.stdout as any).write = orig;
  }
}

describe("cue update --json (no .git)", () => {
  test("returns 0 and emits a JSON array", async () => {
    const { code, out } = await captureStdout(() => run(["--json"]));
    expect(code).toBe(0);
    // stdout: "Updating cue...\n\n" then the JSON array
    const jsonStart = out.indexOf("[");
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    const results = JSON.parse(out.slice(jsonStart));
    expect(Array.isArray(results)).toBe(true);
  });

  test("every repo reports updated=false and 'not a git repo'", async () => {
    const { out } = await captureStdout(() => run(["--json"]));
    const jsonStart = out.indexOf("[");
    const results: Array<{ repo: string; updated: boolean; changes: string }> =
      JSON.parse(out.slice(jsonStart));
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.updated).toBe(false);
      expect(r.changes).toBe("not a git repo");
    }
  });

  test("--skills excludes the cue repo itself", async () => {
    const { out } = await captureStdout(() => run(["--json", "--skills"]));
    const jsonStart = out.indexOf("[");
    const results: Array<{ repo: string }> = JSON.parse(out.slice(jsonStart));
    // Without --skills the first entry is "cue"; with --skills it should not be
    const names = results.map((r) => r.repo);
    expect(names).not.toContain("cue");
    // skills and mcps sub-repos are still included
    expect(names.some((n) => n === "skills" || n === "mcps")).toBe(true);
  });
});

describe("cue update --check (no .git)", () => {
  test("returns 0 and prints the checking header", async () => {
    const { code, out } = await captureStdout(() => run(["--check"]));
    expect(code).toBe(0);
    expect(out).toContain("Checking for updates");
  });

  test("no per-repo output when all dirs lack .git", async () => {
    const { out } = await captureStdout(() => run(["--check"]));
    // The loop skips every dir (no .git), so nothing but the header is written.
    expect(out.trim()).toBe("Checking for updates...");
  });
});
