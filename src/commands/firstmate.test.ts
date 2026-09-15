import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "cue-firstmate-"));
  dirs.push(dir);
  const repo = join(dir, "firstmate space");
  const bins = join(dir, "bin");
  await mkdir(bins);
  for (const path of ["bin", ".agents/skills", ".claude", ".codex"]) {
    await mkdir(join(repo, path), { recursive: true });
  }
  for (const path of ["AGENTS.md", "CLAUDE.md", "bin/fm-session-start.sh", ".claude/settings.json", ".codex/hooks.json"]) {
    await writeFile(join(repo, path), "fixture\n");
  }
  expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
  const output = join(dir, "agent.json");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: dir,
    XDG_CONFIG_HOME: join(dir, "config"),
    CUE_REPO_ROOT: root,
    CUE_PROFILES_DIR: join(root, "profiles"),
    PATH: bins,
    CAPTURE: output,
    CODEX_HOME: join(dir, "config/cue/runtime/backend/codex"),
    CUE_CANONICAL_CODEX_HOME: join(dir, "canonical-codex"),
    CLAUDE_CONFIG_DIR: join(dir, "claude-account"),
    CUE_REAL_CODEX: "/must-not-launch-omx",
    FM_HOME: "/another-home",
    FM_STATE_OVERRIDE: "/another-state",
    CI: "1",
    TMUX: "",
    TMUX_PANE: "",
  };
  const cli = (args: string[]) => spawnSync(process.execPath, [join(root, "src/index.ts"), "firstmate", ...args], {
    env, encoding: "utf8", timeout: 15_000,
  });
  const agent = async (name: string, tail = "") => {
    await writeFile(join(bins, name), `#!${process.execPath}\n` +
      `await Bun.write(process.env.CAPTURE, JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),env:process.env}));\n${tail}`, { mode: 0o755 });
  };
  return { dir, repo, bins, output, env, cli, agent };
}

