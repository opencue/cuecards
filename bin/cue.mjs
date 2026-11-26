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
const scope = dirname(pkgRoot);
const args = process.argv.slice(2);
const registry = "https://registry.npmjs.org";
const stableVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const readVersion = () => JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")).version;
const isStableVersion = (version) => typeof version === "string" && version.length <= 256 && stableVersion.test(version);
const isInteractive = () => process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY && !process.env.CI;
const hasCustomRoot = process.env.CUE_REPO_ROOT && process.env.CUE_REPO_ROOT !== pkgRoot;

function isNpmPackage() {
  return basename(pkgRoot) === "cue-ai" && basename(scope) === "node_modules" && !existsSync(join(pkgRoot, ".git"));
}

async function findGlobalNpm() {
  // POSIX global npm installs use <prefix>/lib/node_modules. Avoid starting
  // npm at all for the usual local and npx paths.
  if (!isNpmPackage() || (process.platform !== "win32" && basename(dirname(scope)) !== "lib")) return;
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
  return npm;
}

async function withUpdateLock(installed, action) {
  // Serialize updates to this installation, even across different config dirs.
  // A manual npm upgrade also sidesteps a lock left by an uncatchable exit.
  const lock = join(scope, `.cue-ai-${installed}.update-lock`);
  try {
    mkdirSync(lock);
  } catch (error) {
    throw new Error(error.code === "EEXIST"
      ? "This Cue installation is locked for an update. Try again later or update with npm."
      : "Cannot lock this Cue installation. Check its permissions or update with npm.");
  }
  const release = () => { try { rmdirSync(lock); } catch {} };
  process.once("exit", release);
  try {
    return await action();
  } finally {
    process.removeListener("exit", release);
    release();
  }
}

async function checkNpmUpdate(installed) {
  if (!isStableVersion(installed)) throw new Error("The installed Cue version is not a stable release.");
  let latest;
  try {
    const res = await fetch(`${registry}/cue-ai/latest`, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ({ version: latest } = await res.json());
  } catch {
    throw new Error("Could not check the npm registry. Check your connection and try again.");
  }
  if (!isStableVersion(latest)) throw new Error("The npm registry did not return a valid stable Cue version.");
  const before = installed.split(".").map(BigInt);
  const diff = latest.split(".").map((part, i) => BigInt(part) - before[i]).find((part) => part !== 0n);
  return {
    installed,
    latest,
    updateAvailable: diff > 0n,
    releaseNotes: `https://github.com/opencue/cuecards/releases/tag/v${latest}`,
  };
}

async function offerNpmUpdate({ installed, latest }, npm, explicit = false) {
  if (installed !== readVersion()) {
    throw new Error("The installed Cue version changed. Run the update check again.");
  }
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  rl.once("SIGINT", () => { rl.close(); process.exit(130); });
  if (!explicit) process.stderr.write(`\nCue update available: ${installed} → ${latest}\n`);
  const timer = setTimeout(() => rl.close(), 10_000);
  const answer = await new Promise((done) => {
    rl.once("close", () => done(""));
    rl.question(explicit ? `Install Cue ${latest}? [y/N] ` : "Install before continuing? [y/N] ", done);
  });
  clearTimeout(timer);
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) return false;
  if (installed !== readVersion()) {
    throw new Error("The installed Cue version changed. Run the update check again.");
  }

  process.stderr.write(`Updating Cue to ${latest}…\n`);
  // Let npm finish or roll back package writes; limit network retries instead
  // of killing the installer in the middle of the transaction.
  const result = npm([
    "install", "-g", `cue-ai@${latest}`, `--registry=${registry}`, "--ignore-scripts", "--no-audit", "--no-fund",
    "--fetch-timeout=20000", "--fetch-retries=1",
  ]);
  if (result.status === 0 && existsSync(bundle) && readVersion() === latest) {
    process.stderr.write(`Cue updated to ${latest}.${explicit ? "" : " Continuing…"}\n`);
    return true;
  } else {
    const message = "Cue update failed. To retry manually: npm install -g cue-ai";
    if (explicit) throw new Error(message);
    process.stderr.write(`${message}\n`);
    return false;
  }
}

async function runNpmUpdate() {
  const flags = args.slice(1);
  if (flags.some((arg) => arg !== "--check" && arg !== "--json")) {
    throw new Error("Usage: cue update [--check] [--json]");
  }
  const check = flags.includes("--check");
  const json = flags.includes("--json");
  const update = await checkNpmUpdate(readVersion());
  if (!json) {
    process.stdout.write(
      `Installed: ${update.installed}\nLatest: ${update.latest}\nRelease notes: ${update.releaseNotes}\n` +
      (update.updateAvailable ? "" : "No newer npm release.\n"),
    );
  }
  let updated = false;
  if (!check && update.updateAvailable) {
    if (!isInteractive()) throw new Error("Run cue update in a terminal to confirm the install.");
    const npm = await findGlobalNpm();
    if (!npm) throw new Error("This Cue copy is not managed by npm -g. Update it with the package manager that installed it.");
    updated = await withUpdateLock(update.installed, () => offerNpmUpdate(update, npm, true));
  }
  if (json) process.stdout.write(JSON.stringify(check ? update : { ...update, updated }) + "\n");
  return 0;
}

async function maybeUpdate() {
  if (!isInteractive() || process.env.CUE_LAUNCHING || process.env.CUE_NO_UPDATE_CHECK === "1" ||
      hasCustomRoot || ["help", "version", "update"].includes(args[0]) ||
      args.some((arg) => ["--help", "-h", "--version", "-v", "--json"].includes(arg)) ||
      (args[0] === "work" && args.includes("--preview")) ||
      (args[0] === "current" && args.includes("--plan"))) return;

  const cueConfig = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "cue");
  const stamp = join(cueConfig, ".last-update-check");
  const checkedRecently = () => existsSync(stamp) && Date.now() - Number(readFileSync(stamp, "utf8")) < 86_400_000;
  if (checkedRecently()) return;
  const npm = await findGlobalNpm();
  if (!npm) return;
  const installed = readVersion();
  if (!isStableVersion(installed)) return;
  await withUpdateLock(installed, async () => {
    if (checkedRecently() || installed !== readVersion()) return;
    // Throttle attempts even when offline so the interactive start stays responsive.
    mkdirSync(cueConfig, { recursive: true });
    writeFileSync(stamp, String(Date.now()));
    const update = await checkNpmUpdate(installed);
    if (update.updateAvailable) await offerNpmUpdate(update, npm);
  });
}

if (args[0] === "update" && !hasCustomRoot && isNpmPackage() &&
    !args.some((arg) => ["--skills", "--help", "-h"].includes(arg))) {
  // Handle the package update without dispatching the bundle's Git path.
  process.exitCode = await runNpmUpdate().catch((error) => {
    process.stderr.write(`cue update: ${error.message}\n`);
    return 1;
  });
} else {
  // Import only after npm finishes: the selected bundle inherits argv, cwd,
  // and terminal without re-launching the shim or loading the old CLI first.
  await maybeUpdate().catch(() => {});
  if (!existsSync(bundle)) {
    process.stderr.write(
      "cue: dist/cue.js missing. Run `bun run build:bundle` (maintainers) or reinstall the package.\n",
    );
    process.exit(2);
  }
  if (!process.env.CUE_REPO_ROOT) process.env.CUE_REPO_ROOT = pkgRoot;
  await import(pathToFileURL(bundle).href);
}
