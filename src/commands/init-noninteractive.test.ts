/**
 * Tests for the non-interactive path of `cue init` (and its `setup` alias):
 * `--profile <name>` and `--yes` / `-y`.
 *
 * The acceptance bar for this path is that NO `p.select`/`p.confirm`/`p.text`
 * call is ever reachable — a reachable prompt hangs (or, with stdin closed,
 * crashes) when an agent drives this through a one-shot Bash tool. These
 * tests exercise the real `run()` end to end (not mocks of it) so a
 * regression that reintroduces a reachable prompt shows up as a hang here
 * too, not just in the manual stdin-closed check.
 *
 * Isolation: every test runs with cwd chdir'd into a fresh temp dir AND
 * XDG_CONFIG_HOME/XDG_CACHE_HOME/HOME repointed at a fresh temp tree, so
 * nothing touches the real home directory or repo root. A valid shim is
 * pre-seeded so `ensureShim()` short-circuits before ever calling
 * `runInstall()` — the shim-install mechanics themselves are covered by
 * shell.test.ts and by the manual stdin-closed verification, so exercising
 * them again here would just add flakiness (real PATH / real agent binary
 * dependent) without adding coverage of THIS task's behavior.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "./init";
import { shimContent, shimDir } from "../lib/shim-dir";
import { cacheDir } from "../lib/config-paths";
import type { GemRepo } from "./discover";

let tmpCwd: string;
let tmpXdg: string;
let origCwd: string;
let savedXdgConfig: string | undefined;
let savedXdgCache: string | undefined;
let savedHome: string | undefined;

beforeEach(() => {
  tmpCwd = mkdtempSync(join(tmpdir(), "cue-init-cwd-"));
  tmpXdg = mkdtempSync(join(tmpdir(), "cue-init-xdg-"));
  origCwd = process.cwd();
  savedXdgConfig = process.env.XDG_CONFIG_HOME;
  savedXdgCache = process.env.XDG_CACHE_HOME;
  savedHome = process.env.HOME;

  process.env.XDG_CONFIG_HOME = tmpXdg;
  process.env.XDG_CACHE_HOME = tmpXdg;
  // Belt-and-suspenders: anything that reads bare homedir() (e.g. runInstall's
  // rc-file / legacy-shim paths, IF the shim-install branch were ever reached)
  // still lands inside the temp tree, never the real $HOME.
  process.env.HOME = tmpXdg;

  process.chdir(tmpCwd);

  // Pre-seed a valid cue shim so `ensureShim()`'s `shimInstalled()` guard is
  // true and the whole install branch (and therefore `runInstall()`) is
  // never reached by these tests.
  const dir = shimDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "claude"), shimContent("cue", "claude"));
});

afterEach(() => {
  process.chdir(origCwd);
  if (savedXdgConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = savedXdgConfig;
  if (savedXdgCache === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = savedXdgCache;
  if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
  rmSync(tmpCwd, { recursive: true, force: true });
  rmSync(tmpXdg, { recursive: true, force: true });
});

/** Run `run(args)` capturing stdout/stderr instead of printing them. */
async function capture(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";
  (process.stdout as unknown as { write: (c: string | Uint8Array) => boolean }).write = (c) => {
    stdout += String(c);
    return true;
  };
  (process.stderr as unknown as { write: (c: string | Uint8Array) => boolean }).write = (c) => {
    stderr += String(c);
    return true;
  };
  try {
    const code = await run(args);
    return { stdout, stderr, code };
  } finally {
    (process.stdout as unknown as { write: typeof origOut }).write = origOut;
    (process.stderr as unknown as { write: typeof origErr }).write = origErr;
  }
}

