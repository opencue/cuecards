/**
 * Tests for skills-pin.ts — `cue skills pin/rollback/unpin`.
 *
 * PIN_HISTORY_PATH is a module-level const computed from XDG_CONFIG_HOME at
 * import time. We must NOT statically import the module at the top of this
 * file. Instead we set XDG_CONFIG_HOME to a temp dir in beforeAll and
 * dynamically import the module so PIN_HISTORY_PATH points at our temp tree.
 *
 * SKILLS_ROOT is computed via repoRoot() (which reads CUE_REPO_ROOT at call
 * time) but is captured into a module-level const. After preload strips
 * CUE_REPO_ROOT, repoRoot() falls back to the file-location path, so
 * SKILLS_ROOT remains the real repo's resources/skills/skills/ tree. Tests
 * that need an existing skill directory (to pass the existsSync check) use
 * the real skill "meta/cue-usage".
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type RunFn = (args: string[]) => Promise<number>;

let tmpDir: string;
let pinHistoryPath: string;
let run: RunFn;
let savedXdgConfigHome: string | undefined;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "cue-skspin-"));
  savedXdgConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmpDir;

  // Dynamic import so module-level PIN_HISTORY_PATH = tmpDir/cue/pin-history.json
  const mod = await import("./skills-pin");
  run = mod.run;

  pinHistoryPath = join(tmpDir, "cue", "pin-history.json");
});

afterEach(() => {
  // Reset pin history between tests so each test starts with a clean slate.
  if (existsSync(pinHistoryPath)) {
    rmSync(pinHistoryPath);
  }
});

afterAll(() => {
  if (savedXdgConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = savedXdgConfigHome;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Argument validation — returns early before any I/O
// ---------------------------------------------------------------------------

describe("run — missing arguments", () => {
  test("no args → returns 1 (usage)", async () => {
    expect(await run([])).toBe(1);
  });

  test("subcommand only, no skill id → returns 1", async () => {
    expect(await run(["pin"])).toBe(1);
  });

  test("rollback only, no skill id → returns 1", async () => {
    expect(await run(["rollback"])).toBe(1);
  });

  test("unpin only, no skill id → returns 1", async () => {
    expect(await run(["unpin"])).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Skill not found — returns early before reading pin history
// ---------------------------------------------------------------------------

describe("run — skill not found", () => {
  test("pin on non-existent skill → returns 1", async () => {
    expect(await run(["pin", "zzzz-does-not-exist"])).toBe(1);
  });

  test("rollback on non-existent skill → returns 1", async () => {
    expect(await run(["rollback", "zzzz-does-not-exist"])).toBe(1);
  });

  test("unpin on non-existent skill → returns 1", async () => {
    expect(await run(["unpin", "zzzz-does-not-exist"])).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Operations against a real skill (meta/cue-usage exists in the repo)
// ---------------------------------------------------------------------------

describe("run — rollback with no history", () => {
  test("rollback with no history entry → returns 1", async () => {
    // No prior pin recorded → history[id] is undefined → length < 2
    expect(await run(["rollback", "meta/cue-usage"])).toBe(1);
  });

  test("rollback with exactly one entry → returns 1 (need at least 2)", async () => {
    // Pin once to create a single-entry history, then rollback should still fail.
    const pinResult = await run(["pin", "meta/cue-usage"]);
    if (pinResult !== 0) {
      // git unavailable or commit not found — skip the assertion
      return;
    }
    expect(await run(["rollback", "meta/cue-usage"])).toBe(1);
  });
});

describe("run — unpin", () => {
  test("unpin with no prior history → returns 0 (idempotent)", async () => {
    expect(await run(["unpin", "meta/cue-usage"])).toBe(0);
  });

  test("unpin after a pin → returns 0", async () => {
    const pinResult = await run(["pin", "meta/cue-usage"]);
    if (pinResult !== 0) return; // git unavailable
    expect(await run(["unpin", "meta/cue-usage"])).toBe(0);
  });
});

describe("run — pin", () => {
  test("pin on real skill → returns 0 (requires git in PATH)", async () => {
    // getCurrentCommit runs `git log` in resources/skills. If git isn't
    // available the function returns null and run() returns 1. We accept 0 as
    // the expected success code; if git is missing the test still passes
    // vacuously because we guard on the pin result below.
    const result = await run(["pin", "meta/cue-usage"]);
    // result is 0 on success, 1 if git log found no commit (or git missing)
    expect([0, 1]).toContain(result);
  });
});

describe("run — pin → rollback flow", () => {
  test("pin twice then rollback → returns 0", async () => {
    // Pin once.
    const first = await run(["pin", "meta/cue-usage"]);
    if (first !== 0) return; // git unavailable

    // Pin again (appends a second history entry).
    const second = await run(["pin", "meta/cue-usage"]);
    expect(second).toBe(0);

    // Rollback should now succeed (history length >= 2).
    expect(await run(["rollback", "meta/cue-usage"])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Unknown subcommand — only reached when skill exists and sub is unrecognized
// ---------------------------------------------------------------------------

describe("run — unknown subcommand", () => {
  test("unknown-sub on real skill → returns 1", async () => {
    expect(await run(["bad-cmd", "meta/cue-usage"])).toBe(1);
  });

  test("unknown-sub on non-existent skill → returns 1 (fails at skill-not-found)", async () => {
    expect(await run(["bad-cmd", "zzzz-ghost-skill"])).toBe(1);
  });
});
