/**
 * `cue snapshot` — export current effective profile state.
 * `cue restore <file>` — recreate profile from snapshot.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { loadProfile } from "../lib/profile-loader";
import { resolveActiveProfile } from "../lib/cwd-resolver";
import { repoRoot } from "../lib/repo-root";


export async function run(args: string[]): Promise<number> {
  const sub = args[0];

  if (sub === "restore") return cmdRestore(args.slice(1));
  return cmdSnapshot(args);
}

async function cmdSnapshot(args: string[]): Promise<number> {
  const outputIdx = args.indexOf("--output");
  const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : null;

  const profileName = await resolveActiveProfile();
  if (!profileName) {
    process.stderr.write("No active profile. Pin one with `echo <name> > .cue.profile`\n");
    return 1;
  }

  const profile = await loadProfile(profileName);

  const snapshot = {
    _snapshot: {
      created: new Date().toISOString(),
      profile: profileName,
      agent: "claude-code",
      cwd: process.cwd(),
      cue_version: "0.3.0",
    },
    profile: {
      name: profile.name,
      description: profile.description,
      icon: profile.icon,
      inherits: profile.inheritanceChain.length > 1 ? profile.inheritanceChain[0] : undefined,
      skills: { local: profile.skills.local.map(s => s.id) },
      mcps: profile.mcps.map(m => m.id),
      plugins: profile.plugins.map(p => p.id),
      env: profile.env,
    },
  };

  const yaml = require("yaml");
  const output = yaml.stringify(snapshot);

  if (outputPath) {
    writeFileSync(outputPath, output);
    process.stdout.write(`✅ Snapshot written to ${outputPath}\n`);
  } else {
    process.stdout.write(output);
  }
  return 0;
}

async function cmdRestore(args: string[]): Promise<number> {
  const file = args[0];
  if (!file) {
    process.stderr.write("Usage: cue snapshot restore <file.yaml>\n");
    return 1;
  }

  const yaml = require("yaml");
  const content = readFileSync(file, "utf8");
  const snapshot = yaml.parse(content);

  if (!snapshot?.profile?.name) {
    process.stderr.write("Invalid snapshot: missing profile.name\n");
    return 1;
  }

  const profileDir = join(repoRoot(), "profiles", snapshot.profile.name);
  const { mkdirSync } = require("node:fs");
  mkdirSync(profileDir, { recursive: true });

  // Build profile.yaml from snapshot
  const profileYaml: Record<string, unknown> = {
    name: snapshot.profile.name,
    description: snapshot.profile.description || "Restored from snapshot",
  };
  if (snapshot.profile.icon) profileYaml.icon = snapshot.profile.icon;
  if (snapshot.profile.inherits) profileYaml.inherits = snapshot.profile.inherits;
  if (snapshot.profile.skills?.local?.length) {
    profileYaml.skills = { local: snapshot.profile.skills.local };
  }
  if (snapshot.profile.mcps?.length) profileYaml.mcps = snapshot.profile.mcps;
  if (snapshot.profile.plugins?.length) profileYaml.plugins = snapshot.profile.plugins;
  if (snapshot.profile.env && Object.keys(snapshot.profile.env).length) {
    profileYaml.env = snapshot.profile.env;
  }

  writeFileSync(join(profileDir, "profile.yaml"), yaml.stringify(profileYaml));
  process.stdout.write(`✅ Restored profile "${snapshot.profile.name}" from snapshot\n`);
  process.stdout.write(`   Pin with: echo ${snapshot.profile.name} > .cue.profile\n`);
  return 0;
}
