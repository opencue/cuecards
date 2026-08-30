/**
 * Tests for `cue replay` — capability-diff replay.
 *
 * Tested surface:
 *   P3 — usage-error guard (missing session-id or profile arg).
 *   P3 — --what-if flag routes execution to replay-whatif with the full args list.
 *
 * findSession() is private and reads ~/.claude/projects/; it is NOT tested here.
 * Tests that would scan the real home directory are explicitly excluded.
 */

import { describe, expect, test } from "bun:test";
import { run } from "./replay";

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

describe("cue replay — usage guard", () => {
  test("no args → stderr usage message, returns 1", async () => {
    const { result, err } = await captureOutput(() => run([]));
    expect(result).toBe(1);
    expect(err).toContain("Usage");
    expect(err).toContain("cue replay");
  });

  test("session id but no --profile flag → stderr usage message, returns 1", async () => {
    const { result, err } = await captureOutput(() => run(["some-session-id"]));
    expect(result).toBe(1);
    expect(err).toContain("Usage");
  });

  test("--profile flag but no session id → stderr usage message, returns 1", async () => {
    // The session-id finder skips args starting with "-" and the value after --profile,
    // so "--profile core" alone leaves sessionId undefined.
    const { result, err } = await captureOutput(() => run(["--profile", "core"]));
    expect(result).toBe(1);
    expect(err).toContain("Usage");
  });
});

describe("cue replay — --what-if routing", () => {
  test("--what-if flag routes to replay-whatif; missing profile value → returns 1", async () => {
    // run(["--what-if"]) delegates to replay-whatif.run(["--what-if"]).
    // In replay-whatif, targetProfile = args[whatIfIdx+1] = undefined → returns 1.
    const { result, err } = await captureOutput(() => run(["--what-if"]));
    expect(result).toBe(1);
    expect(err).toContain("Usage");
  });

  test("--what-if with -h flag → delegates to replay-whatif help, returns 0", async () => {
    // run(["--what-if", "-h"]) delegates; replay-whatif checks -h first → returns 0.
    const { result, out } = await captureOutput(() => run(["--what-if", "-h"]));
    expect(result).toBe(0);
    expect(out).toContain("Usage");
  });
});
