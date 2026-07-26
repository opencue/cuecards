/**
 * Unit-level tests for `cue score`.
 *
 * The e2e layer (ai-score.e2e.test.ts) already covers `cue score --profile X`,
 * `--all`, `--json`, `--markdown`, and `--badge` via spawnSync. These tests
 * complement by exercising `run()` directly — faster feedback, same logic.
 *
 * Tested paths:
 *   --help       — hermetic
 *   --profile + terminal output structure
 *   --profile + --json  (grade / score range)
 *   --markdown badge URL format
 */

import { describe, expect, test } from "bun:test";
import { run } from "./score";

function captureIO(fn: () => Promise<number>): Promise<{ stdout: string; stderr: string; code: number }> {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";
  (process.stdout as any).write = (c: string | Uint8Array) => { stdout += String(c); return true; };
  (process.stderr as any).write = (c: string | Uint8Array) => { stderr += String(c); return true; };
  return fn()
    .then(code => ({ stdout, stderr, code }))
    .finally(() => {
      (process.stdout as any).write = origOut;
      (process.stderr as any).write = origErr;
    });
}

describe("cue score --help", () => {
  test("--help returns 0", async () => {
    const { code } = await captureIO(() => run(["--help"]));
    expect(code).toBe(0);
  });

  test("-h returns 0", async () => {
    const { code } = await captureIO(() => run(["-h"]));
    expect(code).toBe(0);
  });

  test("--help output mentions key flags", async () => {
    const { stdout } = await captureIO(() => run(["--help"]));
    expect(stdout).toContain("cue score");
    expect(stdout).toContain("--profile");
    expect(stdout).toContain("--all");
    expect(stdout).toContain("--badge");
    expect(stdout).toContain("--json");
    expect(stdout).toContain("--markdown");
  });
});

describe("cue score --profile core", () => {
  test("returns 0 for core profile", async () => {
    const { code } = await captureIO(() => run(["--profile", "core"]));
    expect(code).toBe(0);
  });

  test("terminal output contains profile name and /100 score", async () => {
    const { stdout } = await captureIO(() => run(["--profile", "core"]));
    // Strip ANSI colour codes before checking
    const clean = stdout.replace(/\x1b\[[0-9;]*m/g, "");
    expect(clean).toContain("core");
    expect(clean).toMatch(/\d+\/100/);
  });

  test("terminal output contains Token budget and Skill usage lines", async () => {
    const { stdout } = await captureIO(() => run(["--profile", "core"]));
    const clean = stdout.replace(/\x1b\[[0-9;]*m/g, "");
    expect(clean).toContain("Token budget");
    expect(clean).toContain("Skill usage");
    expect(clean).toContain("Unused skills");
  });
});

describe("cue score --json", () => {
  test("--profile core --json returns valid JSON", async () => {
    const { stdout, code } = await captureIO(() => run(["--profile", "core", "--json"]));
    expect(code).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.profile).toBe("core");
  });

  test("--json score is in [0, 100]", async () => {
    const { stdout } = await captureIO(() => run(["--profile", "core", "--json"]));
    const data = JSON.parse(stdout) as { score: number };
    expect(data.score).toBeGreaterThanOrEqual(0);
    expect(data.score).toBeLessThanOrEqual(100);
  });

  test("--json grade matches known pattern", async () => {
    const { stdout } = await captureIO(() => run(["--profile", "core", "--json"]));
    const data = JSON.parse(stdout) as { grade: string };
    expect(data.grade).toMatch(/^[A-F][+-]?$/);
  });

  test("--json includes required fields", async () => {
    const { stdout } = await captureIO(() => run(["--profile", "core", "--json"]));
    const data = JSON.parse(stdout) as Record<string, unknown>;
    for (const field of ["profile", "grade", "score", "tokens", "skillCount", "usedSkills", "unusedSkills", "usageRate"]) {
      expect(field in data).toBe(true);
    }
  });

  test("--json tokens > 0", async () => {
    const { stdout } = await captureIO(() => run(["--profile", "core", "--json"]));
    const data = JSON.parse(stdout) as { tokens: number };
    expect(data.tokens).toBeGreaterThan(0);
  });
});

describe("cue score --markdown", () => {
  test("--profile core --markdown returns 0", async () => {
    const { code } = await captureIO(() => run(["--profile", "core", "--markdown"]));
    expect(code).toBe(0);
  });

  test("--markdown output contains shields.io badge URL", async () => {
    const { stdout } = await captureIO(() => run(["--profile", "core", "--markdown"]));
    expect(stdout).toContain("img.shields.io/badge/cue_score");
    expect(stdout).toContain("![cue score]");
  });
});
