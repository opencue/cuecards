#!/usr/bin/env node
/**
 * cue — node launcher for the published npm package.
 *
 * Sets CUE_REPO_ROOT to the package root so the bundled CLI resolves its
 * profiles/, resources/, and skills regardless of where npm installed it
 * (the bundle may carry build-machine paths; the env override wins), then
 * runs the prebuilt node bundle.
 *
 * The repo's own dev/shim path uses bin/cue (bash → bun src), not this file.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, rmdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = resolve(pkgRoot, "dist", "cue.js");
if (!existsSync(bundle)) {
  process.stderr.write(
    "cue: dist/cue.js missing. Run `bun run build:bundle` (maintainers) or reinstall the package.\n",
  );
  process.exit(2);
}

const registry = "https://registry.npmjs.org";
const stableVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const readVersion = () => JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")).version;

async function maybeUpdate() {
  const args = process.argv.slice(2);
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stderr.isTTY ||
      process.env.CI || process.env.CUE_LAUNCHING || process.env.CUE_NO_UPDATE_CHECK === "1" ||
      (process.env.CUE_REPO_ROOT && process.env.CUE_REPO_ROOT !== pkgRoot) ||
      ["help", "version"].includes(args[0]) ||
      args.some((arg) => ["--help", "-h", "--version", "-v", "--json"].includes(arg)) ||
      (args[0] === "current" && args.includes("--plan"))) return;

  // POSIX global npm installs use <prefix>/lib/node_modules. Avoid starting
  // npm at all for the usual local and npx paths.
  const scope = dirname(pkgRoot);
  if (process.platform !== "win32" &&
      (basename(scope) !== "node_modules" || basename(dirname(scope)) !== "lib")) return;

  const current = readVersion();
  if (typeof current !== "string" || !stableVersion.test(current)) return;
  const cueConfig = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "cue");
  const stamp = join(cueConfig, ".last-update-check");
  const checkedRecently = () => existsSync(stamp) && Date.now() - Number(readFileSync(stamp, "utf8")) < 86_400_000;
  if (checkedRecently()) return;

  const { spawnSync } = await import("node:child_process");
  function npm(args, timeout) {
    const options = { cwd: dirname(process.execPath), encoding: "utf8", timeout, windowsHide: true };
    // Windows npm is a .cmd file. Only fixed arguments and a validated version enter cmd.exe.
    return process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/c", "npm.cmd", ...args], options)
      : spawnSync("npm", args, options);
  }
  const globalRoot = npm(["root", "-g"], 2_000);
  if (globalRoot.status !== 0 || !globalRoot.stdout.trim() ||
      join(realpathSync(globalRoot.stdout.trim()), "cue-ai") !== pkgRoot) return;

  // Serialize updates to this installation, even across different config dirs.
  // A manual npm upgrade also sidesteps a lock left by an uncatchable exit.
  const lock = join(scope, `.cue-ai-${current}.update-lock`);
  try { mkdirSync(lock); } catch { return; }
  const release = () => { try { rmdirSync(lock); } catch {} };
  process.once("exit", release);
  try {
    if (!checkedRecently() && current === readVersion()) await checkAndUpdate(current, cueConfig, stamp, npm);
  } finally {
    process.removeListener("exit", release);
    release();
  }
}

async function checkAndUpdate(current, cueConfig, stamp, npm) {
  // Throttle attempts even when offline so the interactive start stays responsive.
  mkdirSync(cueConfig, { recursive: true });
  writeFileSync(stamp, String(Date.now()));
  const res = await fetch(`${registry}/cue-ai/latest`, { signal: AbortSignal.timeout(3_000) });
  if (!res.ok) return;
  const { version: latest } = await res.json();
  if (typeof latest !== "string" || !stableVersion.test(latest)) return;
  const before = current.split(".").map(Number);
  const diff = latest.split(".").map((part, i) => Number(part) - before[i]).find((part) => part !== 0);
  if (!(diff > 0)) return;

  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  rl.once("SIGINT", () => { rl.close(); process.exit(130); });
  process.stderr.write(`\nCue update available: ${current} → ${latest}\n`);
  const timer = setTimeout(() => rl.close(), 10_000);
  const answer = await new Promise((done) => {
    rl.once("close", () => done(""));
    rl.question("Install before continuing? [y/N] ", done);
  });
  clearTimeout(timer);
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim()) || current !== readVersion()) return;

  process.stderr.write(`Updating Cue to ${latest}…\n`);
  // Let npm finish or roll back package writes; limit network retries instead
  // of killing the installer in the middle of the transaction.
  const result = npm([
    "install", "-g", `cue-ai@${latest}`, `--registry=${registry}`, "--ignore-scripts", "--no-audit", "--no-fund",
    "--fetch-timeout=20000", "--fetch-retries=1",
  ]);
  if (result.status === 0 && existsSync(bundle) && readVersion() === latest) {
    process.stderr.write(`Cue updated to ${latest}. Continuing…\n`);
  } else {
    process.stderr.write("Cue update failed. To retry manually: npm install -g cue-ai\n");
  }
}

// Import only after npm finishes: the selected bundle inherits this exact argv,
// cwd, and terminal, without re-launching the shim or loading the old CLI first.
await maybeUpdate().catch(() => {});
if (!existsSync(bundle)) {
  process.stderr.write("Cue is missing its CLI bundle. Reinstall with: npm install -g cue-ai\n");
  process.exit(2);
}
if (!process.env.CUE_REPO_ROOT) process.env.CUE_REPO_ROOT = pkgRoot;
await import(pathToFileURL(bundle).href);
