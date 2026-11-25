import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runCue({
  answer = "y", args = ["launch", "codex", "two words"], isTTY = true,
  latest = "0.12.0", installFails = false, local = false, recent = false, env = {},
}: {
  answer?: string; args?: string[]; isTTY?: boolean; latest?: string;
  installFails?: boolean; local?: boolean; recent?: boolean; env?: Record<string, string>;
} = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "cue-npm-update-")));
  const globalRoot = join(dir, "global");
  const pkg = join(local ? join(dir, "local") : globalRoot, "cue-ai");
  const project = join(dir, "project");
  const config = join(dir, "config");
  const events = join(dir, "events");
  const preload = join(dir, "test-setup.cjs");
  try {
    for (const subdir of [join(pkg, "bin"), join(pkg, "dist"), globalRoot, project]) {
      mkdirSync(subdir, { recursive: true });
    }
    copyFileSync(new URL("../bin/cue.mjs", import.meta.url), join(pkg, "bin", "cue.mjs"));
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ type: "module", version: "0.11.7" }));
    writeFileSync(join(pkg, "dist", "cue.js"), "console.log('old bundle')");
    writeFileSync(events, "");
    if (recent) {
      mkdirSync(join(config, "cue"), { recursive: true });
      writeFileSync(join(config, "cue", ".last-update-check"), String(Date.now()));
    }
    writeFileSync(preload, `
const fs = require("node:fs");
const path = require("node:path");
const { pkg, globalRoot, events, latest, installFails, isTTY } = ${JSON.stringify({
      pkg, globalRoot, events, latest, installFails, isTTY,
    })};
if (isTTY) {
  for (const stream of [process.stdin, process.stdout, process.stderr]) {
    Object.defineProperty(stream, "isTTY", { value: true });
  }
}
const record = (value) => fs.appendFileSync(events, JSON.stringify(value) + "\\n");
globalThis.fetch = async (url) => {
  record(["fetch", url]);
  return new Response(JSON.stringify({ version: latest }));
};
require("node:child_process").spawnSync = (cmd, args) => {
  if (cmd === "cmd.exe") args = args.slice(3);
  record(args);
  if (args[0] === "root") return { status: 0, stdout: globalRoot + "\\n" };
  if (args[0] !== "install" || installFails) return { status: 1 };
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ type: "module", version: latest }));
  fs.writeFileSync(path.join(pkg, "dist", "cue.js"),
    'console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), root: process.env.CUE_REPO_ROOT })); process.exitCode = 7;');
  return { status: 0 };
};
require("node:module").syncBuiltinESMExports();
`);
    const result = Bun.spawnSync(["node", "--require", preload, join(pkg, "bin", "cue.mjs"), ...args], {
      cwd: project,
      env: { ...process.env, CI: "", CUE_LAUNCHING: "", CUE_NO_UPDATE_CHECK: "", CUE_REPO_ROOT: "", XDG_CONFIG_HOME: config, ...env },
      stdin: Buffer.from(answer + "\n"),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 12_000,
    });
    return {
      code: result.exitCode, stdout: result.stdout.toString().trim(), stderr: result.stderr.toString(),
      events: readFileSync(events, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)),
      project, pkg,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("agreeing to update loads the new bundle once, with the original arguments and cwd", () => {
  const result = runCue({ answer: " YES " });
  expect(result.stderr).toContain("0.11.7 → 0.12.0");
  expect(result.code).toBe(7);
  expect(JSON.parse(result.stdout)).toEqual({
    args: ["launch", "codex", "two words"], cwd: result.project, root: result.pkg,
  });
  expect(result.events.map(([command]) => command)).toEqual(["root", "fetch", "install"]);
  expect(result.events[2]).toContain("cue-ai@0.12.0");
});

test("declining or pressing enter continues without installing", () => {
  for (const answer of ["n", ""]) {
    const result = runCue({ answer });
    expect(result.stderr).toContain("[y/N]");
    expect(result.stdout).toBe("old bundle");
    expect(result.events.map(([command]) => command)).toEqual(["root", "fetch"]);
  }
});

test("failed npm install continues with the old bundle", () => {
  const result = runCue({ installFails: true });
  expect(result.stderr).toContain("Cue update failed");
  expect(result.stdout).toBe("old bundle");
  expect(result.code).toBe(0);
});

test("non-interactive, nested, opt-out, cached, and read-only calls do not check", () => {
  for (const flags of [
    { isTTY: false }, { env: { CUE_LAUNCHING: "1" } }, { env: { CI: "true" } },
    { env: { CUE_NO_UPDATE_CHECK: "1" } }, { recent: true },
    { args: ["--version"] }, { args: ["launch", "codex", "--version"] },
    { args: ["current", "--plan"] }, { args: ["list", "--json"] },
  ]) {
    const result = runCue(flags);
    expect(result.stdout).toBe("old bundle");
    expect(result.events).toEqual([]);
  }
});

test("does not offer updates for local installs, downgrades, or invalid registry versions", () => {
  expect(runCue({ local: true }).events).toEqual([["root", "-g"]]);
  for (const latest of ["0.10.3", "0.11.7", "3.4.5; unexpected"]) {
    const result = runCue({ latest });
    expect(result.stderr).not.toContain("[y/N]");
    expect(result.events.map(([command]) => command)).toEqual(["root", "fetch"]);
  }
});
