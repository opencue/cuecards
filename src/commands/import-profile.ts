/**
 * `cue import <source>` — import a profile from URL, file, or org/repo.
 * `cue export <profile> [--output <path>]` — export a profile as portable YAML.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { loadProfile } from "../lib/profile-loader";
import { repoRoot } from "../lib/repo-root";

const PROFILES_DIR = process.env.CUE_PROFILES_DIR ?? join(repoRoot(), "profiles");

export async function run(args: string[]): Promise<number> {
  const sub = args[0];
  if (!sub) {
    process.stderr.write("Usage: cue import <url|file|org/repo>\n       cue export <profile> [--output <path>]\n");
    return 1;
  }

  // Route: if first arg looks like a profile name and --output is present, it's export
  if (args.includes("--output") || sub === "export") {
    return cmdExport(sub === "export" ? args.slice(1) : args);
  }

  return cmdImport(args);
}

async function cmdImport(args: string[]): Promise<number> {
  const source = args[0]!;
  let content: string;

  if (source.startsWith("http://") || source.startsWith("https://")) {
    // Fetch from URL
    try {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      content = await res.text();
    } catch (err) {
      process.stderr.write(`Failed to fetch: ${err}\n`);
      return 1;
    }
  } else if (existsSync(source)) {
    // Local file
    content = readFileSync(source, "utf8");
  } else if (source.match(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/)) {
    // org/repo shorthand → GitHub raw
    const url = `https://raw.githubusercontent.com/${source}/main/profile.yaml`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      content = await res.text();
    } catch (err) {
      process.stderr.write(`Failed to fetch from GitHub (${source}): ${err}\n`);
      return 1;
    }
  } else {
    process.stderr.write(`Cannot resolve source: "${source}"\n`);
    return 1;
  }

  // Parse and validate
  const yaml = require("yaml");
  let profile: Record<string, unknown>;
  try {
    profile = yaml.parse(content);
  } catch (err) {
    process.stderr.write(`Invalid YAML: ${err}\n`);
    return 1;
  }

  const name = profile.name as string;
  if (!name) {
    process.stderr.write("Profile YAML missing 'name' field\n");
    return 1;
  }

  // Write to profiles dir
  const profileDir = join(PROFILES_DIR, name);
  mkdirSync(profileDir, { recursive: true });

  // Strip _portable metadata before writing
  delete profile._portable;
  writeFileSync(join(profileDir, "profile.yaml"), yaml.stringify(profile));

  process.stdout.write(`✅ Imported profile "${name}" to profiles/${name}/\n`);
  process.stdout.write(`   Activate with: cue use ${name}\n`);
  process.stdout.write(`   Pin with: echo ${name} > .cue.profile\n`);
  return 0;
}

async function cmdExport(args: string[]): Promise<number> {
  const profileName = args.find(a => !a.startsWith("-"));
  if (!profileName) {
    process.stderr.write("Usage: cue export <profile> [--output <path>] [--portable]\n");
    return 1;
  }

  const outputIdx = args.indexOf("--output");
  const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : null;
  const portable = args.includes("--portable");

  const profile = await loadProfile(profileName);
  const yaml = require("yaml");

  const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");

  const base: Record<string, unknown> = {
    name: profile.name,
    description: profile.description,
    icon: profile.icon,
    _portable: {
      exported: new Date().toISOString(),
      cue_version: "0.4.1",
      inheritance_resolved: true,
      self_contained: portable,
    },
    skills: { local: profile.skills.local.map(s => s.id) },
    mcps: profile.mcps.map(m => m.id),
    plugins: profile.plugins.map(p => p.id),
    env: profile.env,
  };

  if (portable) {
    // Bundle skill content inline
    const skillContents: Record<string, string> = {};
    for (const s of profile.skills.local) {
      const skillPath = join(SKILLS_ROOT, s.id, "SKILL.md");
      try {
        skillContents[s.id] = readFileSync(skillPath, "utf8");
      } catch { /* skill not on disk — skip */ }
    }
    if (Object.keys(skillContents).length > 0) {
      (base as any)._skill_contents = skillContents;
    }
  }

  const output = yaml.stringify(base);

  if (outputPath) {
    writeFileSync(outputPath, output);
    const size = (Buffer.byteLength(output) / 1024).toFixed(1);
    process.stdout.write(`✅ Exported "${profileName}" to ${outputPath} (${size} KB)\n`);
    if (portable) {
      process.stdout.write(`   Self-contained: includes ${Object.keys((base as any)._skill_contents ?? {}).length} skill(s) inline\n`);
      process.stdout.write(`   Share this file — recipient imports with: cue import ${outputPath}\n`);
    }
  } else {
    process.stdout.write(output);
  }
  return 0;
}
