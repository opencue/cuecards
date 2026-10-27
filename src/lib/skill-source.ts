/**
 * skill-source.ts — skill traceability and completeness helpers.
 *
 * Provides:
 *   - parseCompanionsField              — SKILL.md frontmatter parser (pure, no network)
 *   - writeSourceFile / readSourceFile  — .source traceability for doctor --fix
 *   - findIncompleteSkills              — doctor D7 check (consumed by doctor.ts and skills.ts)
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// SKILL.md companions field parser
// ---------------------------------------------------------------------------

export function parseCompanionsField(skillMdPath: string): string[] | null {
  if (!existsSync(skillMdPath)) return null;
  try {
    const content = readFileSync(skillMdPath, "utf8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;
    const fm = fmMatch[1]!;

    const arrayMatch = fm.match(/^companions:\s*\[([^\]]*)\]/m);
    if (arrayMatch) {
      return arrayMatch[1]!.split(",").map(s => s.trim().replace(/['"]/g, "")).filter(Boolean);
    }

    const listMatch = fm.match(/^companions:\s*\n((?:\s+-\s+.+\n?)*)/m);
    if (listMatch) {
      return listMatch[1]!
        .split("\n")
        .map(l => l.replace(/^\s+-\s+/, "").trim().replace(/['"]/g, ""))
        .filter(Boolean);
    }
  } catch {}
  return null;
}

// ---------------------------------------------------------------------------
// .source file — traceability for doctor --fix
// ---------------------------------------------------------------------------

export function writeSourceFile(localDir: string, repo: string, skillPath: string, ref?: string): void {
  try {
    const content = `${repo}::${skillPath}${ref && ref !== "HEAD" ? `@${ref}` : ""}`;
    writeFileSync(join(localDir, ".source"), content);
  } catch {}
}

export function readSourceFile(skillDir: string): { repo: string; skillPath: string; ref?: string } | null {
  const sourceFile = join(skillDir, ".source");
  if (!existsSync(sourceFile)) return null;
  try {
    const raw = readFileSync(sourceFile, "utf8").trim();
    const [repoAndPath, ...rest] = raw.split("@");
    const ref = rest.length > 0 ? rest.join("@") : undefined;
    const [repo, skillPath] = repoAndPath!.split("::");
    if (repo && skillPath) return { repo, skillPath, ref };
  } catch {}
  return null;
}

// ---------------------------------------------------------------------------
// Doctor integration
// ---------------------------------------------------------------------------

export interface IncompleteSkill {
  id: string;
  dir: string;
  declared: string[];
  missing: string[];
}

export function findIncompleteSkills(skillsRoot: string): IncompleteSkill[] {
  const incomplete: IncompleteSkill[] = [];
  if (!existsSync(skillsRoot)) return incomplete;

  const categories = readdirSync(skillsRoot, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith("."));

  for (const cat of categories) {
    const catDir = join(skillsRoot, cat.name);
    const skills = readdirSync(catDir, { withFileTypes: true }).filter(d => d.isDirectory());

    for (const skill of skills) {
      const skillDir = join(catDir, skill.name);
      const skillMd = join(skillDir, "SKILL.md");
      const companions = parseCompanionsField(skillMd);
      if (!companions || companions.length === 0) continue;

      const missing = companions.filter(c => {
        const name = c.replace(/\/$/, "");
        return !existsSync(join(skillDir, name));
      });

      if (missing.length > 0) {
        incomplete.push({ id: `${cat.name}/${skill.name}`, dir: skillDir, declared: companions, missing });
      }
    }
  }
  return incomplete;
}
