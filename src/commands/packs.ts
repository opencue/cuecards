/**
 * `cue packs` — manage skill packs.
 *
 * Subcommands:
 *   list              — list available packs
 *   show <name>       — show pack contents
 *   create <name>     — interactive pack creation
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { listPacks, loadPack } from "../lib/pack-resolver";
import { repoRoot } from "../lib/repo-root";

const PACKS_DIR = join(repoRoot(), "resources", "skill-packs");

export async function run(args: string[]): Promise<number> {
  const sub = args[0] ?? "list";
  const json = args.includes("--json");

  switch (sub) {
    case "list": return cmdList(json);
    case "show": return cmdShow(args[1] ?? "", json);
    case "create": return cmdCreate(args.slice(1));
    default:
      process.stderr.write(`Unknown subcommand: ${sub}. Use: list, show, create\n`);
      return 1;
  }
}

function cmdList(json: boolean): number {
  const packs = listPacks();

  if (json) {
    process.stdout.write(JSON.stringify(packs, null, 2) + "\n");
    return 0;
  }

  if (packs.length === 0) {
    process.stdout.write("No skill packs found. Create one with `cue packs create <name>`\n");
    return 0;
  }

  process.stdout.write(`Skill Packs (${packs.length}):\n\n`);
  for (const p of packs) {
    process.stdout.write(`  ${p.name}  (${p.skills.length} skills)\n`);
    process.stdout.write(`    ${p.description}\n\n`);
  }
  return 0;
}

function cmdShow(name: string, json: boolean): number {
  if (!name) {
    process.stderr.write("Usage: cue packs show <name>\n");
    return 1;
  }

  const pack = loadPack(name);
  if (!pack) {
    process.stderr.write(`Pack "${name}" not found\n`);
    return 1;
  }

  if (json) {
    process.stdout.write(JSON.stringify(pack, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(`Pack: ${pack.name}\n`);
  process.stdout.write(`Description: ${pack.description}\n\n`);
  process.stdout.write(`Skills (${pack.skills.length}):\n`);
  for (const s of pack.skills) process.stdout.write(`  - ${s}\n`);
  if (pack.requires_mcps.length) {
    process.stdout.write(`\nRequired MCPs:\n`);
    for (const m of pack.requires_mcps) process.stdout.write(`  - ${m}\n`);
  }
  if (pack.tags.length) {
    process.stdout.write(`\nTags: ${pack.tags.join(", ")}\n`);
  }
  return 0;
}

function cmdCreate(args: string[]): number {
  const name = args.find(a => !a.startsWith("-"));
  if (!name) {
    process.stderr.write("Usage: cue packs create <name> --skills s1,s2 [--mcps m1] [--description text]\n");
    return 1;
  }

  const skillsIdx = args.indexOf("--skills");
  const skills = skillsIdx >= 0 ? (args[skillsIdx + 1] ?? "").split(",").filter(Boolean) : [];
  const mcpsIdx = args.indexOf("--mcps");
  const mcps = mcpsIdx >= 0 ? (args[mcpsIdx + 1] ?? "").split(",").filter(Boolean) : [];
  const descIdx = args.indexOf("--description");
  const description = descIdx >= 0 ? args[descIdx + 1] ?? "" : `Skill pack: ${name}`;

  if (skills.length === 0) {
    process.stderr.write("At least one skill required. Use --skills skill1,skill2\n");
    return 1;
  }

  const yaml = require("yaml");
  const pack = { name, description, skills, requires_mcps: mcps, tags: [] };

  mkdirSync(PACKS_DIR, { recursive: true });
  writeFileSync(join(PACKS_DIR, `${name}.yaml`), yaml.stringify(pack));
  process.stdout.write(`✅ Created skill pack "${name}" with ${skills.length} skills\n`);
  process.stdout.write(`   Use in profile.yaml: packs: [${name}]\n`);
  return 0;
}
