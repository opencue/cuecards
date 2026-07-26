/**
 * Tests for `cue audit --security` (runSecurityAudit).
 *
 * The exported surface is `runSecurityAudit(args)`.
 *
 * Tested paths:
 *   nonexistent profile → return 1 with error message (no FS writes)
 *   "core" profile      → return 0/1/2, well-formed output including a score
 *   score parsing       → verify the score line in [0, 100]
 *   label classification → "good" at high score, lower labels at low score
 */

import { describe, expect, test } from "bun:test";
import { runSecurityAudit } from "./security-audit";

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

/** Parse the "Score: N/100 (label)" line from stdout. */
function parseScore(stdout: string): { score: number; label: string } | null {
  const m = stdout.match(/Score:\s+(\d+)\/100\s+\(([^)]+)\)/);
  if (!m) return null;
  return { score: Number(m[1]), label: m[2]! };
}

describe("runSecurityAudit — error paths", () => {
  test("nonexistent profile → returns 1", async () => {
    const { code } = await captureIO(() =>
      runSecurityAudit(["totally-nonexistent-profile-xyz123"])
    );
    expect(code).toBe(1);
  });

  test("nonexistent profile → stderr mentions the profile name", async () => {
    const { stderr } = await captureIO(() =>
      runSecurityAudit(["totally-nonexistent-profile-xyz123"])
    );
    expect(stderr).toContain("totally-nonexistent-profile-xyz123");
  });

  test("nonexistent profile → stderr contains 'Failed to load'", async () => {
    const { stderr } = await captureIO(() =>
      runSecurityAudit(["totally-nonexistent-profile-xyz123"])
    );
    expect(stderr).toContain("Failed to load profile");
  });
});

describe("runSecurityAudit — core profile", () => {
  test("returns 0, 1, or 2 (no other exit codes)", async () => {
    const { code } = await captureIO(() => runSecurityAudit(["core"]));
    expect([0, 1, 2]).toContain(code);
  });

  test("stdout contains Security Audit header for 'core'", async () => {
    const { stdout } = await captureIO(() => runSecurityAudit(["core"]));
    expect(stdout).toContain('Security Audit for "core"');
  });

  test("stdout contains a Score line", async () => {
    const { stdout } = await captureIO(() => runSecurityAudit(["core"]));
    expect(stdout).toContain("Score:");
    expect(stdout).toMatch(/Score:\s+\d+\/100/);
  });

  test("score is in the valid range [0, 100]", async () => {
    const { stdout } = await captureIO(() => runSecurityAudit(["core"]));
    const parsed = parseScore(stdout);
    expect(parsed).not.toBeNull();
    expect(parsed!.score).toBeGreaterThanOrEqual(0);
    expect(parsed!.score).toBeLessThanOrEqual(100);
  });

  test("score label is one of the known labels", async () => {
    const { stdout } = await captureIO(() => runSecurityAudit(["core"]));
    const parsed = parseScore(stdout);
    expect(parsed).not.toBeNull();
    expect(["good", "needs attention", "concerning", "critical"]).toContain(parsed!.label);
  });

  test("return code is 2 only when there are CRITICAL findings in stdout", async () => {
    const { stdout, code } = await captureIO(() => runSecurityAudit(["core"]));
    if (code === 2) {
      expect(stdout).toContain("CRITICAL");
    }
  });

  test("return code 0 means no findings at all", async () => {
    const { stdout, code } = await captureIO(() => runSecurityAudit(["core"]));
    if (code === 0) {
      expect(stdout).toContain("No security issues found");
    }
  });
});

describe("runSecurityAudit — score label thresholds", () => {
  /**
   * Verify score-to-label mapping documented in the source:
   *   >= 80  → "good"
   *   >= 60  → "needs attention"
   *   >= 40  → "concerning"
   *   < 40   → "critical"
   * We exercise this indirectly via the core profile's real output. The score
   * value decides which label we expect; the test verifies consistency.
   */
  test("score >= 80 implies 'good' label", async () => {
    const { stdout } = await captureIO(() => runSecurityAudit(["core"]));
    const parsed = parseScore(stdout);
    if (parsed && parsed.score >= 80) {
      expect(parsed.label).toBe("good");
    }
  });

  test("score < 60 does not show 'good' label", async () => {
    const { stdout } = await captureIO(() => runSecurityAudit(["core"]));
    const parsed = parseScore(stdout);
    if (parsed && parsed.score < 60) {
      expect(parsed.label).not.toBe("good");
    }
  });
});
