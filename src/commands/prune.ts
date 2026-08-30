/**
 * `cue prune` — actionable cleanup driven by `cue skill-report`.
 *
 * Today supports one mode (`--dead`): rewrites a profile.yaml to drop skills
 * that registered zero hits in the telemetry window. Dry-run by default —
 * `--apply` actually writes the file. Backs up the original to
 * `profile.yaml.bak.<timestamp>` whenever it does write.
 *
 * Usage:
 *   cue prune --dead [--profile <name>] [--since <days>] [--apply]
 */

import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadProfile } from "../lib/profile-loader";
import {
  computeSkillUsage,
  estimateTokenSavings,
  zombieSkills,
} from "../lib/skill-report";
import { isEnabled as telemetryEnabled } from "../lib/telemetry-consent";

const REPO_ROOT = resolve(new URL(import.meta.url).pathname, "..", "..", "..");
const PROFILES_DIR = process.env.CUE_PROFILES_DIR ?? join(REPO_ROOT, "profiles");
const SKILLS_ROOT = join(REPO_ROOT, "resources", "skills", "skills");

interface ParsedArgs {
  dead: boolean;
  profile: string | null;
  sinceDays: number;
  apply: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    dead: false,
    profile: null,
    sinceDays: 30,
    apply: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--dead") out.dead = true;
    else if (a === "--apply") out.apply = true;
    else if (a === "--profile") out.profile = argv[++i] ?? null;
    else if (a === "--since") {
      const v = argv[++i] ?? "30";
      const m = v.match(/^(\d+)\s*d?$/);
      out.sinceDays = m ? Math.max(1, parseInt(m[1]!, 10)) : 30;
    }
  }
  return out;
}

function helpText(): string {
  return [
    "cue prune — drop dead-weight from a profile based on telemetry",
    "",
    "Usage:",
    "  cue prune --dead [--profile <name>] [--since <days>] [--apply]",
    "",
    "Defaults: --since 30. Dry-run unless --apply.",
    "",
    "A skill is considered dead when it's declared in the profile but has zero",
    "hits in the telemetry window. Use `cue skill-report` first to inspect.",
    "",
    "Caveat: round-trips profile.yaml through the yaml parser, so comments and",
    "unusual formatting may not survive. Original is backed up to",
    "profile.yaml.bak.<timestamp> whenever --apply writes.",
    "",
  ].join("\n");
}

function resolveActiveProfile(explicit: string | null): string | null {
  if (explicit) return explicit;
  const pin = join(process.cwd(), ".cue.profile");
  if (existsSync(pin)) {
    try {
      const txt = readFileSync(pin, "utf8").trim().split("\n")[0]?.trim();
      if (txt) return txt;
    } catch { /* ignore */ }
  }
  return process.env.CUE_PROFILE ?? null;
}

/**
 * Surgically remove specific entries from a profile.yaml's `skills.local`
 * list using line-based regex edits. This preserves comments, formatting,
 * and key order — round-tripping via the yaml parser loses all three.
 *
 * Supported source line shapes (per existing profiles):
 *     skills:
 *       local:
 *         - some/skill              # plain string
 *         - some/skill   # trailing comment
 *         - id: some/skill          # object form (preserved as-is unless name matches)
 *
 * Returns the rewritten file content plus the count of lines removed.
 * Returns null when no removable matches were found (caller can skip write).
 */
