/**
 * Tests for `cue ruler`.
 *
 * Exported surface: `run(args)`.
 *
 * Tested paths:
 *   --help / -h  — hermetic, no FS reads
 *   --agents with an unknown id — loads real "core" profile then fails on bad agent
 *   --profile core --dry-run --all — dry-run reads rules but writes nothing
 *   --agents empty csv — returns 1 with helpful message
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./ruler";

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

describe("cue ruler --help", () => {
  test("--help returns 0", async () => {
    const { code } = await captureIO(() => run(["--help"]));
    expect(code).toBe(0);
  });

  test("-h returns 0", async () => {
    const { code } = await captureIO(() => run(["-h"]));
    expect(code).toBe(0);
  });

  test("--help output contains usage and known flags", async () => {
    const { stdout } = await captureIO(() => run(["--help"]));
    expect(stdout).toContain("cue ruler");
    expect(stdout).toContain("--all");
    expect(stdout).toContain("--dry-run");
    expect(stdout).toContain("--revert");
    expect(stdout).toContain("--agents");
  });

  test("--help lists known agent ids", async () => {
    const { stdout } = await captureIO(() => run(["--help"]));
    // Spot-check two stable agent ids
    expect(stdout).toContain("claude-code");
    expect(stdout).toContain("codex");
  });
});

describe("cue ruler — unknown agent", () => {
  test("--agents with a bogus id → returns 1", async () => {
    const { code, stderr } = await captureIO(() =>
      run(["--profile", "core", "--agents", "totally-not-a-real-agent-xyz"])
    );
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown agent");
    expect(stderr).toContain("totally-not-a-real-agent-xyz");
  });

  test("error message lists available agents", async () => {
    const { stderr } = await captureIO(() =>
      run(["--profile", "core", "--agents", "badagent"])
    );
    // The error message should mention at least one real agent
    expect(stderr).toContain("claude-code");
  });
});

describe("cue ruler --dry-run", () => {
  test("--profile core --dry-run --all returns 0 (writes nothing)", async () => {
    const { code } = await captureIO(() =>
      run(["--profile", "core", "--dry-run", "--all"])
    );
    expect(code).toBe(0);
  });

  test("dry-run output mentions dry-run", async () => {
    const { stdout } = await captureIO(() =>
      run(["--profile", "core", "--dry-run", "--all"])
    );
    // Either "dry-run" appears in the output or the profile has no rules to distribute
    const hasRules = stdout.includes("dry-run") || stdout.includes("no rules");
    expect(hasRules).toBe(true);
  });
});

describe("cue ruler --rulesync", () => {
  test.skipIf(process.platform === "win32")("defaults to preview and propagates the check exit code", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cue-rulesync-"));
    const path = process.env.PATH;
    try {
      process.env.PATH = dir;
      writeFileSync(join(dir, "rulesync.jsonc"), "{}");
      writeFileSync(join(dir, "rulesync"), [
        "#!/bin/sh",
        "printf '%s\\n' \"$@\" > invocation",
        "[ \"$2\" != --check ]",
      ].join("\n"), { mode: 0o755 });

      expect(await run(["--rulesync", "--dir", dir])).toBe(0);
      expect(readFileSync(join(dir, "invocation"), "utf8")).toBe("generate\n--dry-run\n");
      expect(await run(["--rulesync", "--dir", dir, "--check"])).toBe(1);
      expect(readFileSync(join(dir, "invocation"), "utf8")).toBe("generate\n--check\n");
    } finally {
      if (path === undefined) delete process.env.PATH;
      else process.env.PATH = path;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects a mix of Cue and Rulesync options before running anything", async () => {
    const { code, stderr } = await captureIO(() => run(["--rulesync", "--revert"]));
    expect(code).toBe(1);
    expect(stderr).toContain("--rulesync");
  });

  test("does not turn a bare --check into a Cue write", async () => {
    const { code, stderr } = await captureIO(() => run(["--check"]));
    expect(code).toBe(1);
    expect(stderr).toContain("--check requires --rulesync");
  });

  test.skipIf(process.platform === "win32")("does not run a Rulesync executable planted in the target", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cue-rulesync-path-"));
    const path = process.env.PATH;
    try {
      process.env.PATH = ".";
      writeFileSync(join(dir, "rulesync.jsonc"), "{}");
      writeFileSync(join(dir, "rulesync"), "#!/bin/sh\nprintf ran > invocation\n", { mode: 0o755 });
      const { code } = await captureIO(() => run(["--rulesync", "--dir", dir]));
      expect(code).toBe(1);
      expect(existsSync(join(dir, "invocation"))).toBe(false);
    } finally {
      if (path === undefined) delete process.env.PATH;
      else process.env.PATH = path;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
