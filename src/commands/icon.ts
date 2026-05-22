/**
 * `cue icon [profile]` — pick an emoji icon for a profile.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as p from "@clack/prompts";

import { resolveProfileForCwd } from "../lib/cwd-resolver";
import { loadProfile } from "../lib/profile-loader";
import { homedir } from "node:os";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const ICONS = [
  "🐻", "🦋", "🦜", "🦉", "🐺", "🦚", "🐝", "🐆", "🐢", "🦄",
  "🦊", "🐙", "🐬", "🦔", "🐇", "🐛", "🤖", "🐍", "🦀", "🐋",
  "🦈", "🐊", "🦅", "🐎", "🦁", "🐘",
];

function configDir(): string {
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "cue")
    : join(homedir(), ".config", "cue");
}

export async function run(args: string[]): Promise<number> {
  const profileName = args[0] ?? await resolveCurrentProfile();
  if (!profileName) {
    process.stderr.write("cue icon: no profile resolved for cwd; pass a profile name\n");
    return 1;
  }

  const profilesDir = process.env.CUE_PROFILES_DIR ?? process.env.SOUL_PROFILES_DIR ?? join(REPO_ROOT, "profiles");
  const yamlPath = join(profilesDir, profileName, "profile.yaml");

  let text: string;
  try {
    text = await readFile(yamlPath, "utf8");
  } catch {
    process.stderr.write(`cue icon: profile "${profileName}" not found\n`);
    return 1;
  }

  p.intro(`cue icon · ${profileName}`);

  const choice = await p.select({
    message: "Pick an icon",
    options: ICONS.map((icon) => ({ value: icon, label: icon })),
  });

  if (p.isCancel(choice)) {
    p.cancel("cancelled");
    return 130;
  }

  // Write icon to profile.yaml — insert after name: line or replace existing icon: line
  const lines = text.split("\n");
  const out: string[] = [];
  let inserted = false;
  for (const line of lines) {
    if (line.match(/^icon:\s/)) {
      out.push(`icon: "${choice}"`);
      inserted = true;
    } else {
      out.push(line);
      if (!inserted && line.match(/^name:\s/)) {
        out.push(`icon: "${choice}"`);
        inserted = true;
      }
    }
  }

  await writeFile(yamlPath, out.join("\n"));

  // Mention iconImage if the profile also has one configured
  try {
    const loaded = await loadProfile(profileName);
    if (loaded.iconImage) {
      p.log.info(`Profile also has iconImage: "${loaded.iconImage}" (used in Kitty terminals)`);
    }
  } catch { /* non-critical */ }

  p.outro(`${choice} set for ${profileName}`);
  return 0;
}

async function resolveCurrentProfile(): Promise<string | null> {
  const resolved = await resolveProfileForCwd({
    cwd: process.cwd(),
    homeDir: homedir(),
    configDir: configDir(),
    override: null,
  });
  if (resolved.source === "none") return null;
  return (resolved as { profile: string }).profile;
}
