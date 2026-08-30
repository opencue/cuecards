/**
 * Tests for `cue watch` — shell hook generation for auto-profile-switching on cd.
 *
 * All tests run the CLI via spawnSync so they exercise the real dispatch path.
 * The command has no file I/O or network access, making every path hermetic.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CUE_BIN = join(import.meta.dir, "../index.ts");

const BUN_SPAWNABLE = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;

function cue(
  args: string[],
  extraEnv?: Record<string, string>,
): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("bun", ["run", CUE_BIN, ...args], {
    encoding: "utf8",
    timeout: 10000,
    env: { ...process.env, ...extraEnv },
  });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe.skipIf(!BUN_SPAWNABLE)("cue watch", () => {
  test("bash hook defines __cue_watch function", () => {
    const { status, stdout } = cue(["watch", "bash"]);
    expect(status).toBe(0);
    expect(stdout).toContain("__cue_watch");
  });

  test("bash hook installs an alias for cd", () => {
    const { stdout } = cue(["watch", "bash"]);
    expect(stdout).toContain("alias cd=");
  });

  test("bash hook carries the expected comment header", () => {
    const { stdout } = cue(["watch", "bash"]);
    expect(stdout).toContain("# cue watch");
  });

  test("zsh hook defines __cue_watch function", () => {
    const { status, stdout } = cue(["watch", "zsh"]);
    expect(status).toBe(0);
    expect(stdout).toContain("__cue_watch");
  });

  test("zsh hook uses add-zsh-hook for chpwd integration", () => {
    const { stdout } = cue(["watch", "zsh"]);
    expect(stdout).toContain("add-zsh-hook");
    expect(stdout).toContain("chpwd");
  });

  test("unsupported shell exits 1 with an error message naming the shell", () => {
    const { status, stderr } = cue(["watch", "fish"]);
    expect(status).toBe(1);
    expect(stderr).toContain("unsupported shell");
    expect(stderr).toContain("fish");
  });

  test("--help exits 0 and shows usage", () => {
    const { status, stdout } = cue(["watch", "--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("cue watch");
    expect(stdout).toContain("eval");
  });

  test("-h is accepted as shorthand for --help", () => {
    const { status, stdout } = cue(["watch", "-h"]);
    expect(status).toBe(0);
    expect(stdout).toContain("cue watch");
  });

  test("no args with SHELL=/bin/zsh produces zsh hook", () => {
    const { status, stdout } = cue(["watch"], { SHELL: "/bin/zsh" });
    expect(status).toBe(0);
    // zsh-specific marker that would NOT appear in the bash hook
    expect(stdout).toContain("add-zsh-hook");
  });

  test("no args with SHELL=/bin/bash produces bash hook", () => {
    const { status, stdout } = cue(["watch"], { SHELL: "/bin/bash" });
    expect(status).toBe(0);
    // bash-specific marker that would NOT appear in the zsh hook
    expect(stdout).toContain("alias cd=");
  });

  test("bash and zsh hooks both emit printf notifications on profile switch", () => {
    const { stdout: bash } = cue(["watch", "bash"]);
    const { stdout: zsh } = cue(["watch", "zsh"]);
    expect(bash).toContain("printf");
    expect(zsh).toContain("printf");
  });
});
