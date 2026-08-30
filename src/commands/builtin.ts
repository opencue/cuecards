/**
 * `cue builtin` — manage built-in skills shared across all profiles.
 *
 * Subcommands:
 *   list              — show built-in skills (from core profile)
 *   add <id>          — add a skill to built-in (core)
 *   remove <id>       — remove a skill from built-in (core)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../lib/repo-root";

const PROFILES_DIR = process.env.CUE_PROFILES_DIR ?? join(repoRoot(), "profiles");
const CORE_YAML = join(PROFILES_DIR, "core", "profile.yaml");

function getCoreSkills(): string[] {
  const content = readFileSync(CORE_YAML, "utf8");
  const matches = content.match(/^\s{4}-\s+(.+)$/gm);
  if (!matches) return [];
  return matches
    .map(l => l.replace(/^\s+-\s+/, "").trim().replace(/['"]/g, ""))
    .filter(s => !s.startsWith("#"));
}

export async function run(args: string[]): Promise<number> {
  const sub = args[0] ?? "list";

  switch (sub) {
    case "list": {
      const skills = getCoreSkills();
      process.stdout.write(`🐢 Built-in skills (shared across ALL profiles):\n\n`);
      for (const s of skills) {
        process.stdout.write(`  • ${s}\n`);
      }
      process.stdout.write(`\n  ${skills.length} skill(s) in core.\n`);
      process.stdout.write(`  Add: cue builtin add <skill-id>\n`);
      process.stdout.write(`  Remove: cue builtin remove <skill-id>\n`);
      return 0;
    }

    case "add": {
      const id = args[1];
      if (!id) { process.stderr.write("Usage: cue builtin add <skill-id>\n"); return 1; }

      const content = readFileSync(CORE_YAML, "utf8");
      if (content.includes(`- ${id}`)) {
        process.stdout.write(`"${id}" is already a built-in skill.\n`);
        return 0;
      }

      // Add after the last skill entry
      const lines = content.split("\n");
      const localIdx = lines.findIndex(l => l.match(/^\s+local:/));
      let insertIdx = localIdx + 1;
      while (insertIdx < lines.length && lines[insertIdx]?.match(/^\s{4}-\s/)) insertIdx++;
      // Insert before the last skill (before caveman section if there's a comment)
      lines.splice(insertIdx, 0, `    - ${id}`);
      writeFileSync(CORE_YAML, lines.join("\n"));

      process.stdout.write(`✅ Added "${id}" to built-in skills.\n`);
      process.stdout.write(`   All profiles now include this skill.\n`);
      return 0;
    }

    case "remove": {
      const id = args[1];
      if (!id) { process.stderr.write("Usage: cue builtin remove <skill-id>\n"); return 1; }

      const content = readFileSync(CORE_YAML, "utf8");
      const lines = content.split("\n");
      const filtered = lines.filter(l => !l.includes(`- ${id}`));

      if (filtered.length === lines.length) {
        process.stderr.write(`"${id}" is not in built-in skills.\n`);
        return 1;
      }

      writeFileSync(CORE_YAML, filtered.join("\n"));
      process.stdout.write(`✅ Removed "${id}" from built-in skills.\n`);
      process.stdout.write(`   No profile will inherit this skill anymore.\n`);
      return 0;
    }

    default:
      process.stderr.write("Usage: cue builtin [list|add|remove] <skill-id>\n");
      return 1;
  }
}
