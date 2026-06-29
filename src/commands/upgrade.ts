/**
 * `cue upgrade` — pull new skills/profiles from the registry without a full git pull.
 *
 * Checks the remote registry for updates and shows what's new.
 * With --apply, downloads and installs new skills into profiles.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { repoRoot } from "../lib/repo-root";

const REGISTRY_PATH = join(repoRoot(), "docs", "registry", "index.json");
const REGISTRY_URL = "https://opencue.github.io/cue/registry/index.json";
const UPGRADE_STATE = join(repoRoot(), "profiles", "_cache", "last-upgrade.json");

interface RegistrySkill {
  id: string; name: string; description: string;
  repo: string; path: string; tags: string[];
  requires: string[]; profile: string;
}

interface Registry {
  version: number; updated: string;
  skills: RegistrySkill[];
  mcps: { id: string; name: string; description: string; repo: string; install: string; tags: string[] }[];
}

function fetchRemoteRegistry(): Registry | null {
  const res = spawnSync("curl", ["-sfL", "--max-time", "10", REGISTRY_URL], { encoding: "utf8" });
  if (res.status === 0 && res.stdout) {
    try { return JSON.parse(res.stdout); } catch {}
  }
  return null;
}

function loadLocalRegistry(): Registry | null {
  if (!existsSync(REGISTRY_PATH)) return null;
  try { return JSON.parse(readFileSync(REGISTRY_PATH, "utf8")); } catch { return null; }
}

function loadLastUpgrade(): { updated: string; knownSkills: string[] } | null {
  if (!existsSync(UPGRADE_STATE)) return null;
  try { return JSON.parse(readFileSync(UPGRADE_STATE, "utf8")); } catch { return null; }
}

function saveUpgradeState(registry: Registry): void {
  mkdirSync(dirname(UPGRADE_STATE), { recursive: true });
  writeFileSync(UPGRADE_STATE, JSON.stringify({
    updated: registry.updated,
    knownSkills: registry.skills.map(s => s.id),
  }, null, 2));
}

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue upgrade — check for new skills and profiles in the registry

Usage:
  cue upgrade              Check what's new
  cue upgrade --apply      Download and install new skills
  cue upgrade --sync       Update local registry from remote

Options:
  --apply    Install new skills into their target profiles
  --sync     Update docs/registry/index.json from remote
`);
    return 0;
  }

  const apply = args.includes("--apply");
  const sync = args.includes("--sync");

  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

  // Fetch remote registry
  process.stdout.write("Checking registry for updates...\n");
  const remote = fetchRemoteRegistry();
  const local = loadLocalRegistry();

  if (!remote && !local) {
    process.stderr.write("Cannot reach registry and no local copy exists.\n");
    return 1;
  }

  const registry = remote ?? local!;
  const lastUpgrade = loadLastUpgrade();
  const knownSkills = new Set(lastUpgrade?.knownSkills ?? []);

  // Find new skills
  const newSkills = registry.skills.filter(s => !knownSkills.has(s.id));

  if (sync && remote) {
    writeFileSync(REGISTRY_PATH, JSON.stringify(remote, null, 2) + "\n");
    process.stdout.write(`${green("✓")} Updated local registry (${remote.skills.length} skills, ${remote.mcps.length} MCPs)\n`);
  }

  if (newSkills.length === 0 && knownSkills.size > 0) {
    process.stdout.write(`${green("✓")} Everything up to date. No new skills available.\n`);
    saveUpgradeState(registry);
    return 0;
  }

  if (knownSkills.size === 0) {
    // First run — just save state, don't show everything as "new"
    process.stdout.write(`${green("✓")} Registry indexed: ${registry.skills.length} skills, ${registry.mcps.length} MCPs\n`);
    saveUpgradeState(registry);
    return 0;
  }

  // Show new skills grouped by profile
  process.stdout.write(`\n${bold(`${newSkills.length} new skill(s) available:`)}\n\n`);
  const byProfile = new Map<string, RegistrySkill[]>();
  for (const s of newSkills) {
    const list = byProfile.get(s.profile) ?? [];
    list.push(s);
    byProfile.set(s.profile, list);
  }

  for (const [profile, skills] of byProfile) {
    process.stdout.write(`  ${bold(profile)} profile:\n`);
    for (const s of skills) {
      process.stdout.write(`    + ${s.name} ${dim(`(${s.repo})`)}\n`);
      process.stdout.write(`      ${dim(s.description)}\n`);
    }
    process.stdout.write("\n");
  }

  if (!apply) {
    process.stdout.write(`Run ${bold("cue upgrade --apply")} to install these.\n`);
  } else {
    // Install new skills via npx skills add
    let installed = 0;
    for (const s of newSkills) {
      process.stdout.write(`  Installing ${s.name}...`);
      const res = spawnSync("npx", ["skills", "add", `${s.repo}/${s.path}`, "-a", "claude-code", "-y"], {
        encoding: "utf8", timeout: 30000,
      });
      if (res.status === 0) {
        process.stdout.write(` ${green("✓")}\n`);
        installed++;
      } else {
        process.stdout.write(` ${dim("skipped")}\n`);
      }
    }
    process.stdout.write(`\n${green("✓")} Installed ${installed}/${newSkills.length} new skills.\n`);
  }

  saveUpgradeState(registry);
  return 0;
}
