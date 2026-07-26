/**
 * Tests for `cue telemetry`.
 *
 * Uses XDG_CONFIG_HOME → temp dir so every test is isolated from the real
 * ~/.config/cue/analytics.jsonl and consent file.  All sub-commands that
 * touch disk only see the temp tree; it is removed in afterEach.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "./telemetry";

let tmpDir: string;
let savedXdgConfigHome: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cue-telemetry-"));
  savedXdgConfigHome = process.env.XDG_CONFIG_HOME;
  // configDir() resolves to XDG_CONFIG_HOME/cue, so all consent/analytics
  // paths land inside tmpDir instead of the real ~/.config/cue.
  process.env.XDG_CONFIG_HOME = tmpDir;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (savedXdgConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = savedXdgConfigHome;
  }
});

async function capture(fn: () => Promise<number>): Promise<{
  code: number;
  out: string;
  err: string;
}> {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  (process.stdout as any).write = (c: any) => {
    out += String(c);
    return true;
  };
  (process.stderr as any).write = (c: any) => {
    err += String(c);
    return true;
  };
  try {
    const code = await fn();
    return { code, out, err };
  } finally {
    (process.stdout as any).write = origOut;
    (process.stderr as any).write = origErr;
  }
}

/** Strip ANSI escape sequences so assertions are colour-insensitive. */
function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ---------------------------------------------------------------------------
// Dispatch (no filesystem access required)
// ---------------------------------------------------------------------------

describe("cue telemetry dispatch", () => {
  test("missing sub-action writes usage to stderr and returns 1", async () => {
    const { code, err } = await capture(() => run([]));
    expect(code).toBe(1);
    expect(err).toContain("Usage: cue telemetry");
  });

  test("-h writes usage to stderr and returns 0", async () => {
    const { code, err } = await capture(() => run(["-h"]));
    expect(code).toBe(0);
    expect(err).toContain("Usage: cue telemetry");
  });

  test("--help writes usage to stderr and returns 0", async () => {
    const { code, err } = await capture(() => run(["--help"]));
    expect(code).toBe(0);
    expect(err).toContain("Usage: cue telemetry");
  });

  test("unknown sub-action returns 1 and names the bad input", async () => {
    const { code, err } = await capture(() => run(["xyzzy"]));
    expect(code).toBe(1);
    expect(err).toContain("unknown sub-action");
    expect(err).toContain("xyzzy");
  });
});

// ---------------------------------------------------------------------------
// status — reads consent + analytics files (redirected to tmpDir)
// ---------------------------------------------------------------------------

describe("cue telemetry status", () => {
  test("--json returns 0 and reports disabled/zero events when no data", async () => {
    const { code, out } = await capture(() => run(["status", "--json"]));
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.enabled).toBe(false);
    expect(parsed.eventCount).toBe(0);
  });

  test("plain status shows DISABLED when no consent file exists", async () => {
    const { code, out } = await capture(() => run(["status"]));
    expect(code).toBe(0);
    expect(strip(out)).toContain("DISABLED");
  });
});

// ---------------------------------------------------------------------------
// enable / disable / purge — write to tmpDir
// ---------------------------------------------------------------------------

describe("cue telemetry enable/disable/purge", () => {
  test("enable returns 0 and confirms opt-in", async () => {
    const { code, out } = await capture(() => run(["enable"]));
    expect(code).toBe(0);
    expect(strip(out)).toContain("Telemetry enabled");
  });

  test("enable twice is a no-op and says so", async () => {
    await capture(() => run(["enable"]));
    const { code, out } = await capture(() => run(["enable"]));
    expect(code).toBe(0);
    expect(strip(out)).toContain("already enabled");
  });

  test("disable when already disabled is a no-op and says so", async () => {
    const { code, out } = await capture(() => run(["disable"]));
    expect(code).toBe(0);
    expect(strip(out)).toContain("already disabled");
  });

  test("enable then disable cycles correctly", async () => {
    await capture(() => run(["enable"]));
    const { code, out } = await capture(() => run(["disable"]));
    expect(code).toBe(0);
    expect(strip(out)).toContain("Telemetry disabled");
  });

  test("purge when nothing to purge returns 0 and says so", async () => {
    const { code, out } = await capture(() => run(["purge"]));
    expect(code).toBe(0);
    expect(strip(out)).toContain("Nothing to purge");
  });

  test("enable followed by status --json reports enabled", async () => {
    await capture(() => run(["enable"]));
    const { code, out } = await capture(() => run(["status", "--json"]));
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.enabled).toBe(true);
  });
});
