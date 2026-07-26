/**
 * Tests for src/commands/lint-skill.ts.
 *
 * The exported surface is only `run()`.  We drive it against temp-dir
 * fixtures so the tests are hermetic and do not touch the real skill tree.
 *
 * Note: `run()` returns an exit code (0 or 1) and writes to stdout/stderr.
 * It never calls process.exit(), so calling it inline is safe.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "./lint-skill";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A minimal SKILL.md that passes the required-fields check. */
const MINIMAL_VALID_SKILL = `---
name: test-skill
description: >-
  A unit-test skill for linting. Use when you need to test the lint-skill command.
---

# Test Skill

This skill documents the test procedure.

## Usage

Call this skill when testing.
`;

/** A SKILL.md missing the description field — should produce lint errors. */
const SKILL_MISSING_DESC = `---
name: incomplete-skill
---

# Incomplete Skill
`;

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cue-lint-skill-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// Suppress output during all tests — we only care about return codes / JSON.
let stdoutSpy: ReturnType<typeof spyOn>;
let stderrSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("lint-skill run() — missing/invalid args", () => {
  test("returns 1 and writes usage to stderr when no positional args given", async () => {
    const code = await run([]);
    expect(code).toBe(1);
    // At least one call to stderr with usage info
    expect(stderrSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test("returns 1 for a path that does not exist", async () => {
    const code = await run(["/nonexistent/absolutely/does-not-exist/SKILL.md"]);
    expect(code).toBe(1);
  });

  test("returns 1 for a directory containing no SKILL.md files", async () => {
    // tmpDir exists but has no SKILL.md
    const code = await run([tmpDir]);
    expect(code).toBe(1);
  });
});

describe("lint-skill run() — single valid SKILL.md", () => {
  test("returns a numeric exit code for a minimal valid skill (0 or 1)", async () => {
    const skillPath = join(tmpDir, "SKILL.md");
    writeFileSync(skillPath, MINIMAL_VALID_SKILL);
    const code = await run([skillPath]);
    expect([0, 1]).toContain(code);
  });

  test("returns 1 for a SKILL.md missing the description field", async () => {
    const skillPath = join(tmpDir, "SKILL.md");
    writeFileSync(skillPath, SKILL_MISSING_DESC);
    const code = await run([skillPath]);
    // Missing description is an error-level diagnostic → exit 1
    expect(code).toBe(1);
  });
});

describe("lint-skill run() — --json flag", () => {
  test("outputs a JSON array to stdout and returns 0 or 1", async () => {
    // Restore real stdout just for this test so we can capture it
    stdoutSpy.mockRestore();
    const chunks: string[] = [];
    const _realWrite = process.stdout.write.bind(process.stdout);
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      chunks.push(String(chunk));
      return true;
    });

    const skillPath = join(tmpDir, "SKILL.md");
    writeFileSync(skillPath, MINIMAL_VALID_SKILL);
    const code = await run(["--json", skillPath]);

    expect([0, 1]).toContain(code);
    const raw = chunks.join("");
    const parsed = JSON.parse(raw); // throws if not valid JSON
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(typeof parsed[0]!.score).toBe("number");
    expect(Array.isArray(parsed[0]!.diagnostics)).toBe(true);
  });
});

describe("lint-skill run() — --baseline-write", () => {
  test("writes a valid baseline JSON file and returns 0", async () => {
    const skillPath = join(tmpDir, "SKILL.md");
    writeFileSync(skillPath, MINIMAL_VALID_SKILL);
    const baselinePath = join(tmpDir, "baseline.json");

    const code = await run(["--baseline-write", baselinePath, skillPath]);
    expect(code).toBe(0);

    const raw = readFileSync(baselinePath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(typeof parsed.files).toBe("object");
  });
});

describe("lint-skill run() — directory scanning (collectSkillFiles)", () => {
  test("finds SKILL.md files nested inside a directory", async () => {
    // Restore stdout for JSON capture
    stdoutSpy.mockRestore();
    const chunks: string[] = [];
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      chunks.push(String(chunk));
      return true;
    });

    const subDir = join(tmpDir, "my-skill");
    mkdirSync(subDir);
    writeFileSync(join(subDir, "SKILL.md"), MINIMAL_VALID_SKILL);

    const code = await run(["--json", tmpDir]);
    expect([0, 1]).toContain(code);

    const raw = chunks.join("");
    const parsed = JSON.parse(raw);
    expect(parsed.length).toBe(1); // found the one nested file
  });
});
