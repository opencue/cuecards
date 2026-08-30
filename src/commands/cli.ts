/**
 * `cue cli list [profile]`              — show required CLIs + install status
 * `cue cli install <tool>`              — install one tool via the right pkg manager
 * `cue cli install --all [profile]`     — install every missing tool the active
 *                                          profile needs (skips manual-install ones)
 *
 * Flags:
 *   --dry-run  (default)  print what would run, don't execute
 *   --yes                 actually execute (still prompts for sudo via the cmd itself)
 *   --json                machine output
 *
 * OS detection: linux + which package manager is present (apt > dnf > pacman);
 * macOS uses brew; Windows uses winget. Falls back to manual hints when the
 * recipe doesn't declare the needed mode.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

import { resolveProfileForCwd } from "../lib/cwd-resolver";
import { requiredClisFor } from "../lib/cli-extractor";
import { listProfiles } from "../lib/profile-loader";
import { repoRoot } from "../lib/repo-root";

const RECIPES_PATH = join(repoRoot(), "resources", "cli-recipes.json");

type Recipe = Partial<Record<"apt" | "brew" | "dnf" | "pacman" | "snap" | "winget" | "pip" | "pipx" | "npm" | "script" | "manual" | "needs", string>>;

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function which(cmd: string): boolean {
  return spawnSync("which", [cmd], { stdio: "ignore", timeout: 1000 }).status === 0;
}

function readRecipes(): Record<string, Recipe> {
  try {
    const raw = JSON.parse(readFileSync(RECIPES_PATH, "utf8")) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(raw).filter(([, v]) => v && typeof v === "object" && !Array.isArray(v)),
    ) as Record<string, Recipe>;
  }
  catch { return {}; }
}

/**
 * Pick the best install command for the current OS.
 * Returns the shell command to run, or { manual: hint } when nothing works.
 */
interface InstallPlan {
  cli: string;
  mode: "apt" | "brew" | "dnf" | "pacman" | "snap" | "winget" | "pip" | "pipx" | "npm" | "script" | "manual" | "unknown";
  command?: string;
  argv?: string[];
  hint?: string;
  needs?: string;
}

function shellDisplay(argv: string[]): string {
  return argv.map((part) => /^[a-zA-Z0-9_./:@%+=,-]+$/.test(part) ? part : JSON.stringify(part)).join(" ");
}

function planInstall(cli: string, recipe: Recipe | undefined, opts: { allowScripts?: boolean } = {}): InstallPlan {
  if (!recipe) return { cli, mode: "unknown", hint: `no recipe for "${cli}" in resources/cli-recipes.json` };
  const os = platform();
  const tries: Array<[InstallPlan["mode"], string[]]> = [];
  const words = (s: string) => s.split(/\s+/).filter(Boolean);
  if (os === "linux") {
    if (recipe.apt && which("apt"))       tries.push(["apt",    ["sudo", "apt", "install", "-y", ...words(recipe.apt)]]);
    if (recipe.dnf && which("dnf"))       tries.push(["dnf",    ["sudo", "dnf", "install", "-y", ...words(recipe.dnf)]]);
    if (recipe.pacman && which("pacman")) tries.push(["pacman", ["sudo", "pacman", "-S", "--noconfirm", ...words(recipe.pacman)]]);
    // snap as a fallback for tools that aren't in distro repos (helm, terraform, etc.)
    if (recipe.snap && which("snap")) {
      const classic = recipe.snap.includes("--classic") ? "" : " --classic";
      const pkg = recipe.snap.replace(/--classic\s*/, "").trim();
      tries.push(["snap", ["sudo", "snap", "install", pkg, ...words(classic)]]);
    }
  } else if (os === "darwin") {
    if (recipe.brew && which("brew"))     tries.push(["brew",   ["brew", "install", ...words(recipe.brew)]]);
  } else if (os === "win32") {
    if (recipe.winget && which("winget")) tries.push(["winget", ["winget", "install", "--id", recipe.winget, "-e"]]);
  }
  // Cross-platform language pkg managers as fallback.
  // For Python packages: prefer pipx (isolated, ships its own pip), then pip3
  // direct binary, then python3 -m pip. Some distros (Nix, some minimal Linux
  // installs) ship python3 without the pip module, so `python3 -m pip` fails
  // even when pip3 works fine. Auto-promote `pip` recipes to pipx when pipx is
  // available — most pip recipes here are CLI tools, which is exactly what
  // pipx is designed for.
  if (recipe.pipx && which("pipx")) {
    tries.push(["pipx", ["pipx", "install", ...words(recipe.pipx)]]);
  } else if (recipe.pip) {
    if (which("pipx"))     tries.push(["pipx", ["pipx", "install", ...words(recipe.pip)]]);
    else if (which("pip3")) tries.push(["pip",  ["pip3", "install", "--user", ...words(recipe.pip)]]);
    else                    tries.push(["pip",  ["python3", "-m", "pip", "install", "--user", ...words(recipe.pip)]]);
  }
  if (recipe.npm && which("npm"))    tries.push(["npm",  ["npm", "install", "-g", ...words(recipe.npm)]]);
  if (recipe.script && opts.allowScripts) tries.push(["script", ["bash", "-c", recipe.script]]);

  if (tries.length === 0) {
    const manual = recipe.manual ?? (recipe.script
      ? `script installer requires --allow-scripts: ${recipe.script}`
      : `no installer for this OS/recipe`);
    return { cli, mode: "manual", hint: manual, needs: recipe.needs };
  }
  const [mode, argv] = tries[0]!;
  return { cli, mode, argv, command: shellDisplay(argv), needs: recipe.needs };
}