function seedGem(overrides: Partial<GemRepo> = {}): void {
  mkdirSync(cacheDir(), { recursive: true });
  const gem: GemRepo = {
    full_name: "acme/example-skill",
    owner: "acme",
    name: "example-skill",
    description: "a fake gem seeded for the test",
    stars: 500,
    forks: 1,
    created_at: new Date().toISOString(),
    pushed_at: new Date().toISOString(),
    topics: [],
    language: "TypeScript",
    has_skill_md: true,
    has_claude_dir: true,
    has_mcp_sdk: false,
    gem_score: 20,
    suggested_profiles: ["core"],
    suggested_mcps: [],
    suggested_clis: [],
    quality: 1,
    url: "https://github.com/acme/example-skill",
    ...overrides,
  };
  writeFileSync(
    join(cacheDir(), "gems.json"),
    JSON.stringify({ updated: new Date().toISOString(), gems: [gem] }),
  );
}

describe("cue init --profile / --yes (non-interactive)", () => {
  test("--profile <name> --yes writes .cue.profile containing that name", async () => {
    const { code } = await capture(["--profile", "core", "--yes"]);
    expect(code).toBe(0);
    expect(readFileSync(join(tmpCwd, ".cue.profile"), "utf8").trim()).toBe("core");
  });

  test("an unknown --profile exits non-zero, names the bad value, and writes nothing", async () => {
    const { code, stderr } = await capture(["--profile", "not-a-real-profile-xyz", "--yes"]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("not-a-real-profile-xyz");
    expect(stderr).toContain("cue list");
    expect(existsSync(join(tmpCwd, ".cue.profile"))).toBe(false);
  });

  test("an unknown --profile fails fast even without --yes (no prompt reached)", async () => {
    const { code, stderr } = await capture(["--profile", "still-not-real"]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("still-not-real");
    expect(existsSync(join(tmpCwd, ".cue.profile"))).toBe(false);
  });

  test("--yes without --profile pins the top detectProfileV2() match", async () => {
    writeFileSync(join(tmpCwd, "package.json"), JSON.stringify({
      dependencies: { next: "14.0.0" },
    }));
    const { code } = await capture(["--yes"]);
    expect(code).toBe(0);
    expect(readFileSync(join(tmpCwd, ".cue.profile"), "utf8").trim()).toBe("nextjs");
  });

  test("--yes with no detected match falls back to core", async () => {
    const { code } = await capture(["--yes"]);
    expect(code).toBe(0);
    expect(readFileSync(join(tmpCwd, ".cue.profile"), "utf8").trim()).toBe("core");
  });

  test("--yes does NOT create the telemetry consent file", async () => {
    const { code } = await capture(["--profile", "core", "--yes"]);
    expect(code).toBe(0);
    expect(existsSync(join(tmpXdg, "cue", ".telemetry-consent"))).toBe(false);
  });

  test("--yes pins default-profile to core without any analytics opt-in prompt", async () => {
    const { code } = await capture(["--profile", "core", "--yes"]);
    expect(code).toBe(0);
    // First-run onboarding still runs (non-interactively) — it pins the
    // recommended default, the same value its own prompt marks recommended,
    // without ever asking.
    expect(readFileSync(join(tmpXdg, "cue", "default-profile"), "utf8").trim()).toBe("core");
    expect(existsSync(join(tmpXdg, "cue", ".onboarded"))).toBe(true);
  });

  test("--yes does NOT invoke the gem installer, even with a qualifying gem cached", async () => {
    seedGem();
    const { code, stdout } = await capture(["--profile", "core", "--yes"]);
    expect(code).toBe(0);
    expect(stdout).not.toContain("Installing acme/example-skill");
    expect(stdout).not.toContain("Installed 1 gem");
    expect(stdout).toContain("Skipped gem discovery");
  });

  test("-y is accepted as an alias for --yes", async () => {
    const { code } = await capture(["--profile", "core", "-y"]);
    expect(code).toBe(0);
    expect(readFileSync(join(tmpCwd, ".cue.profile"), "utf8").trim()).toBe("core");
  });

  test("--yes exits 0 and never leaves an unresolved p.isCancel-shaped hang (smoke)", async () => {
    // Regression guard: this used to be the exact call an agent's one-shot
    // Bash tool makes. If any clack widget became reachable again, this
    // would hang until bun test's own timeout instead of returning quickly.
    const { code } = await capture(["--profile", "core", "--yes"]);
    expect(code).toBe(0);
  });
});
