/**
 * Tests for `cue debug`. Asserts on stdout content for representative cases.
 * Uses the real profiles tree — debug is a diagnostic command, not pure.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { run as debugRun } from "./debug";

beforeEach(() => {
  delete process.env.CUE_PROFILES_DIR;
  delete process.env.SOUL_PROFILES_DIR;
});

function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

async function captureStdout<T>(fn: () => Promise<T>): Promise<{ stdout: string; value: T }> {
  const orig = process.stdout.write.bind(process.stdout);
  let buf = "";
  (process.stdout as any).write = (chunk: string | Uint8Array) => { buf += String(chunk); return true; };
  try {
    const value = await fn();
    return { stdout: buf, value };
  } finally {
    (process.stdout as any).write = orig;
  }
}

describe("cue debug", () => {
  test("explicit profile arg wins over cwd auto-detect, reports all sections", async () => {
    const { stdout, value } = await captureStdout(() => debugRun(["ecc"]));
    // Exit code can be 0 or 1 — the profile may have skills missing from disk
    // (managed by other sessions). What matters is that all sections render.
    expect(value === 0 || value === 1).toBe(true);
    const clean = strip(stdout);
    expect(clean).toContain("Profile: ecc (source: cli-arg)");
    expect(clean).toContain("Inheritance: core → ecc");
    expect(clean).toContain("Skills");
    expect(clean).toContain("MCPs");
    expect(clean).toContain("Rules");
    expect(clean).toContain("Commands");
    expect(clean).toContain("Hooks");
    expect(clean).toContain("Summary:");
  });

  test("glob skill ids (full profile uses */*) are not reported as missing", async () => {
    const { stdout, value } = await captureStdout(() => debugRun(["full"]));
    expect(value === 0 || value === 1).toBe(true);
    const clean = strip(stdout);
    // No "not found" / no "✗" for glob entries — they're resolved at materialize time
    expect(clean).not.toContain("*/* — not found");
    expect(clean).toContain("Summary:");
  });

  test("verbose mode lists each skill individually", async () => {
    const { stdout } = await captureStdout(() => debugRun(["ecc", "--verbose"]));
    const clean = strip(stdout);
    // ecc has 8 inherited skills; at least one should show up by name
    expect(clean).toMatch(/meta\/analyze|caveman\/caveman|nvidia\/skill-evolution/);
  });
});