async function resolveProfileArg(args: string[]): Promise<string | undefined> {
  const arg = args.find((a) => !a.startsWith("-"));
  if (arg) return arg;
  try {
    const r = await resolveProfileForCwd({ cwd: process.cwd(), homeDir: homedir(), configDir: join(homedir(), ".config", "cue") });
    if (r.source !== "none") return (r as any).profile;
  } catch {}
  return undefined;
}

async function listAllProfilesCmd(args: string[]): Promise<number> {
  const asJson = args.includes("--json");
  const missingOnly = args.includes("--missing-only");
  const recipes = readRecipes();

  // Aggregate: which profiles need each CLI?
  const byCli = new Map<string, { profiles: Set<string>; skillCount: number }>();
  const names = await listProfiles();
  for (const name of names) {
    try {
      const reqs = await requiredClisFor(name);
      for (const r of reqs) {
        const entry = byCli.get(r.cli) ?? { profiles: new Set(), skillCount: 0 };
        entry.profiles.add(name);
        entry.skillCount += r.skills.length;
        byCli.set(r.cli, entry);
      }
    } catch { /* skip broken profile */ }
  }

  let rows = [...byCli.entries()].map(([cli, info]) => ({
    cli,
    installed: which(cli),
    profileCount: info.profiles.size,
    profiles: [...info.profiles].sort(),
    skillCount: info.skillCount,
    plan: planInstall(cli, recipes[cli]),
  }));
  if (missingOnly) rows = rows.filter((r) => !r.installed);
  // Sort: not-installed first (action items), then by # profiles desc.
  rows.sort((a, b) => Number(a.installed) - Number(b.installed) || b.profileCount - a.profileCount);

  if (asJson) {
    process.stdout.write(JSON.stringify({ rows }, null, 2) + "\n");
    return 0;
  }

  const totalCli = rows.length;
  const installed = rows.filter((r) => r.installed).length;
  const missing = totalCli - installed;
  process.stdout.write(`\n  ${bold("All profiles")}  ·  ${totalCli} unique CLIs  ·  ${green(`✅ ${installed}`)} · ${red(`❌ ${missing}`)}\n\n`);
  process.stdout.write(`    ${"cli".padEnd(15)}  ${"profiles".padStart(8)}  ${"plan".padEnd(8)}  used by\n`);
  process.stdout.write(`    ${"-".repeat(15)}  ${"-".repeat(8)}  ${"-".repeat(8)}  ${"-".repeat(40)}\n`);
  for (const r of rows) {
    const mark = r.installed ? green("✓") : red("✗");
    const mode = r.installed ? dim("installed")
      : r.plan.mode === "manual" ? yellow("manual")
      : r.plan.mode === "unknown" ? red("none")
      : dim(r.plan.mode);
    const profList = r.profiles.length <= 3
      ? r.profiles.join(", ")
      : `${r.profiles.slice(0, 3).join(", ")} +${r.profiles.length - 3} more`;
    process.stdout.write(`  ${mark} ${r.cli.padEnd(15)}  ${String(r.profileCount).padStart(8)}  ${mode.padEnd(8)}  ${dim(profList)}\n`);
  }
  process.stdout.write(`\n  Filter: ${bold("cue cli list --all-profiles --missing-only")}\n\n`);
  return 0;
}

