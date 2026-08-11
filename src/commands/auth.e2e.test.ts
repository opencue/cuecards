import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const tempDirs: string[] = [];

function cue(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return Bun.spawnSync([process.execPath, "src/index.ts", ...args], {
    cwd: repoRoot,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function fakeAgentEnv(): Promise<NodeJS.ProcessEnv> {
  const home = await mkdtemp(join(tmpdir(), "cue-auth-e2e-"));
  tempDirs.push(home);
  for (const agent of ["claude", "codex"]) {
    const bin = join(home, agent);
    await writeFile(bin, `#!/bin/sh\necho "${agent}:$*"\n`);
    await chmod(bin, 0o755);
  }
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    PATH: `${home}:${process.env.PATH ?? ""}`,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("cue auth CLI", () => {
  test("is registered and exposes help", () => {
    const result = cue(["auth", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("cue auth [status]");
    expect(result.stdout.toString()).toContain("cue auth repair");
  });

  test("rejects an invalid login target without invoking an agent CLI", () => {
    const result = cue(["auth", "login", "invalid-agent"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("choose claude or codex");
  });

  test("appears in global help", () => {
    const result = cue(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("auth");
    expect(result.stdout.toString()).toContain("agent authentication");
  });

  test("status invokes both real agent authentication checks", async () => {
    const result = cue(["auth", "status"], await fakeAgentEnv());
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("claude:auth status");
    expect(result.stdout.toString()).toContain("codex:login status");
  });

  test("login and logout route the agent-specific arguments", async () => {
    const env = await fakeAgentEnv();
    const claudeLogin = cue(["auth", "login", "claude"], env);
    const codexLogout = cue(["auth", "logout", "codex"], env);
    expect(claudeLogin.exitCode).toBe(0);
    expect(claudeLogin.stdout.toString()).toContain("claude:auth login");
    expect(codexLogout.exitCode).toBe(0);
    expect(codexLogout.stdout.toString()).toContain("codex:logout");
  });
});
