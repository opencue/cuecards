/**
 * Tests for `cue playground` — isolated skill trial launcher.
 *
 * Only tests the hermetic paths: help output and the skill-not-found guard.
 * The spawn path is not tested here because it requires the real `claude`
 * binary and a real skill on disk.
 */

import { describe, expect, test } from "bun:test";
import { run } from "./playground";

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

describe("cue playground help / guard paths", () => {
  test("-h → writes help to stdout, returns 0", async () => {
    const { result, out } = await captureOutput(() => run(["-h"]));
    expect(result).toBe(0);
    expect(out).toContain("cue playground");
    expect(out).toContain("Usage");
  });

  test("--help → writes help to stdout, returns 0", async () => {
    const { result, out } = await captureOutput(() => run(["--help"]));
    expect(result).toBe(0);
    expect(out).toContain("Usage");
  });

  test("no args → writes help to stdout, returns 1", async () => {
    const { result, out } = await captureOutput(() => run([]));
    expect(result).toBe(1);
    expect(out).toContain("cue playground");
  });

  test("first arg starting with dash → writes help to stdout, returns 1", async () => {
    const { result, out } = await captureOutput(() => run(["--unknown-flag"]));
    expect(result).toBe(1);
    expect(out).toContain("Usage");
  });

  test("non-existent skill id → stderr 'not found', returns 1", async () => {
    // Use a skill id that is guaranteed not to exist on any machine
    const { result, err } = await captureOutput(() =>
      run(["totally-nonexistent-xyz-abc-no-such-skill-ever"])
    );
    expect(result).toBe(1);
    expect(err).toContain("not found");
  });
});
