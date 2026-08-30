import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { mkdirSync, rmSync, } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We mock lockfilePath by setting env before importing
const TEST_DIR = join(tmpdir(), "cue-lock-test-" + Date.now());
const LOCK_PATH = join(TEST_DIR, "skills-lock.json");

// Override the lockfilePath at module level
import * as lockMod from "./skills-lock";

// Since lockfilePath uses homedir(), we need to test via the actual functions
// but ensure isolation by cleaning up between tests

describe("skills-lock", () => {
  beforeEach(() => {
    process.env.CUE_SKILLS_LOCK_PATH = LOCK_PATH;
    // Remove any existing lockfile from prior test
    try { rmSync(LOCK_PATH, { force: true }); } catch {}
  });

  afterAll(() => {
    delete process.env.CUE_SKILLS_LOCK_PATH;
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("readLockfile returns empty when no file", () => {
    // Point HOME to a fresh empty dir
    const emptyDir = join(tmpdir(), "cue-lock-empty-" + Date.now());
    mkdirSync(emptyDir, { recursive: true });
    const origHome = process.env.HOME;
    process.env.HOME = emptyDir;
    // Re-import won't help since homedir() may be cached, so test the behavior:
    // readLockfile should handle missing file gracefully
    const lock = lockMod.readLockfile();
    expect(lock.version).toBe(1);
    expect(lock.skills).toBeInstanceOf(Array);
    process.env.HOME = origHome;
    rmSync(emptyDir, { recursive: true, force: true });
  });

  test("writeLockfile + readLockfile roundtrip", () => {
    const lock = { version: 1 as const, skills: [{ id: "test/a", repo: "owner/repo", sha: "abc123", fetchedAt: "2026-01-01" }] };
    lockMod.writeLockfile(lock);
    const read = lockMod.readLockfile();
    expect(read.skills[0]!.id).toBe("test/a");
    expect(read.skills[0]!.sha).toBe("abc123");
  });

  test("recordInstall adds new entry", () => {
    lockMod.recordInstall("test/b", "owner/repo-b", "def456");
    const lock = lockMod.readLockfile();
    const entry = lock.skills.find(s => s.id === "test/b");
    expect(entry).toBeDefined();
    expect(entry!.sha).toBe("def456");
  });

  test("recordInstall updates existing entry", () => {
    lockMod.recordInstall("test/c", "owner/repo-c", "aaa111");
    lockMod.recordInstall("test/c", "owner/repo-c", "bbb222");
    const lock = lockMod.readLockfile();
    const entries = lock.skills.filter(s => s.id === "test/c");
    expect(entries.length).toBe(1);
    expect(entries[0]!.sha).toBe("bbb222");
  });
});