export function dropSkillsFromYaml(
  source: string,
  toRemove: ReadonlyArray<string>,
): { rewritten: string; removed: number } | null {
  const removeSet = new Set(toRemove);
  const lines = source.split("\n");
  // Find the `skills:` → `local:` block. We only edit inside that block so
  // a profile that happens to mention one of these strings elsewhere
  // (description, persona) doesn't get nuked.
  let skillsStart = -1;
  let localStart = -1;
  let blockIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    if (skillsStart === -1 && /^skills:\s*$/.test(lines[i]!)) {
      skillsStart = i;
      continue;
    }
    if (skillsStart !== -1 && localStart === -1) {
      const m = lines[i]!.match(/^(\s+)local:\s*$/);
      if (m) {
        localStart = i;
        blockIndent = m[1]!.length;
        break;
      }
      if (/^\S/.test(lines[i]!)) { skillsStart = -1; continue; } // left the block
    }
  }
  if (localStart === -1) return null;

  const itemIndent = blockIndent + 2;
  const out: string[] = [];
  let removed = 0;
  let inBlock = true;
  for (let i = 0; i < lines.length; i++) {
    if (i <= localStart) { out.push(lines[i]!); continue; }
    if (!inBlock) { out.push(lines[i]!); continue; }
    const line = lines[i]!;
    // Exit the block when we hit a sibling or shallower key (or EOF).
    if (line.trim().length > 0) {
      const leading = line.match(/^(\s*)/)![1]!.length;
      if (leading <= blockIndent && /^\s*\S/.test(line)) {
        inBlock = false;
        out.push(line);
        continue;
      }
      if (leading !== itemIndent) { out.push(line); continue; }
    } else {
      out.push(line);
      continue;
    }
    // Try plain `- some/skill` first.
    const plain = line.match(/^\s*-\s+([^\s#]+)\s*(?:#.*)?$/);
    if (plain && removeSet.has(plain[1]!)) {
      removed++;
      continue; // drop the line entirely
    }
    // Object form: `- id: some/skill`.
    const obj = line.match(/^\s*-\s+id:\s*([^\s#]+)\s*(?:#.*)?$/);
    if (obj && removeSet.has(obj[1]!)) {
      removed++;
      continue;
    }
    out.push(line);
  }

  if (removed === 0) return null;
  return { rewritten: out.join("\n"), removed };
}

export async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help || (!args.dead)) {
    process.stdout.write(helpText());
    return args.help ? 0 : 1;
  }

  if (!telemetryEnabled()) {
    process.stderr.write(
      "cue prune: telemetry is disabled — no usage data to prune from. Enable with `cue telemetry enable`.\n",
    );
    return 1;
  }

  const profileName = resolveActiveProfile(args.profile);
  if (!profileName) {
    process.stderr.write("cue prune: no profile pinned and --profile not given\n");
    return 1;
  }

  // Composite selectors (`a+b+c`) name a virtual merge — there's no single
  // profile.yaml to rewrite. Require an explicit single-profile target.
  if (profileName.includes("+")) {
    process.stderr.write(
      `cue prune: "${profileName}" is a composite; prune individual parts (e.g. --profile ${profileName.split("+")[0]}).\n`,
    );
    return 1;
  }

  let loaded;
  try {
    loaded = await loadProfile(profileName);
  } catch (err) {
    process.stderr.write(`cue prune: cannot load "${profileName}": ${(err as Error).message}\n`);
    return 1;
  }

  const rows = computeSkillUsage(loaded, { windowDays: args.sinceDays });
  const zombies = zombieSkills(rows);

  if (zombies.length === 0) {
    process.stdout.write(
      `${profileName}: no zombies in the last ${args.sinceDays}d — nothing to prune.\n`,
    );
    return 0;
  }

  // Estimate freed bytes for each zombie when we can find the SKILL.md.
  let knownBytes = 0;
  let knownCount = 0;
  for (const z of zombies) {
    const path = join(SKILLS_ROOT, z, "SKILL.md");
    if (existsSync(path)) {
      try { knownBytes += statSync(path).size; knownCount++; } catch { /* ignore */ }
    }
  }
  const estTokens = knownCount === zombies.length
    ? Math.round(knownBytes / 4)
    : estimateTokenSavings(zombies.length);

  const yamlPath = join(PROFILES_DIR, profileName, "profile.yaml");
  if (!existsSync(yamlPath)) {
    process.stderr.write(`cue prune: ${yamlPath} doesn't exist\n`);
    return 1;
  }
  const original = readFileSync(yamlPath, "utf8");
  const edit = dropSkillsFromYaml(original, zombies);

  process.stdout.write(`Found ${zombies.length} zombie skill(s) in "${profileName}" (~${estTokens.toLocaleString()} tokens):\n`);
  for (const z of zombies.slice(0, 20)) {
    process.stdout.write(`  - ${z}\n`);
  }
  if (zombies.length > 20) {
    process.stdout.write(`  …and ${zombies.length - 20} more\n`);
  }

  if (!edit) {
    process.stdout.write(
      `\nNo matching skill entries found in ${yamlPath} — the zombies may be inherited from a parent profile. Edit the parent instead.\n`,
    );
    return 0;
  }

  if (!args.apply) {
    process.stdout.write(
      `\nDry-run: would remove ${edit.removed} line(s) from ${yamlPath}.\n` +
      `Re-run with --apply to write. Original will back up to profile.yaml.bak.<timestamp>.\n`,
    );
    return 0;
  }

  // Apply: backup + write.
  const stamp = Math.floor(Date.now() / 1000);
  const backup = `${yamlPath}.bak.${stamp}`;
  try {
    copyFileSync(yamlPath, backup);
  } catch (err) {
    process.stderr.write(`cue prune: failed to back up profile: ${(err as Error).message}\n`);
    return 1;
  }
  writeFileSync(yamlPath, edit.rewritten);
  process.stdout.write(
    `\n✓ Removed ${edit.removed} line(s) from ${yamlPath}.\n` +
    `  Backup: ${backup}\n`,
  );
  return 0;
}
