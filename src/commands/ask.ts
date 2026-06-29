/**
 * `cue ask <skill-id>` — show what a skill does (description + summary).
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../lib/repo-root";

const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");

export async function run(args: string[]): Promise<number> {
  const query = args.filter(a => !a.startsWith("-")).join(" ");
  if (!query) {
    process.stderr.write("Usage: cue ask <skill-name>\n");
    process.stderr.write("       cue ask skill-evolution\n");
    process.stderr.write("       cue ask nvidia/cuopt-developer\n");
    return 1;
  }

  // Find the skill
  const slug = query.includes("/") ? query : findSkillBySlug(query);
  if (!slug) {
    process.stderr.write(`Skill "${query}" not found.\n`);
    return 1;
  }

  const skillPath = join(SKILLS_ROOT, slug, "SKILL.md");
  if (!existsSync(skillPath)) {
    process.stderr.write(`Skill "${slug}" not found at ${skillPath}\n`);
    return 1;
  }

  const content = readFileSync(skillPath, "utf8");

  // Parse frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  let description = "";
  let version = "";
  let tags: string[] = [];

  if (fmMatch) {
    const fm = fmMatch[1]!;
    const descMatch = fm.match(/^description:\s*["']?(.+?)["']?\s*$/m);
    if (descMatch) description = descMatch[1]!;
    const verMatch = fm.match(/^version:\s*["']?(.+?)["']?\s*$/m);
    if (verMatch) version = verMatch[1]!;
    const tagsMatch = fm.match(/^tags:\s*\[([^\]]*)\]/m);
    if (tagsMatch) tags = tagsMatch[1]!.split(",").map(t => t.trim().replace(/['"]/g, "")).filter(Boolean);
  }

  // Get first meaningful paragraph after frontmatter
  const body = fmMatch ? content.slice(fmMatch[0].length).trim() : content.trim();
  const lines = body.split("\n");
  let summary = "";
  let inParagraph = false;
  for (const line of lines) {
    if (line.startsWith("#")) {
      if (summary) break; // stop at next heading
      continue;
    }
    if (line.trim() === "") {
      if (inParagraph) break; // end of first paragraph
      continue;
    }
    inParagraph = true;
    summary += (summary ? " " : "") + line.trim();
  }

  // Output
  process.stdout.write(`\n📖 ${slug}\n`);
  if (version) process.stdout.write(`   v${version}\n`);
  process.stdout.write("\n");

  if (description) {
    process.stdout.write(`   ${description}\n\n`);
  }

  if (summary && summary !== description) {
    process.stdout.write(`   ${summary.slice(0, 200)}${summary.length > 200 ? "..." : ""}\n\n`);
  }

  if (tags.length) {
    process.stdout.write(`   Tags: ${tags.join(", ")}\n`);
  }

  // Token cost
  const tokens = Math.ceil(content.length / 4);
  process.stdout.write(`   Size: ${tokens} tokens (${content.split("\n").length} lines)\n`);
  process.stdout.write(`   Path: ${skillPath}\n\n`);

  return 0;
}

function findSkillBySlug(slug: string): string | null {
  try {
    for (const cat of readdirSync(SKILLS_ROOT)) {
      const catPath = join(SKILLS_ROOT, cat);
      try {
        if (existsSync(join(catPath, slug, "SKILL.md"))) {
          return `${cat}/${slug}`;
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return null;
}
