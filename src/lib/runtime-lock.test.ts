import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireLock, releaseLock, checkLock } from "./runtime-lock";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cue-lock-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const lockFilePath = (dir: string) => join(dir, ".active-pid");

describe("acquireLock", () => {
  test("acquires on a fresh directory", () => {
    const result = acquireLock(tmpDir);
    expect(result.acquired).toBe(true);
    expect(result.holder).toBeUndefined();
  });

  test("writes process.pid to lock file", () => {
    acquireLock(tmpDir);
    const written = parseInt(
      require("node:fs").readFileSync(lockFilePath(tmpDir), "utf8").trim(),
      10,
    );
    expect(written).toBe(process.pid);
  });

  test("returns acquired=false when same process already holds the lock", () => {
    acquireLock(tmpDir); // first acquire
    const result = acquireLock(tmpDir); // second attempt
    expect(result.acquired).toBe(false);
    expect(result.holder).toBe(process.pid);
  });

  test("clears stale lock (dead PID) and acquires", () => {
    // Write a lock file with a PID that is guaranteed not to exist
    writeFileSync(lockFilePath(tmpDir), "999999999");
    const result = acquireLock(tmpDir);
    expect(result.acquired).toBe(true);
  });

  test("overwrites stale lock file with own PID", () => {
    writeFileSync(lockFilePath(tmpDir), "999999999");
    acquireLock(tmpDir);
    const written = parseInt(
      require("node:fs").readFileSync(lockFilePath(tmpDir), "utf8").trim(),
      10,
    );
    expect(written).toBe(process.pid);
  });

  test("creates lock file directory if it does not exist", () => {
    const nested = join(tmpDir, "deep", "subdir");
    const result = acquireLock(nested);
    expect(result.acquired).toBe(true);
    expect(existsSync(lockFilePath(nested))).toBe(true);
  });
});

describe("releaseLock", () => {
  test("removes lock file after acquire", () => {
    acquireLock(tmpDir);
    expect(existsSync(lockFilePath(tmpDir))).toBe(true);
    releaseLock(tmpDir);
    expect(existsSync(lockFilePath(tmpDir))).toBe(false);
  });

  test("does not throw when no lock file exists", () => {
    expect(() => releaseLock(tmpDir)).not.toThrow();
  });

  test("does not remove lock held by a different PID", () => {
    // Simulate another process's lock
    writeFileSync(lockFilePath(tmpDir), "999999999");
    releaseLock(tmpDir); // should not remove a file with pid != process.pid
    // The file should still exist (since parseInt(999999999) !== process.pid)
    expect(existsSync(lockFilePath(tmpDir))).toBe(true);
  });
});

describe("checkLock", () => {
  test("returns locked=false when no lock file exists", () => {
    const result = checkLock(tmpDir);
    expect(result.locked).toBe(false);
    expect(result.pid).toBeUndefined();
  });

  test("returns locked=true when current process holds the lock", () => {
    acquireLock(tmpDir);
    const result = checkLock(tmpDir);
    expect(result.locked).toBe(true);
    expect(result.pid).toBe(process.pid);
  });

  test("returns locked=false and removes stale lock file", () => {
    writeFileSync(lockFilePath(tmpDir), "999999999");
    const result = checkLock(tmpDir);
    expect(result.locked).toBe(false);
    expect(existsSync(lockFilePath(tmpDir))).toBe(false);
  });

  test("round-trip: acquire → check locked → release → check unlocked", () => {
    acquireLock(tmpDir);
    expect(checkLock(tmpDir).locked).toBe(true);
    releaseLock(tmpDir);
    expect(checkLock(tmpDir).locked).toBe(false);
  });
});
