/**
 * Tests for src/commands/handoff.ts
 *
 * Driven end-to-end via spawnSync with XDG_CONFIG_HOME pointed at a temp dir.
 *
 * Why e2e instead of mocking ../lib/handoff: `mock.module()` in Bun replaces the
 * module in a PROCESS-GLOBAL registry that outlives the file registering it. An
 * earlier version of this file mocked lib/handoff, which leaked the stub into
 * src/lib/handoff.test.ts whenever the two landed in the same worker — that file
 * then asserted against the stub's truncated output and failed in CI while
 * passing locally, depending purely on file ordering. Spawning a child process
 * gives real isolation: HANDOFFS_DIR is a module-level const baked from
 * XDG_CONFIG_HOME at import time, so a fresh child picks up the temp dir and no
 * global state is touched here.
 *
 * Coverage: create (missing --task, valid, skill-level parsing), latest (empty,
 * populated, --json), list (empty, populated, --json), show (found, not found),
 * inject (empty, populated), and the default/unknown subcommand fallback.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const CUE_BIN = join(import.meta.dir, "../index.ts");

// Skip when a child `bun` can't be spawned (some sandboxes / odd PATH setups).
const BUN_SPAWNABLE = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;

let xdg: string;

function cue(args: string[]): { status: number; stdout: string; stderr: string } {
  const env = { ...process.env, XDG_CONFIG_HOME: xdg };
  delete env.CUE_LAUNCHING;
  const res = spawnSync("bun", ["run", CUE_BIN, "handoff", ...args], {
    encoding: "utf8",
    timeout: 20000,
    env,
  });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** Seed one handoff so read-side subcommands have something to find. */
function seed(task = "Implement the auth feature"): string {
  const res = cue([
    "create",
    "--from",
    "core",
    "--task",
    task,
    "--skills",
    "meta/careful:high,tools/context7:medium",
    "--notes",
    "check the env vars",
  ]);
  expect(res.status).toBe(0);
  return res.stdout.match(/handoff-[a-z0-9]+/)![0];
}

beforeEach(() => {
  xdg = mkdtempSync(join(tmpdir(), "cue-handoff-cmd-"));
});

afterEach(() => {
  rmSync(xdg, { recursive: true, force: true });
});

describe.skipIf(!BUN_SPAWNABLE)("cue handoff create", () => {
  test("missing --task prints usage to stderr and returns 1", () => {
    const res = cue(["create", "--from", "core"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Usage: cue handoff create");
    expect(res.stdout).not.toContain("Handoff created");
  });

  test("valid args create a handoff and print its id", () => {
    const res = cue(["create", "--from", "core", "--task", "Fix the payment flow"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Handoff created");
    expect(res.stdout).toMatch(/handoff-[a-z0-9]+/);
    expect(res.stdout).toContain("cue handoff inject");
  });

  test("--skills levels are parsed and routed to the right section", () => {
    seed();
    const { stdout } = cue(["inject"]);
    expect(stdout).toContain("**Most useful skills:** meta/careful");
    expect(stdout).toContain("**Also helpful:** tools/context7");
  });

  test("a skill without an explicit level defaults to medium", () => {
    cue(["create", "--from", "core", "--task", "t", "--skills", "plan/autoplan"]);
    const { stdout } = cue(["inject"]);
    expect(stdout).toContain("**Also helpful:** plan/autoplan");
    expect(stdout).not.toContain("Most useful");
  });

  test("--from defaults to 'unknown' when omitted", () => {
    cue(["create", "--task", "no from flag"]);
    const { stdout } = cue(["inject"]);
    expect(stdout).toContain('## Handoff from "unknown"');
  });
});

describe.skipIf(!BUN_SPAWNABLE)("cue handoff latest", () => {
  test("with no handoffs prints 'No handoffs yet.' and returns 0", () => {
    const res = cue(["latest"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("No handoffs yet.");
  });

  test("with a handoff prints the formatted context", () => {
    seed("Implement the auth feature");
    const res = cue(["latest"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('## Handoff from "core" (claude-code)');
    expect(res.stdout).toContain("> Implement the auth feature");
    expect(res.stdout).toContain("**Notes:** check the env vars");
  });

  test("--json emits the raw handoff object", () => {
    seed("json me");
    const res = cue(["latest", "--json"]);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.from_profile).toBe("core");
    expect(parsed.task_summary).toBe("json me");
    expect(parsed.skills_used).toEqual([
      { id: "meta/careful", usefulness: "high" },
      { id: "tools/context7", usefulness: "medium" },
    ]);
  });

  test("is the default subcommand when none is given", () => {
    const res = cue([]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("No handoffs yet.");
  });

  test("an unknown subcommand falls back to latest", () => {
    const res = cue(["not-a-subcommand"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("No handoffs yet.");
  });
});

describe.skipIf(!BUN_SPAWNABLE)("cue handoff list", () => {
  test("with no handoffs prints 'No handoffs.' and returns 0", () => {
    const res = cue(["list"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("No handoffs.");
  });

  test("lists each stored handoff with its id and task summary", () => {
    seed("first task");
    const res = cue(["list"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Recent handoffs (1):");
    expect(res.stdout).toMatch(/handoff-[a-z0-9]+/);
    expect(res.stdout).toContain("first task");
  });

  test("--json emits an array", () => {
    seed();
    const res = cue(["list", "--json"]);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].from_profile).toBe("core");
  });
});

describe.skipIf(!BUN_SPAWNABLE)("cue handoff show", () => {
  test("an existing id prints the formatted handoff", () => {
    const id = seed("show me");
    const res = cue(["show", id]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("> show me");
  });

  test("a missing id writes an error to stderr and returns 1", () => {
    const res = cue(["show", "handoff-does-not-exist"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Handoff "handoff-does-not-exist" not found.');
  });

  test("show with no id argument returns 1", () => {
    const res = cue(["show"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("not found");
  });
});

describe.skipIf(!BUN_SPAWNABLE)("cue handoff inject", () => {
  test("with no handoffs writes an error to stderr and returns 1", () => {
    const res = cue(["inject"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("No handoffs to inject.");
  });

  test("with a handoff emits the full formatted block on stdout", () => {
    seed("inject me");
    const res = cue(["inject"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('## Handoff from "core" (claude-code)');
    expect(res.stdout).toContain("> inject me");
    expect(res.stdout).toContain("**Most useful skills:**");
    expect(res.stdout).toContain("**Notes:**");
    expect(res.stderr).not.toContain("No handoffs");
  });
});
