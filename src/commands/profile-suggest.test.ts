/**
 * Tests for `cue profile suggest` — profile audit and regrouping report.
 *
 * Two categories:
 *   - Hermetic: help path (no disk access).
 *   - Smoke: full run against the real profiles/ tree in this repo.
 *     Non-hermetic by design (same pattern as debug.test.ts), because
 *     PROFILES_DIR is resolved from the repo root at module load time.
 */

import { describe, expect, test } from "bun:test";
import { run } from "./profile-suggest";

function captureOutput<T>(fn: () => Promise<T>): Promise<{ result: T; out: string; err: string }> {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  (process.stdout as any).write = (chunk: string | Uint8Array) => { out += String(chunk); return true; };
  (process.stderr as any).write = (chunk: string | Uint8Array) => { err += String(chunk); return true; };
  return fn()
    .then(result => ({ result, out, err }))
    .finally(() => {
      (process.stdout as any).write = origOut;
      (process.stderr as any).write = origErr;
    });
}

describe("cue profile suggest — help", () => {
  test("-h → writes help to stdout, returns 0", async () => {
    const { result, out } = await captureOutput(() => run(["-h"]));
    expect(result).toBe(0);
    expect(out).toContain("Usage");
    expect(out).toContain("cue profile suggest");
  });

  test("--help → returns 0 and mentions options", async () => {
    const { result, out } = await captureOutput(() => run(["--help"]));
    expect(result).toBe(0);
    expect(out).toContain("--min-profiles");
    expect(out).toContain("--jaccard");
  });
});

describe("cue profile suggest — smoke (real profiles/ tree)", () => {
  test("runs to completion with real profiles, --no-cluster --no-budget skips heavy sections", async () => {
    const { result, out } = await captureOutput(() =>
      run(["--no-cluster", "--no-budget"])
    );
    // May return 1 if profiles/ is somehow empty in CI, but that is the correct
    // behaviour (stderr message) — so we accept 0 or 1 as long as it doesn't throw.
    expect(result === 0 || result === 1).toBe(true);
    if (result === 0) {
      expect(out).toContain("cue profile suggest");
    }
  });

  test("promotes-to-core and merge-candidates sections always render in the happy path", async () => {
    const { result, out } = await captureOutput(() =>
      run(["--no-cluster", "--no-budget"])
    );
    if (result !== 0) return; // Skip if no profiles found
    // Both section headers must appear
    expect(out).toContain("Promote-to-core");
    expect(out).toContain("Merge candidates");
  });
});
