import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "./launch";

let home: string;
let saveCwd: string;
beforeEach(async () => {
  saveCwd = process.cwd();
  home = await mkdtemp(join(tmpdir(), "cue-launch-"));
  process.env.HOME = home;
  process.env.SOUL_REPO_ROOT = saveCwd; // pretend cwd is the soul repo
  process.env.XDG_CONFIG_HOME = join(home, ".config");
});
afterEach(async () => {
  process.chdir(saveCwd);
  await rm(home, { recursive: true, force: true });
});

describe("soul launch --dry-run", () => {
  test("exits 1 when called with unknown agent", async () => {
    const rc = await run(["unknown-agent", "--dry-run"]);
    expect(rc).toBe(1);
  });

  test("exits 1 when no profile resolved and stdin is non-tty (no picker)", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cue-launch-cwd-"));
    process.chdir(cwd);
    const rc = await run(["claude", "--dry-run"]);
    expect(rc).toBe(1);
  });

  test("dry-run with pinned profile prints resolved env and exits 0", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cue-launch-cwd-"));
    await writeFile(join(cwd, ".cue-profile"), "core\n");
    process.chdir(cwd);
    // Note: the 'core' profile must exist under profiles/core/profile.yaml in the
    // repo root pointed to by SOUL_REPO_ROOT. The repo's existing core profile fits.
    const rc = await run(["claude", "--dry-run"]);
    expect(rc).toBe(0);
  });

  test("--cue-profile flag overrides any pin", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cue-launch-cwd-"));
    await writeFile(join(cwd, ".cue-profile"), "core");
    process.chdir(cwd);
    const rc = await run(["claude", "--cue-profile", "frontend", "--dry-run"]);
    expect(rc).toBe(0);
  });
});
