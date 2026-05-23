/**
 * `cue suggest` — profile recommendations based on usage patterns.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { loadProfile, listProfiles } from "../lib/profile-loader";
import { resolveProfileForCwd } from "../lib/cwd-resolver";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_ROOT = join(REPO_ROOT, "resources", "skills", "skills");

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue suggest — profile recommendations based on your usage

Usage:
  cue suggest              Analyze current profile and suggest improvements
  cue suggest --json       Machine-readable output
`);
    return 0;
  }

  const json = args.includes("--json");
  let profileName: string | undefined;
  try {
    const result = await resolveProfileForCwd({ cwd: process.cwd(), homeDir: homedir(), configDir: join(homedir(), ".config", "cue") });
    if (result.source !== "none") profileName = result.profile;
  } catch {}

  if (!profileName) {
    process.stderr.write("No active profile. Pin one first: cue use <profile>\n");
    return 1;
  }

  const profile = await loadProfile(profileName);
  const skillIds = profile.skills.local.map(s => s.id).filter(s => !s.includes("*"));

  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

  const suggestions: { type: string; message: string; action: string }[] = [];

  // 1. Find unused skills (not referenced in recent sessions)
  const usedSkills = scanRecentUsage(skillIds);
  const unused = skillIds.filter(id => !usedSkills.has(id));
  if (unused.length > 0) {
    suggestions.push({
      type: "remove",
      message: `${unused.length} skill(s) loaded but never used in recent sessions`,
      action: `cue skills remove-from-profile ${unused[0]}`,
    });
  }

  // 2. Find skills used in sessions but NOT in the profile
  const allSkillSlugs = getAllSkillSlugs();
  const missingSkills = findMissingSkills(skillIds, allSkillSlugs);
  if (missingSkills.length > 0) {
    suggestions.push({
      type: "add",
      message: `${missingSkills.length} skill(s) used in sessions but not in your profile`,
      action: `cue skills add-to-profile ${missingSkills[0]}`,
    });
  }

  // 3. Check if a different profile would be a better fit
  const allProfiles = await listProfiles();
  let bestAlt: { name: string; overlap: number } | null = null;
  for (const name of allProfiles) {
    if (name === profileName || name.startsWith("_")) continue;
    try {
      const alt = await loadProfile(name);
      const altSkills = new Set(alt.skills.local.map(s => s.id));
      const overlap = [...usedSkills].filter(s => altSkills.has(s)).length;
      if (!bestAlt || overlap > bestAlt.overlap) bestAlt = { name, overlap };
    } catch {}
  }
  if (bestAlt && bestAlt.overlap > usedSkills.size * 0.8 && bestAlt.name !== profileName) {
    suggestions.push({
      type: "switch",
      message: `Profile "${bestAlt.name}" covers ${bestAlt.overlap}/${usedSkills.size} of your used skills`,
      action: `cue diff --live ${bestAlt.name}`,
    });
  }

  // 4. Token budget warning
  const tokens = skillIds.reduce((sum, id) => {
    try { return sum + Math.ceil(readFileSync(join(SKILLS_ROOT, id, "SKILL.md"), "utf8").length / 4); } catch { return sum; }
  }, 0);
  if (tokens > 30000) {
    suggestions.push({
      type: "optimize",
      message: `Token budget is ${(tokens / 1000).toFixed(0)}k — consider splitting into focused sub-profiles`,
      action: `cue cost --compare`,
    });
  }

  if (json) {
    process.stdout.write(JSON.stringify({ profile: profileName, suggestions }, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(`\n  💡 Suggestions for ${bold(profileName)}\n\n`);

  if (suggestions.length === 0) {
    process.stdout.write(`  ${green("✓")} Profile looks well-optimized. No suggestions.\n\n`);
    return 0;
  }

  for (const s of suggestions) {
    const icon = s.type === "remove" ? "🗑️" : s.type === "add" ? "➕" : s.type === "switch" ? "🔄" : "⚡";
    process.stdout.write(`  ${icon}  ${s.message}\n`);
    process.stdout.write(`     ${dim("→")} ${s.action}\n\n`);
  }

  return 0;
}

function scanRecentUsage(skillIds: string[]): Set<string> {
  const projectsDir = join(homedir(), ".claude", "projects");
  const used = new Set<string>();
  if (!existsSync(projectsDir)) return used;

  const slugs = skillIds.map(id => id.split("/").pop()!);
  try {
    const dirs = readdirSync(projectsDir).filter(d => {
      try { return statSync(join(projectsDir, d)).isDirectory(); } catch { return false; }
    });
    for (const dir of dirs.slice(-10)) { // last 10 project dirs
      const files = readdirSync(join(projectsDir, dir))
        .filter(f => f.endsWith(".jsonl")).sort().slice(-3);
      for (const f of files) {
        try {
          const fd = require("node:fs").openSync(join(projectsDir, dir, f), "r");
          const buf = Buffer.alloc(50_000);
          const n = require("node:fs").readSync(fd, buf, 0, 50_000, 0);
          require("node:fs").closeSync(fd);
          const content = buf.toString("utf8", 0, n);
          for (let i = 0; i < slugs.length; i++) {
            if (content.includes(slugs[i]!)) used.add(skillIds[i]!);
          }
        } catch {}
      }
    }
  } catch {}
  return used;
}

function getAllSkillSlugs(): Set<string> {
  const slugs = new Set<string>();
  try {
    const cats = readdirSync(SKILLS_ROOT, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const cat of cats) {
      const skills = readdirSync(join(SKILLS_ROOT, cat.name), { withFileTypes: true }).filter(d => d.isDirectory());
      for (const s of skills) slugs.add(`${cat.name}/${s.name}`);
    }
  } catch {}
  return slugs;
}

function findMissingSkills(profileSkills: string[], allSlugs: Set<string>): string[] {
  // This is a simplified version — in production you'd scan sessions for skill refs
  // that aren't in the profile. For now, return empty.
  return [];
}
