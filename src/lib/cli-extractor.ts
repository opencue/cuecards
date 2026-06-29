/**
 * Extract required-CLI list for a profile by parsing every skill's frontmatter
 * `allowed-tools:`, Prerequisites section, and name. Delegates the actual
 * single-skill parsing to commands/optimizer.ts (where the original logic
 * already lives) so the two paths stay in lockstep.
 *
 * Glob entries like the "every skill" wildcard expand to every skill on disk
 * — mirrors what the materializer / optimizer panel does so `cue cli list
 * full` actually sees the underlying skills rather than returning 0.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { loadProfile } from "./profile-loader";
import { extractCLIsFromSkill } from "../commands/optimizer";
import { repoRoot } from "./repo-root";

const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");
const HOME_SKILLS = join(homedir(), ".claude", "skills");

export interface CliRequirement {
  cli: string;
  skills: string[];
}

/** Expand wildcard ids (containing `*`) to concrete skill ids on disk. */
function expandGlob(id: string): string[] {
  if (!id.includes("*")) return [id];
  const out: string[] = [];
  try {
    for (const cat of readdirSync(SKILLS_ROOT)) {
      const catPath = join(SKILLS_ROOT, cat);
      try {
        for (const skill of readdirSync(catPath)) {
          if (existsSync(join(catPath, skill, "SKILL.md"))) {
            out.push(`${cat}/${skill}`);
          }
        }
      } catch {}
    }
  } catch {}
  try {
    for (const skill of readdirSync(HOME_SKILLS)) {
      if (!out.some((e) => e.endsWith(`/${skill}`))) out.push(skill);
    }
  } catch {}
  return out;
}

export async function requiredClisFor(profileName: string): Promise<CliRequirement[]> {
  const profile = await loadProfile(profileName);
  const byCli = new Map<string, string[]>();
  const add = (cli: string, skillId: string) => {
    const list = byCli.get(cli) ?? [];
    list.push(skillId);
    byCli.set(cli, list);
  };

  for (const skill of profile.skills.local) {
    for (const id of expandGlob(skill.id)) {
      const slug = id.split("/").pop() ?? id;
      for (const cli of extractCLIsFromSkill(slug)) add(cli, id);
    }
  }
  for (const entry of profile.skills.npx) {
    for (const slug of entry.skills) {
      for (const cli of extractCLIsFromSkill(slug)) add(cli, `${entry.repo}:${slug}`);
    }
  }

  return [...byCli.entries()]
    .map(([cli, skills]) => ({ cli, skills }))
    .sort((a, b) => b.skills.length - a.skills.length);
}
