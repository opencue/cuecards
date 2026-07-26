/**
 * Tests for src/commands/lock.ts — the exported `isProfileLocked()` helper.
 *
 * `lock.ts` bakes `PROFILES_DIR` as a module-level const at import time
 * (resolved to <repoRoot>/profiles since preload.ts has already cleared
 * CUE_PROFILES_DIR by then). This means:
 *
 *   - not-locked / not-found paths can be tested directly using real profiles.
 *   - the locked: true parsing path requires a subprocess (spawnSync) where
 *     CUE_PROFILES_DIR is set in the env BEFORE lock.ts is imported.
 *
 * `run()` is not tested here: it inspects process.argv directly to
 * distinguish lock vs unlock, which makes it impossible to drive hermetically
 * without injecting into process.argv.  That is a source-level refactoring
 * concern noted in `suspectedSourceBugs`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { isProfileLocked } from "./lock";

// ---------------------------------------------------------------------------
// BUN availability guard (mirrors ai-score.e2e.test.ts pattern)
// ---------------------------------------------------------------------------

const BUN_SPAWNABLE = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;

// ---------------------------------------------------------------------------
// Direct-import tests (PROFILES_DIR → real repo profiles/)
// ---------------------------------------------------------------------------

describe("isProfileLocked — real repo profiles (unlocked)", () => {
  test("core profile is not locked", () => {
    const result = isProfileLocked("core");
    expect(result.locked).toBe(false);
    expect(result.by).toBeUndefined();
    expect(result.reason).toBeUndefined();
  });

  test("non-existent profile returns { locked: false } (catch branch)", () => {
    const result = isProfileLocked("__profile_that_absolutely_does_not_exist_xyz__");
    expect(result.locked).toBe(false);
    expect(result.by).toBeUndefined();
    expect(result.reason).toBeUndefined();
  });

  test("returns a plain object with the locked key always present", () => {
    const result = isProfileLocked("core");
    expect(typeof result).toBe("object");
    expect("locked" in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Subprocess tests — locked: true parsing (CUE_PROFILES_DIR override)
// ---------------------------------------------------------------------------

let e2eDir: string;

beforeAll(() => {
  e2eDir = mkdtempSync(join(tmpdir(), "cue-lock-e2e-"));
});

afterAll(() => {
  rmSync(e2eDir, { recursive: true, force: true });
});

/** Run a tiny bun script that calls isProfileLocked and prints JSON result. */
function runLockCheck(profileName: string, profilesDir: string): { locked: boolean; by?: string; reason?: string } | null {
  const lockTsPath = join(import.meta.dir, "lock.ts");
  const scriptPath = join(e2eDir, "check.ts");
  writeFileSync(scriptPath, [
    `import { isProfileLocked } from ${JSON.stringify(lockTsPath)};`,
    `const r = isProfileLocked(${JSON.stringify(profileName)});`,
    `process.stdout.write(JSON.stringify(r) + "\\n");`,
  ].join("\n"));

  const res = spawnSync("bun", ["run", scriptPath], {
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, CUE_PROFILES_DIR: profilesDir },
  });

  if (res.status !== 0) return null;
  try {
    return JSON.parse(res.stdout.trim());
  } catch {
    return null;
  }
}

describe.skipIf(!BUN_SPAWNABLE)("isProfileLocked — subprocess (locked: true paths)", () => {
  test("detects locked: true with no by/reason fields", () => {
    const profileDir = join(e2eDir, "locked-bare");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "profile.yaml"),
      `name: locked-bare\ndescription: test\nlocked: true\n`);

    const result = runLockCheck("locked-bare", e2eDir);
    expect(result).not.toBeNull();
    expect(result!.locked).toBe(true);
    expect(result!.by).toBeUndefined();
    expect(result!.reason).toBeUndefined();
  });

  test("detects locked: true and parses locked_by", () => {
    const profileDir = join(e2eDir, "locked-by");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "profile.yaml"),
      `name: locked-by\ndescription: test\nlocked: true\nlocked_by: "ci-bot"\n`);

    const result = runLockCheck("locked-by", e2eDir);
    expect(result).not.toBeNull();
    expect(result!.locked).toBe(true);
    expect(result!.by).toBe("ci-bot");
    expect(result!.reason).toBeUndefined();
  });

  test("detects locked: true and parses locked_reason", () => {
    const profileDir = join(e2eDir, "locked-reason");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "profile.yaml"),
      `name: locked-reason\ndescription: test\nlocked: true\nlocked_by: "release-manager"\nlocked_reason: "production freeze"\n`);

    const result = runLockCheck("locked-reason", e2eDir);
    expect(result).not.toBeNull();
    expect(result!.locked).toBe(true);
    expect(result!.by).toBe("release-manager");
    expect(result!.reason).toBe("production freeze");
  });

  test("locked: yes (YAML boolean alias) is also detected as locked", () => {
    const profileDir = join(e2eDir, "locked-yes");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "profile.yaml"),
      `name: locked-yes\ndescription: test\nlocked: yes\n`);

    const result = runLockCheck("locked-yes", e2eDir);
    expect(result).not.toBeNull();
    expect(result!.locked).toBe(true);
  });

  test("profile with locked: false returns { locked: false }", () => {
    const profileDir = join(e2eDir, "not-locked");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "profile.yaml"),
      `name: not-locked\ndescription: test\nlocked: false\n`);

    const result = runLockCheck("not-locked", e2eDir);
    expect(result).not.toBeNull();
    expect(result!.locked).toBe(false);
  });
});
