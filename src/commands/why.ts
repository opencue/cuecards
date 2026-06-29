/**
 * `cue why <resource>` — trace why a skill/MCP/plugin is loaded.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadProfile, listProfiles } from "../lib/profile-loader";
import { resolveActiveProfile } from "../lib/cwd-resolver";
import { repoRoot } from "../lib/repo-root";

const PROFILES_DIR = join(repoRoot(), "profiles");

export async function run(args: string[]): Promise<number> {
  const resource = args.find(a => !a.startsWith("-"));
  const json = args.includes("--json");

  if (!resource) {
    process.stderr.write("Usage: cue why <skill-id|mcp-id|plugin-id>\n");
    return 1;
  }

  const profileName = await resolveActiveProfile();
  if (!profileName) {
    process.stderr.write("No active profile.\n");
    return 1;
  }

  const profile = await loadProfile(profileName);

  // Check skills
  const skillMatch = profile.skills.local.find(s => s.id === resource || s.id.endsWith(`/${resource}`));
  // Check MCPs
  const mcpMatch = profile.mcps.find(m => m.id === resource);
  // Check plugins
  const pluginMatch = profile.plugins.find(p => p.id === resource);

  if (!skillMatch && !mcpMatch && !pluginMatch) {
    process.stderr.write(`Resource "${resource}" is NOT loaded in profile "${profileName}"\n`);
    // Check if it exists anywhere
    const allProfiles = await listProfiles();
    const foundIn: string[] = [];
    for (const name of allProfiles) {
      try {
        const p = await loadProfile(name);
        if (p.skills.local.some(s => s.id === resource || s.id.endsWith(`/${resource}`))) foundIn.push(name);
        if (p.mcps.some(m => m.id === resource)) foundIn.push(name);
        if (p.plugins.some(pl => pl.id === resource)) foundIn.push(name);
      } catch { /* skip */ }
    }
    if (foundIn.length) {
      process.stderr.write(`  It IS available in: ${[...new Set(foundIn)].join(", ")}\n`);
    }
    return 1;
  }

  // Trace origin through inheritance chain
  const chain = profile.inheritanceChain;

  const result: {
    resource: string;
    type: "skill" | "mcp" | "plugin";
    profile: string;
    declaredIn: string;
    inheritanceChain: string[];
    diskPath?: string;
  } = {
    resource,
    type: skillMatch ? "skill" : mcpMatch ? "mcp" : "plugin",
    profile: profileName,
    declaredIn: profileName,
    inheritanceChain: chain,
  };

  // Walk chain to find where it was first declared
  for (const ancestor of [...chain].reverse()) {
    try {
      const yamlPath = join(PROFILES_DIR, ancestor, "profile.yaml");
      const content = readFileSync(yamlPath, "utf8");
      if (content.includes(resource)) {
        result.declaredIn = ancestor;
        break;
      }
    } catch { /* skip */ }
  }

  // Disk path for skills
  if (skillMatch) {
    result.diskPath = join(repoRoot(), "resources", "skills", "skills", skillMatch.id);
  }

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  const typeLabel = result.type.charAt(0).toUpperCase() + result.type.slice(1);
  process.stdout.write(`${typeLabel} "${resource}" is loaded because:\n\n`);
  process.stdout.write(`  Active profile: ${profileName}\n`);
  process.stdout.write(`  Declared in:    ${result.declaredIn}/profile.yaml\n`);
  process.stdout.write(`  Inheritance:    ${chain.join(" → ")}\n`);
  if (result.declaredIn !== profileName) {
    process.stdout.write(`  Origin:         inherited from "${result.declaredIn}"\n`);
  } else {
    process.stdout.write(`  Origin:         direct (not inherited)\n`);
  }
  if (result.diskPath) {
    process.stdout.write(`  Disk path:      ${result.diskPath}\n`);
  }

  return 0;
}