describe("cue firstmate", () => {
  test("help is discoverable without downloads or a harness", async () => {
    const f = await fixture();
    const result = f.cli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--agent");
    expect(result.stdout).toContain("--setup");
    expect(result.stdout).toContain("promote");
  });

  test("requires an explicit harness outside a terminal", async () => {
    const f = await fixture();
    const result = f.cli(["--repo", f.repo]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--agent");
  });

  test("rejects invalid options and unsupported harnesses", async () => {
    const f = await fixture();
    for (const args of [["--agent", "shell;bad"], ["--agent"], ["--repo"], ["--wat"],
      ["--setup", "--agent", "codex"], ["--agent", "codex", "--", "--cd=/tmp"]]) {
      expect(f.cli(args).status).toBe(2);
    }
  });

  test("missing checkout never triggers an implicit download", async () => {
    const f = await fixture();
    const result = f.cli(["--repo", join(f.dir, "missing"), "--agent", "codex"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--setup");
  });

  test("rejects an incomplete checkout", async () => {
    const f = await fixture();
    await rm(join(f.repo, "bin/fm-session-start.sh"));
    const result = f.cli(["--repo", f.repo, "--agent", "codex"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Firstmate checkout");
  });

  test.each(["codex", "claude"])("launches %s from Firstmate, not the caller's profile runtime", async name => {
    const f = await fixture();
    await f.agent(name, "process.exit(17);");
    const args = ["--model", "model with spaces", "literal $(touch /nope)"];
    const result = f.cli(["--repo", f.repo, "--agent", name, "--", ...args]);
    expect(result.stderr).toContain("Firstmate");
    expect(result.status).toBe(17);
    const captured = JSON.parse(await readFile(f.output, "utf8"));
    expect(captured.cwd).toBe(f.repo);
    expect(captured.args).toEqual(args);
    expect(captured.env.FM_HOME).toBe(f.repo);
    expect(captured.env.FM_STATE_OVERRIDE).toBeUndefined();
    expect(captured.env.CUE_REAL_CODEX).toBeUndefined();
    expect(captured.env.CUE_BYPASS).toBe("1");
    expect(captured.env.CODEX_HOME).toBe(f.env.CUE_CANONICAL_CODEX_HOME);
    expect(captured.env.CLAUDE_CONFIG_DIR).toBe(f.env.CLAUDE_CONFIG_DIR);
  });

  test("missing harness returns 127 rather than installing packages", async () => {
    const f = await fixture();
    const result = f.cli(["--repo", f.repo, "--agent", "codex"]);
    expect(result.status).toBe(127);
    expect(result.stderr).toContain("codex");
  });

  test("signal termination is not reported as success", async () => {
    const f = await fixture();
    await f.agent("codex", 'process.kill(process.pid, "SIGTERM");');
    expect(f.cli(["--repo", f.repo, "--agent", "codex"]).status).toBe(143);
  });

  test("a legacy Cue shim is not selected as the primary", async () => {
    const f = await fixture();
    await writeFile(join(f.bins, "codex"), '#!/bin/sh\nexec cue launch codex "$@"\n', { mode: 0o755 });
    expect(f.cli(["--repo", f.repo, "--agent", "codex"]).status).toBe(127);
  });

  test("explicit setup clones only the fixed repository with an argv-safe destination", async () => {
    const f = await fixture();
    const target = join(f.dir, "new checkout $(literal)");
    await f.agent("git", `const { cpSync } = await import("node:fs"); cpSync(${JSON.stringify(f.repo)}, process.argv.at(-1), {recursive:true});`);
    const result = f.cli(["--setup", "--repo", target]);
    expect(result.status).toBe(0);
    const captured = JSON.parse(await readFile(f.output, "utf8"));
    expect(captured.args).toEqual(["clone", "--", "https://github.com/NagyVikt/firstmate.git", target]);
    expect(await readFile(join(target, "AGENTS.md"), "utf8")).toBe("fixture\n");
  });

  test("failed setup returns an error without launching a primary", async () => {
    const f = await fixture();
    await f.agent("git", "process.exit(4);");
    const result = f.cli(["--setup", "--repo", join(f.dir, "new")]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("clone failed");
  });

  test("setup preserves an existing checkout and does not launch an agent", async () => {
    const f = await fixture();
    await f.agent("codex");
    const result = f.cli(["--setup", "--repo", f.repo]);
    expect(result.status).toBe(0);
    expect(await readFile(join(f.repo, "AGENTS.md"), "utf8")).toBe("fixture\n");
    expect(await Bun.file(f.output).exists()).toBe(false);
  });

  test("setup refuses an occupied non-Firstmate directory", async () => {
    const f = await fixture();
    const result = f.cli(["--setup", "--repo", f.bins]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Firstmate checkout");
  });

  test("promotion prepares a cooperative handoff without starting a harness or bootstrap", async () => {
    const f = await fixture();
    await f.agent("codex");
    const result = f.cli(["promote", "--repo", f.repo]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("NOT YET ACTIVE");
    expect(result.stdout).toContain("fm-session-start.sh");
    expect(result.stdout).toContain("--accept");
    expect(result.stdout).toContain("higher-priority");
    expect(result.stdout).toContain("foreground");
    expect(result.stdout).toContain("No hooks");
    expect(await Bun.file(f.output).exists()).toBe(false);
    expect(await Bun.file(join(f.repo, "state/.lock")).exists()).toBe(false);
  });

  test("promotion cannot be combined with launch/setup options", async () => {
    const f = await fixture();
    for (const args of [["promote", "--agent", "codex"], ["promote", "--setup"],
      ["promote", "--", "--model", "x"], ["--accept"], ["promote", "unexpected"]]) {
      expect(f.cli(args).status).toBe(2);
    }
  });

  test("acceptance outside tmux fails without starting a replacement", async () => {
    const f = await fixture();
    f.env.TMUX = "";
    f.env.TMUX_PANE = "";
    await f.agent("codex");
    const result = f.cli(["promote", "--accept", "--repo", f.repo]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FIRSTMATE_TMUX_REQUIRED");
    expect(await Bun.file(f.output).exists()).toBe(false);
  });
});
