/**
 * Tests for src/commands/loadout.ts.
 *
 * `run()` is the only exported symbol.  The internal `move()` helper is
 * indirectly exercised by the `keep` / `defer` subcommands.
 *
 * All tests redirect XDG_CONFIG_HOME to a temp dir so they never touch the
 * real ~/.config/cue/loadouts.json.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "./loadout";
import type { LoadoutEntry } from "../lib/project-loadout";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let savedXDG: string | undefined;

// Redirect config writes to an isolated temp dir
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cue-loadout-"));
  savedXDG = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmpDir;
});

afterEach(() => {
  if (savedXDG === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = savedXDG;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

// Suppress stdout/stderr output from the command during tests
let outSpy: ReturnType<typeof spyOn>;
let errSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  outSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
  errSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
});

/** Write a fake LoadoutEntry for cwd into the temp loadouts.json. */
function seedLoadout(entry: LoadoutEntry): void {
  const cueDir = join(tmpDir, "cue");
  mkdirSync(cueDir, { recursive: true });
  const loadoutsPath = join(cueDir, "loadouts.json");
  writeFileSync(loadoutsPath, JSON.stringify({ [process.cwd()]: entry }, null, 2) + "\n");
}

/** Read back the loadout for cwd from the temp loadouts.json. */
function readSavedLoadout(): LoadoutEntry | undefined {
  const loadoutsPath = join(tmpDir, "cue", "loadouts.json");
  try {
    const raw = JSON.parse(readFileSync(loadoutsPath, "utf8"));
    return raw[process.cwd()] as LoadoutEntry | undefined;
  } catch {
    return undefined;
  }
}

const SAMPLE_ENTRY: LoadoutEntry = {
  profile: "core",
  fingerprint: "aabbcc001122",
  signalsHash: "ddeeff334455",
  full: ["help", "caveman"],
  deferred: ["investigate", "autoplan"],
  userKeep: [],
  userDefer: [],
  enabled: true,
  capturedAt: "2026-01-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadout run() — help", () => {
  test("--help returns 0", async () => {
    const code = await run(["--help"]);
    expect(code).toBe(0);
  });

  test("-h returns 0", async () => {
    const code = await run(["-h"]);
    expect(code).toBe(0);
  });

  test("help returns 0", async () => {
    const code = await run(["help"]);
    expect(code).toBe(0);
  });
});

describe("loadout run() — no loadout present", () => {
  test("run() with no loadout returns 0 and writes a message", async () => {
    const code = await run([]);
    expect(code).toBe(0);
    // Should emit some output about nothing captured
    expect(outSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test("run(['keep', 'something']) with no loadout returns 1", async () => {
    const code = await run(["keep", "investigate"]);
    expect(code).toBe(1);
  });
});

describe("loadout run() — show subcommand", () => {
  test("run([]) with an existing loadout returns 0", async () => {
    seedLoadout({ ...SAMPLE_ENTRY });
    const code = await run([]);
    expect(code).toBe(0);
  });

  test("run(['show']) with an existing loadout returns 0", async () => {
    seedLoadout({ ...SAMPLE_ENTRY });
    const code = await run(["show"]);
    expect(code).toBe(0);
  });
});

describe("loadout run() — keep (move deferred → full)", () => {
  test("promotes a skill from deferred to full and updates userKeep", async () => {
    seedLoadout({ ...SAMPLE_ENTRY });
    const code = await run(["keep", "investigate"]);
    expect(code).toBe(0);

    const updated = readSavedLoadout();
    expect(updated?.full).toContain("investigate");
    expect(updated?.deferred).not.toContain("investigate");
    expect(updated?.userKeep).toContain("investigate");
    expect(updated?.userDefer).not.toContain("investigate");
  });

  test("records intent even for a skill not in the loadout profile", async () => {
    seedLoadout({ ...SAMPLE_ENTRY });
    const code = await run(["keep", "ghost-skill-xyz"]);
    expect(code).toBe(0);

    const updated = readSavedLoadout();
    expect(updated?.userKeep).toContain("ghost-skill-xyz");
    // stderr should mention the id is not in the loadout
    expect(errSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test("returns 1 when keep is called with no ids", async () => {
    seedLoadout({ ...SAMPLE_ENTRY });
    const code = await run(["keep"]);
    expect(code).toBe(1);
  });
});

describe("loadout run() — defer (move full → deferred)", () => {
  test("demotes a skill from full to deferred and updates userDefer", async () => {
    seedLoadout({ ...SAMPLE_ENTRY });
    const code = await run(["defer", "caveman"]);
    expect(code).toBe(0);

    const updated = readSavedLoadout();
    expect(updated?.deferred).toContain("caveman");
    expect(updated?.full).not.toContain("caveman");
    expect(updated?.userDefer).toContain("caveman");
    expect(updated?.userKeep).not.toContain("caveman");
  });

  test("returns 1 when defer is called with no ids", async () => {
    seedLoadout({ ...SAMPLE_ENTRY });
    const code = await run(["defer"]);
    expect(code).toBe(1);
  });
});

describe("loadout run() — on/off", () => {
  test("off disables the loadout", async () => {
    seedLoadout({ ...SAMPLE_ENTRY });
    const code = await run(["off"]);
    expect(code).toBe(0);
    expect(readSavedLoadout()?.enabled).toBe(false);
  });

  test("on re-enables a disabled loadout", async () => {
    seedLoadout({ ...SAMPLE_ENTRY, enabled: false });
    const code = await run(["on"]);
    expect(code).toBe(0);
    expect(readSavedLoadout()?.enabled).toBe(true);
  });
});

describe("loadout run() — reset", () => {
  test("reset deletes the loadout entry and returns 0", async () => {
    seedLoadout({ ...SAMPLE_ENTRY });
    const code = await run(["reset"]);
    expect(code).toBe(0);
    expect(readSavedLoadout()).toBeUndefined();
  });
});

describe("loadout run() — unknown subcommand", () => {
  test("unknown subcommand returns 1", async () => {
    seedLoadout({ ...SAMPLE_ENTRY });
    const code = await run(["not-a-real-subcommand"]);
    expect(code).toBe(1);
    expect(errSpy.mock.calls.length).toBeGreaterThan(0);
  });
});
