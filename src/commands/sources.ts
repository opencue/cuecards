/**
 * `cue sources` — show GitHub repos that provide skills.
 *
 * Subcommands:
 *   (no args)              — show all installed skill sources
 *   <profile>              — show sources for a specific profile
 *   search <query>         — search GitHub for skill repos to install
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

import { loadProfile, listProfiles } from "../lib/profile-loader";
import { repoRoot } from "../lib/repo-root";

const SKILLS_LOCK = join(homedir(), "skills-lock.json");

interface LockEntry {
  source: string;
  sourceType: string;
  skillPath: string;
  computedHash: string;
}

interface SkillsLock {
  version: number;
  skills: Record<string, LockEntry>;
}

function loadSkillsLock(): SkillsLock {
  if (!existsSync(SKILLS_LOCK)) return { version: 1, skills: {} };
  try { return JSON.parse(readFileSync(SKILLS_LOCK, "utf8")); } catch { return { version: 1, skills: {} }; }
}

interface RepoInfo {
  repo: string;
  url: string;
  skillCount: number;
  type: "npx" | "local";
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

function cmdList(json: boolean): number {
  const lock = loadSkillsLock();

  // Build repo → skill count
  const repoMap = new Map<string, number>();
  for (const info of Object.values(lock.skills)) {
    repoMap.set(info.source, (repoMap.get(info.source) ?? 0) + 1);
  }

  const results: RepoInfo[] = [];

  for (const [repo, count] of [...repoMap.entries()].sort((a, b) => b[1] - a[1])) {
    results.push({ repo, url: `https://github.com/${repo}`, skillCount: count, type: "npx" });
  }

  // Local cue skills
  const localSkillsRoot = join(repoRoot(), "resources", "skills", "skills");
  if (existsSync(localSkillsRoot)) {
    let count = 0;
    try {
      for (const cat of readdirSync(localSkillsRoot)) {
        const catPath = join(localSkillsRoot, cat);
        try {
          count += readdirSync(catPath).filter(f => existsSync(join(catPath, f, "SKILL.md"))).length;
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
    results.push({ repo: "opencue/claude-code-skills (local)", url: "https://github.com/opencue/claude-code-skills", skillCount: count, type: "local" });
  }

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(`Skill Sources (${results.length} repos):\n\n`);
  for (const r of results) {
    const icon = r.type === "local" ? "📁" : "📦";
    process.stdout.write(`  ${icon} ${r.repo}\n`);
    process.stdout.write(`     ${r.url}\n`);
    process.stdout.write(`     ${r.skillCount} skill(s)\n\n`);
  }

  process.stdout.write(`Install more: cue sources search "topic"\n`);
  return 0;
}

async function cmdProfile(profileName: string, json: boolean): Promise<number> {
  const lock = loadSkillsLock();
  let profile;
  try { profile = await loadProfile(profileName); } catch {
    process.stderr.write(`Profile "${profileName}" not found.\n`);
    return 1;
  }

  const profileSkillIds = profile.skills.local.map(s => s.id);
  const localSkills: string[] = [];
  const npxSkills = new Map<string, string[]>();

  for (const id of profileSkillIds) {
    const slug = id.split("/").pop()!;
    if (lock.skills[slug]) {
      const repo = lock.skills[slug].source;
      const list = npxSkills.get(repo) ?? [];
      list.push(id);
      npxSkills.set(repo, list);
    } else {
      localSkills.push(id);
    }
  }

  if (json) {
    process.stdout.write(JSON.stringify({ profile: profileName, local: localSkills, npx: Object.fromEntries(npxSkills) }, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(`Skill sources for "${profileName}":\n\n`);

  if (localSkills.length) {
    process.stdout.write(`  📁 opencue/claude-code-skills (local) — ${localSkills.length} skills\n`);
    for (const s of localSkills.slice(0, 8)) process.stdout.write(`       - ${s}\n`);
    if (localSkills.length > 8) process.stdout.write(`       ... +${localSkills.length - 8} more\n`);
    process.stdout.write("\n");
  }

  for (const [repo, skills] of npxSkills) {
    process.stdout.write(`  📦 ${repo} — ${skills.length} skills\n`);
    process.stdout.write(`     https://github.com/${repo}\n`);
    for (const s of skills.slice(0, 5)) process.stdout.write(`       - ${s}\n`);
    if (skills.length > 5) process.stdout.write(`       ... +${skills.length - 5} more\n`);
    process.stdout.write("\n");
  }

  return 0;
}

async function cmdSearch(query: string, json: boolean): Promise<number> {
  if (!query) {
    process.stderr.write("Usage: cue sources search <query>\n");
    return 1;
  }

  process.stdout.write(`🔍 Searching GitHub for skill repos: "${query}"...\n\n`);

  // Try npx skills find first
  const npxRes = spawnSync("npx", ["skills", "find", query], { encoding: "utf8", timeout: 30000 });
  if (npxRes.status === 0 && npxRes.stdout.trim()) {
    process.stdout.write(npxRes.stdout);
    process.stdout.write("\nInstall with: npx skills add <owner/repo> -a claude-code -y\n");
    return 0;
  }

  // Fallback: try smithery skill search
  const smithRes = spawnSync("smithery", ["skill", "search", query], { encoding: "utf8", timeout: 15000 });
  if (smithRes.status === 0 && smithRes.stdout.trim()) {
    process.stdout.write(smithRes.stdout);
    return 0;
  }

  process.stdout.write(`No skill repos found for "${query}".\n`);
  process.stdout.write(`\nTry browsing:\n`);
  process.stdout.write(`  • https://skills-hub.ai\n`);
  process.stdout.write(`  • https://claudemarketplaces.com/skills\n`);
  process.stdout.write(`  • npx skills find "${query}"\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function run(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const rest = args.filter(a => !a.startsWith("-"));

  // Route
  if (rest[0] === "search") {
    return cmdSearch(rest.slice(1).join(" "), json);
  }

  // If a profile name is given, show sources for that profile
  if (rest[0] && !["--all", "-all"].includes(args[0] ?? "")) {
    // Check if it's a valid profile name
    const profiles = await listProfiles();
    if (profiles.includes(rest[0])) {
      return cmdProfile(rest[0], json);
    }
  }

  // Default: show all sources
  return cmdList(json);
}
