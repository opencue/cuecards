/**
 * Skill pack resolver — expand pack references into individual skills.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./repo-root";

const PACKS_DIR = join(repoRoot(), "resources", "skill-packs");

export interface SkillPack {
  name: string;
  description: string;
  skills: string[];
  requires_mcps: string[];
  tags: string[];
}

export function loadPack(name: string): SkillPack | null {
  const path = join(PACKS_DIR, `${name}.yaml`);
  if (!existsSync(path)) return null;

  try {
    const content = readFileSync(path, "utf8");
    // Simple YAML parse for our flat structure
    const yaml = require("yaml");
    return yaml.parse(content) as SkillPack;
  } catch {
    return null;
  }
}

export function listPacks(): SkillPack[] {
  if (!existsSync(PACKS_DIR)) return [];
  const packs: SkillPack[] = [];
  try {
    for (const file of readdirSync(PACKS_DIR)) {
      if (!file.endsWith(".yaml")) continue;
      const name = file.replace(/\.yaml$/, "");
      const pack = loadPack(name);
      if (pack) packs.push(pack);
    }
  } catch { /* skip */ }
  return packs;
}

/**
 * Expand pack references into skill IDs and required MCPs.
 */
export function expandPacks(packNames: string[]): { skills: string[]; mcps: string[] } {
  const skills: string[] = [];
  const mcps: string[] = [];

  for (const name of packNames) {
    const pack = loadPack(name);
    if (!pack) {
      process.stderr.write(`Warning: skill pack "${name}" not found\n`);
      continue;
    }
    skills.push(...pack.skills);
    mcps.push(...(pack.requires_mcps ?? []));
  }

  return {
    skills: [...new Set(skills)],
    mcps: [...new Set(mcps)],
  };
}
