/**
 * `cue tree [profile]` — visualize profile inheritance tree.
 */

import { resolve } from "node:path";
import { loadProfile } from "../lib/profile-loader";
import { resolveProfileForCwd } from "../lib/cwd-resolver";
import { detectKittyTerminal, transmitKittyImage, kittyPlaceholderLabel } from "../lib/kitty-image";

export async function run(args: string[]): Promise<number> {
  const json = args.includes("--json");
  let profileName = args.find(a => !a.startsWith("-"));

  if (!profileName) {
    try { profileName = await resolveProfileForCwd(process.cwd()); } catch {
      process.stderr.write("No active profile. Specify one: cue tree <profile>\n");
      return 1;
    }
  }

  const profile = await loadProfile(profileName!);
  const chain = profile.inheritanceChain;
  const kitty = await detectKittyTerminal();
  const profilesRoot = resolve(new URL(import.meta.url).pathname, "..", "..", "..", "profiles");
  let nextImageId = 1;

  function getIcon(p: any, name: string): string {
    if (kitty && p.iconImage && nextImageId <= 255) {
      const imgPath = resolve(profilesRoot, name, p.iconImage);
      const id = nextImageId++;
      transmitKittyImage(imgPath, id, 2, 1);
      return kittyPlaceholderLabel(id, 2, 1);
    }
    return p.icon ?? "";
  }

  if (json) {
    const tree = {
      profile: profileName,
      icon: profile.icon,
      chain,
      skills: profile.skills.local.map(s => s.id),
      mcps: profile.mcps.map(m => m.id),
      plugins: profile.plugins.map(p => p.id),
    };
    process.stdout.write(JSON.stringify(tree, null, 2) + "\n");
    return 0;
  }

  // Build visual tree
  const icon = getIcon(profile, profileName!);
  process.stdout.write(`${icon} ${profileName}\n`);

  // Show inheritance chain (ancestors)
  if (chain.length > 1) {
    for (let i = chain.length - 1; i >= 1; i--) {
      const ancestor = chain[i]!;
      try {
        const ancestorProfile = await loadProfile(ancestor);
        const aIcon = getIcon(ancestorProfile, ancestor);
        const indent = "│   ".repeat(chain.length - 1 - i);
        process.stdout.write(`${indent}└── ${aIcon} ${ancestor}\n`);

        const aSkills = ancestorProfile.skills.local.map(s => s.id);
        const aPlugins = ancestorProfile.plugins.map(p => p.id);
        const aMcps = ancestorProfile.mcps.map(m => m.id);
        const prefix = indent + "    ";

        if (aSkills.length) {
          const display = aSkills.length > 5
            ? aSkills.slice(0, 5).join(", ") + `, +${aSkills.length - 5} more`
            : aSkills.join(", ");
          process.stdout.write(`${prefix}├── skills: ${display}\n`);
        }
        if (aPlugins.length) process.stdout.write(`${prefix}├── plugins: ${aPlugins.join(", ")}\n`);
        if (aMcps.length) process.stdout.write(`${prefix}└── mcps: ${aMcps.join(", ")}\n`);
        if (!aSkills.length && !aPlugins.length && !aMcps.length) {
          process.stdout.write(`${prefix}└── (empty)\n`);
        }
      } catch { /* skip unloadable ancestors */ }
    }
  }

  // Show current profile's own resources (not inherited)
  // To show only what THIS profile adds, we'd need to diff against parent
  // For simplicity, show the full resolved set
  const skills = profile.skills.local.map(s => s.id);
  const plugins = profile.plugins.map(p => p.id);
  const mcps = profile.mcps.map(m => m.id);

  if (skills.length) {
    const display = skills.length > 8
      ? skills.slice(0, 8).join(", ") + `, +${skills.length - 8} more`
      : skills.join(", ");
    process.stdout.write(`├── skills (${skills.length}): ${display}\n`);
  }
  if (mcps.length) process.stdout.write(`├── mcps (${mcps.length}): ${mcps.join(", ")}\n`);
  if (plugins.length) process.stdout.write(`├── plugins: ${plugins.join(", ")}\n`);
  if (Object.keys(profile.env).length) {
    process.stdout.write(`└── env: ${Object.keys(profile.env).join(", ")}\n`);
  }

  return 0;
}
