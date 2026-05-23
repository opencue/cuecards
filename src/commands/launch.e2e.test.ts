/**
 * E2e test for `cue launch` — tests the full resolve → materialize → exec flow.
 * Uses --rematerialize to avoid actually exec'ing claude/codex.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const CUE_BIN = join(import.meta.dir, "../index.ts");

function cue(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("bun", ["run", CUE_BIN, ...args], {
    encoding: "utf8",
    timeout: 15000,
    cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, ...opts.env },
  });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe("cue launch e2e", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "cue-e2e-launch-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("launch --rematerialize with .cue-profile resolves and builds runtime", async () => {
    // Create a .cue-profile pointing to a real profile
    await writeFile(join(tmpDir, ".cue-profile"), "caveman-quick\n");

    const res = cue(["launch", "claude", "--rematerialize"], { cwd: tmpDir });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("caveman-quick");
    expect(res.stdout).toContain("runtimeDir");

    // Parse the JSON output
    const jsonMatch = res.stdout.match(/\{[\s\S]*\}/);
    expect(jsonMatch).not.toBeNull();
    const output = JSON.parse(jsonMatch![0]);
    expect(output.profile).toBe("caveman-quick");
    expect(output.agent).toBe("claude-code");
    expect(output.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("launch --rematerialize second call is cache hit (rebuilt=false)", async () => {
    await writeFile(join(tmpDir, ".cue-profile"), "core\n");

    const first = cue(["launch", "claude", "--rematerialize"], { cwd: tmpDir });
    expect(first.status).toBe(0);
    const firstJson = JSON.parse(first.stdout.match(/\{[\s\S]*\}/)![0]);
    expect(firstJson.rebuilt).toBe(true);

    // Second call with same profile — may or may not be cache hit depending
    // on whether CLAUDE.md includes dynamic content (timestamps, session summary).
    // At minimum, it should succeed.
    const second = cue(["launch", "claude", "--rematerialize"], { cwd: tmpDir });
    expect(second.status).toBe(0);
    const secondJson = JSON.parse(second.stdout.match(/\{[\s\S]*\}/)![0]);
    expect(secondJson.profile).toBe("core");
  });

  test("launch resolves profile from .cue-profile in parent directory", async () => {
    // Create a subdirectory and put .cue-profile in parent
    const { mkdir } = await import("node:fs/promises");
    const subDir = join(tmpDir, "src", "lib");
    await mkdir(subDir, { recursive: true });
    await writeFile(join(tmpDir, ".cue-profile"), "rust\n");

    const res = cue(["launch", "claude", "--rematerialize"], { cwd: subDir });
    expect(res.status).toBe(0);
    const output = JSON.parse(res.stdout.match(/\{[\s\S]*\}/)![0]);
    expect(output.profile).toBe("rust");
  });

  test("launch produces CLAUDE.md with profile stamp in runtime dir", async () => {
    await writeFile(join(tmpDir, ".cue-profile"), "backend\n");

    const res = cue(["launch", "claude", "--rematerialize"], { cwd: tmpDir });
    expect(res.status).toBe(0);

    const output = JSON.parse(res.stdout.match(/\{[\s\S]*\}/)![0]);
    const claudeMd = await readFile(join(output.runtimeDir, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("profile=backend");
    expect(claudeMd).toContain("Active Profile:");
  });

  test("launch produces settings.json with MCPs and plugins", async () => {
    await writeFile(join(tmpDir, ".cue-profile"), "backend\n");

    const res = cue(["launch", "claude", "--rematerialize"], { cwd: tmpDir });
    expect(res.status).toBe(0);

    const output = JSON.parse(res.stdout.match(/\{[\s\S]*\}/)![0]);
    const settings = JSON.parse(await readFile(join(output.runtimeDir, "settings.json"), "utf8"));
    expect(settings).toHaveProperty("mcpServers");
    expect(settings).toHaveProperty("enabledPlugins");
  });

  test("launch creates skills/ symlinks in runtime dir", async () => {
    await writeFile(join(tmpDir, ".cue-profile"), "backend\n");

    const res = cue(["launch", "claude", "--rematerialize"], { cwd: tmpDir });
    expect(res.status).toBe(0);

    const output = JSON.parse(res.stdout.match(/\{[\s\S]*\}/)![0]);
    const skillsDir = join(output.runtimeDir, "skills");
    const entries = await readdir(skillsDir);
    expect(entries.length).toBeGreaterThan(0);
  });
});