async function listCmd(args: string[]): Promise<number> {
  if (args.includes("--all-profiles")) return listAllProfilesCmd(args);

  const profile = await resolveProfileArg(args);
  if (!profile) {
    process.stderr.write("Usage: cue cli list [profile] | --all-profiles [--missing-only]\n");
    return 1;
  }
  const asJson = args.includes("--json");
  const reqs = await requiredClisFor(profile);
  const recipes = readRecipes();

  const rows = reqs.map((r) => ({
    cli: r.cli,
    installed: which(r.cli),
    skillCount: r.skills.length,
    plan: planInstall(r.cli, recipes[r.cli]),
  }));

  if (asJson) {
    process.stdout.write(JSON.stringify({ profile, rows }, null, 2) + "\n");
    return 0;
  }

  const installed = rows.filter((r) => r.installed).length;
  const missing = rows.length - installed;
  process.stdout.write(`\n  ${bold(profile)} — ${rows.length} CLIs · ${green(`✅ ${installed}`)} · ${red(`❌ ${missing}`)}\n\n`);
  for (const r of rows) {
    const mark = r.installed ? green("✓") : red("✗");
    const mode = r.installed ? dim("(installed)")
      : r.plan.mode === "manual" ? yellow("manual")
      : r.plan.mode === "unknown" ? red("no recipe")
      : dim(`→ ${r.plan.mode}`);
    process.stdout.write(`    ${mark} ${r.cli.padEnd(15)}  ${String(r.skillCount).padStart(3)} skills  ${mode}\n`);
  }
  process.stdout.write(`\n  Run ${bold("cue cli install --all")} to install the auto-installable ones.\n\n`);
  return 0;
}

async function installCmd(args: string[]): Promise<number> {
  const all = args.includes("--all");
  const yes = args.includes("--yes");
  const allowScripts = args.includes("--allow-scripts");
  const dryRun = !yes;
  const asJson = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("-"));
  const recipes = readRecipes();

  let targets: string[] = [];
  if (all) {
    const profile = await resolveProfileArg(positional);
    if (!profile) {
      process.stderr.write("Usage: cue cli install --all [profile]\n");
      return 1;
    }
    const reqs = await requiredClisFor(profile);
    targets = reqs.filter((r) => !which(r.cli)).map((r) => r.cli);
  } else {
    if (positional.length === 0) {
      process.stderr.write("Usage: cue cli install <tool> | --all [profile]\n");
      return 1;
    }
    targets = positional;
  }

  if (targets.length === 0) {
    process.stdout.write(`  ${green("All required CLIs are already installed.")}\n`);
    return 0;
  }

  const plans = targets.map((cli) => planInstall(cli, recipes[cli], { allowScripts }));
  const installable = plans.filter((p) => p.command);
  const manual = plans.filter((p) => !p.command);

  if (asJson) {
    process.stdout.write(JSON.stringify({ dryRun, plans }, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(`\n  ${bold(`${installable.length} installable`)}  ·  ${yellow(`${manual.length} manual`)}\n\n`);

  if (installable.length > 0) {
    process.stdout.write(`  ${bold("Install plan")} ${dryRun ? dim("(dry-run — pass --yes to execute)") : ""}\n`);
    for (const p of installable) {
      process.stdout.write(`    ${green("•")} ${p.cli.padEnd(15)}  ${dim(`(${p.mode})`)}  ${p.command}\n`);
      if (p.needs) process.stdout.write(`      ${dim("note: " + p.needs)}\n`);
    }
    process.stdout.write("\n");
  }

  if (manual.length > 0) {
    process.stdout.write(`  ${bold("Manual (skipping)")}\n`);
    for (const p of manual) {
      process.stdout.write(`    ${yellow("•")} ${p.cli.padEnd(15)}  ${p.hint ?? ""}\n`);
    }
    process.stdout.write("\n");
  }

  if (dryRun) return 0;

  // Execute installable plans sequentially. sudo will prompt as needed.
  let failed = 0;
  for (const p of installable) {
    process.stdout.write(`\n  ${bold(`→ Installing ${p.cli}`)}\n  ${dim("$ " + p.command)}\n`);
    const argv = p.argv!;
    const res = spawnSync(argv[0]!, argv.slice(1), { stdio: "inherit" });
    if (res.status !== 0) {
      process.stdout.write(`  ${red(`✗ ${p.cli} install failed (exit ${res.status})`)}\n`);
      failed++;
    } else {
      process.stdout.write(`  ${green(`✓ ${p.cli} installed`)}\n`);
    }
  }
  if (failed > 0) {
    process.stdout.write(`\n  ${red(`${failed} install(s) failed.`)}\n`);
    return 1;
  }
  process.stdout.write(`\n  ${green(`${installable.length} installed.`)}\n`);
  return 0;
}

export async function run(args: string[]): Promise<number> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "list":    return listCmd(rest);
    case "install": return installCmd(rest);
    default:
      process.stderr.write("Usage: cue cli <list|install> [args]\n");
      process.stderr.write("  cue cli list [profile]\n");
      process.stderr.write("  cue cli install <tool>\n");
      process.stderr.write("  cue cli install --all [profile] [--yes] [--json]\n");
      process.stderr.write("  cue cli install --all [profile] [--yes] [--allow-scripts]\n");
      return sub ? 1 : 0;
  }
}
