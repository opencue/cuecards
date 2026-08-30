/**
 * `cue snapshot` — export the current effective profile as portable YAML.
 * `cue snapshot restore <file>` — recreate the flattened profile.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Profile, ResolvedProfile } from "../../profiles/_types";
import { resolveActiveProfile } from "../lib/cwd-resolver";
import { validateProfileName } from "../lib/profile-generator";
import { loadProfile } from "../lib/profile-loader";
import { profilesDir, repoRoot } from "../lib/repo-root";

interface SnapshotDocument {
  _snapshot: {
    created: string;
    profile: string;
    inheritanceChain: string[];
    agents: string[];
    cue_version: string;
    cwd: string;
  };
  profile: Profile;
}

function cueVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot(), "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function flattenedProfileName(name: string): string {
  const flattened = name.replaceAll("+", "-");
  return validateProfileName(flattened) ? flattened : "restored-profile";
}

/** Convert the resolved profile into a schema-valid, inheritance-free profile. */
export function snapshotProfile(profile: ResolvedProfile): Profile {
  return {
    name: flattenedProfileName(profile.name),
    description: profile.description,
    icon: profile.icon,
    iconImage: profile.iconImage,
    model: profile.model,
    mcpPrune: profile.mcpPrune,
    contextWindow: profile.contextWindow,
    bundles: profile.bundles ? [...profile.bundles] : undefined,
    agents: [...profile.agents],
    recommends: [...profile.recommends],
    autoSelect: [...profile.autoSelect],
    conflicts: [...profile.conflicts],
    skills: {
      local: profile.skills.local.map((skill) => ({ ...skill })),
      npx: profile.skills.npx.map((ref) => ({
        ...ref,
        skills: [...ref.skills],
        agents: ref.agents ? [...ref.agents] : undefined,
      })),
    },
    mcps: profile.mcps.map((mcp) => ({ ...mcp })),
    plugins: profile.plugins.map((plugin) => ({ ...plugin })),
    env: { ...profile.env },
    codex_config: { ...profile.codexConfig },
    rules: [...profile.rules],
    commands: [...profile.commands],
    hooks: [...profile.hooks],
    subagents: [...profile.subagents],
    persona: profile.persona,
    persona_includes: [...profile.personaIncludes],
    playbooks: [...profile.playbooks],
    qualityGates: [...profile.qualityGates],
    codex: profile.codex ? { ...profile.codex } : undefined,
    evals: [...profile.evals],
    persona_routing: profile.personaRouting.map((entry) => ({ ...entry })),
  };
}

export async function run(args: string[]): Promise<number> {
  if (args[0] === "restore") return cmdRestore(args.slice(1));
  return cmdSnapshot(args);
}

async function cmdSnapshot(args: string[]): Promise<number> {
  const outputIdx = args.indexOf("--output");
  if (outputIdx >= 0 && !args[outputIdx + 1]) {
    process.stderr.write("Usage: cue snapshot [--output <file.yaml>]\n");
    return 1;
  }
  const outputPath = outputIdx >= 0 ? args[outputIdx + 1]! : null;

  const profileName = await resolveActiveProfile();
  if (!profileName) {
    process.stderr.write("No active profile. Pin one with `echo <name> > .cue.profile`\n");
    return 1;
  }

  const profile = await loadProfile(profileName);
  const snapshot: SnapshotDocument = {
    _snapshot: {
      created: new Date().toISOString(),
      profile: profileName,
      inheritanceChain: [...profile.inheritanceChain],
      agents: [...profile.agents],
      cue_version: cueVersion(),
      cwd: process.cwd(),
    },
    profile: snapshotProfile(profile),
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
  let snapshot: unknown;
  try {
    snapshot = yaml.parse(readFileSync(file, "utf8"));
  } catch (err) {
    process.stderr.write(`Invalid snapshot: ${err}\n`);
    return 1;
  }

  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    !("profile" in snapshot) ||
    !snapshot.profile ||
    typeof snapshot.profile !== "object"
  ) {
    process.stderr.write("Invalid snapshot: missing profile mapping\n");
    return 1;
  }

  const rawProfile = snapshot.profile as Record<string, unknown>;
  const name = rawProfile.name;
  if (typeof name !== "string" || !validateProfileName(name)) {
    process.stderr.write(
      "Invalid snapshot: profile.name must use lowercase kebab-case\n",
    );
    return 1;
  }

  const profileYaml = {
    ...rawProfile,
    name,
    description:
      typeof rawProfile.description === "string"
        ? rawProfile.description
        : "Restored from snapshot",
  };
  const profileDir = join(profilesDir(), name);
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, "profile.yaml"), yaml.stringify(profileYaml));
  process.stdout.write(`✅ Restored profile "${name}" from snapshot\n`);
  process.stdout.write(`   Pin with: echo ${name} > .cue.profile\n`);
  return 0;
}
