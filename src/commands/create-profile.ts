/**
 * `cue create-profile <name>` — create a new profile from a list of skills.
 *
 * Usage:
 *   cue create-profile my-project
 *   cue create-profile my-project --icon "🦊" --description "My project work"
 *   cue create-profile my-project --skills design/ui-ux-pro-max,research/find-skills
 *   cue create-profile my-project --inherits core --pin
 *
 * Designed for both interactive use and invocation from agent skills (e.g.
 * the meta/save-profile skill). All flags are optional; missing values are
 * filled with sensible defaults so the agent can call this without prompting.
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface ParsedArgs {
  name: string | null;
  icon: string;
  description: string;
  inherits: string;
  skills: string[];
  mcps: string[];
  pin: boolean;
  force: boolean;
}

function parse(args: string[]): ParsedArgs {
  const out: ParsedArgs = {
    name: null,
    icon: "🐾",
    description: "Profile created from current session",
    inherits: "core",
    skills: [],
    mcps: [],
    pin: false,
    force: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--icon") out.icon = args[++i] ?? "🐾";
    else if (a === "--description" || a === "--desc") out.description = args[++i] ?? out.description;
    else if (a === "--inherits") out.inherits = args[++i] ?? "core";
    else if (a === "--skills") out.skills = (args[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--mcps") out.mcps = (args[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--pin") out.pin = true;
    else if (a === "--force" || a === "-f") out.force = true;
    else if (!a.startsWith("--") && out.name === null) out.name = a;
  }
  return out;
}

function validateName(name: string): string | null {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(name)) {
    return `invalid profile name "${name}" — must be kebab-case, e.g. "my-project"`;
  }
  return null;
}

function escapeYamlString(s: string): string {
  // Escape double quotes and backslashes; wrap in quotes.
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function renderYaml(args: ParsedArgs): string {
  const lines: string[] = [];
  lines.push(`name: ${args.name}`);
  if (args.icon) lines.push(`icon: ${escapeYamlString(args.icon)}`);
  lines.push(`description: ${escapeYamlString(args.description)}`);
  lines.push(`inherits: ${args.inherits}`);
  lines.push("skills:");
  if (args.skills.length === 0) {
    lines.push("  local: []");
  } else {
    lines.push("  local:");
    for (const s of args.skills) lines.push(`    - ${s}`);
  }
  if (args.mcps.length === 0) {
    lines.push("mcps: []");
  } else {
    lines.push("mcps:");
    for (const m of args.mcps) lines.push(`  - ${m}`);
  }
  return lines.join("\n") + "\n";
}

export async function run(args: string[]): Promise<number> {
  const parsed = parse(args);
  if (!parsed.name) {
    process.stderr.write("cue create-profile: missing profile name\n");
    process.stderr.write("usage: cue create-profile <name> [--icon X] [--description ...] [--skills a,b] [--mcps a,b] [--inherits core] [--pin] [--force]\n");
    return 1;
  }
  const err = validateName(parsed.name);
  if (err) {
    process.stderr.write(`cue create-profile: ${err}\n`);
    return 1;
  }

  const profilesDir = process.env.CUE_PROFILES_DIR ?? join(REPO_ROOT, "profiles");
  const profileDir = join(profilesDir, parsed.name);
  const yamlPath = join(profileDir, "profile.yaml");

  // Reject overwrite unless --force.
  try {
    await access(yamlPath);
    if (!parsed.force) {
      process.stderr.write(`cue create-profile: profile "${parsed.name}" already exists at ${yamlPath} (pass --force to overwrite)\n`);
      return 1;
    }
  } catch { /* doesn't exist — good */ }

  await mkdir(profileDir, { recursive: true });
  await writeFile(yamlPath, renderYaml(parsed));

  if (parsed.pin) {
    await writeFile(join(process.cwd(), ".cue-profile"), `${parsed.name}\n`);
  }

  process.stdout.write(`✓ created ${yamlPath}\n`);
  if (parsed.pin) process.stdout.write(`✓ pinned to ${process.cwd()}/.cue-profile\n`);
  process.stdout.write(`launch with: claude\n`);
  return 0;
}
