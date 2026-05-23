/**
 * `cue migrate` — auto-migrate profiles when schema changes.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROFILES_DIR = join(REPO_ROOT, "profiles");
const CURRENT_SCHEMA_VERSION = 2;

interface Migration {
  from: number;
  to: number;
  description: string;
  migrate: (profile: Record<string, any>) => Record<string, any>;
}

const MIGRATIONS: Migration[] = [
  {
    from: 1, to: 2,
    description: "Add explicit schema_version field; normalize skills.local to object format",
    migrate: (profile) => {
      profile.schema_version = 2;
      // Normalize skills.local strings to { id: string } objects
      if (profile.skills?.local) {
        profile.skills.local = profile.skills.local.map((s: any) =>
          typeof s === "string" ? s : s
        );
      }
      return profile;
    },
  },
];

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue migrate — auto-migrate profiles to latest schema

Usage:
  cue migrate              Check which profiles need migration
  cue migrate --apply      Apply migrations
  cue migrate --profile <name>  Migrate specific profile
`);
    return 0;
  }

  const apply = args.includes("--apply");
  const profileIdx = args.indexOf("--profile");
  const targetProfile = profileIdx >= 0 ? args[profileIdx + 1] : null;

  const profiles = targetProfile ? [targetProfile] :
    readdirSync(PROFILES_DIR).filter(d =>
      !d.startsWith("_") && existsSync(join(PROFILES_DIR, d, "profile.yaml"))
    );

  let needsMigration = 0;
  let migrated = 0;

  for (const name of profiles) {
    const yamlPath = join(PROFILES_DIR, name, "profile.yaml");
    if (!existsSync(yamlPath)) continue;

    const content = readFileSync(yamlPath, "utf8");
    const profile = parseYaml(content);
    const version = profile.schema_version ?? 1;

    if (version >= CURRENT_SCHEMA_VERSION) continue;

    needsMigration++;
    const applicable = MIGRATIONS.filter(m => m.from >= version && m.to <= CURRENT_SCHEMA_VERSION);

    if (!apply) {
      process.stdout.write(`  ${name}: v${version} → v${CURRENT_SCHEMA_VERSION} (${applicable.length} migration(s))\n`);
      for (const m of applicable) {
        process.stdout.write(`    • ${m.description}\n`);
      }
    } else {
      let current = profile;
      for (const m of applicable) {
        current = m.migrate(current);
      }
      writeFileSync(yamlPath, stringifyYaml(current));
      migrated++;
      process.stdout.write(`  ✅ ${name}: migrated to v${CURRENT_SCHEMA_VERSION}\n`);
    }
  }

  if (needsMigration === 0) {
    process.stdout.write("  ✅ All profiles are up to date.\n");
  } else if (!apply) {
    process.stdout.write(`\n  ${needsMigration} profile(s) need migration. Run: cue migrate --apply\n`);
  } else {
    process.stdout.write(`\n  ✅ Migrated ${migrated} profile(s).\n`);
  }

  return 0;
}
