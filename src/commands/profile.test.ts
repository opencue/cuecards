/**
 * Tests for `cue profile` — the profile-scoped subcommand router.
 *
 * Pure routing logic: help, unknown subcommand. Does NOT invoke the real
 * subcommand implementations (those require network / disk I/O).
 */

import { describe, expect, test } from "bun:test";
import { run } from "./profile";

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

describe("cue profile routing", () => {
  test("no args → writes help with subcommand list to stdout, returns 1", async () => {
    const { result, out } = await captureOutput(() => run([]));
    expect(result).toBe(1);
    expect(out).toContain("suggest");
    expect(out).toContain("evolve");
    expect(out).toContain("draft-skill");
  });

  test("-h → writes help to stdout, returns 0", async () => {
    const { result, out } = await captureOutput(() => run(["-h"]));
    expect(result).toBe(0);
    expect(out).toContain("cue profile");
    expect(out).toContain("suggest");
  });

  test("--help → writes help to stdout, returns 0", async () => {
    const { result, out } = await captureOutput(() => run(["--help"]));
    expect(result).toBe(0);
    expect(out).toContain("Subcommands");
  });

  test("unknown subcommand → stderr with subcommand name, returns 1", async () => {
    const { result, err } = await captureOutput(() => run(["unknown-xyz-subcommand"]));
    expect(result).toBe(1);
    expect(err).toContain("Unknown subcommand");
    expect(err).toContain("unknown-xyz-subcommand");
  });

  test("unknown subcommand error message includes how-to-get-help hint", async () => {
    const { err } = await captureOutput(() => run(["nosuchthing"]));
    expect(err).toContain("cue profile");
  });
});
