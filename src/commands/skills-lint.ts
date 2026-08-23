/**
 * `cue skills lint [id|--all]` — skill quality checker.
 *
 * Rules:
 *   S1: Description missing or < 10 chars (error)
 *   S2: Body > 5000 tokens (~20KB) (warning)
 *   S3: No examples in body (warning)
 *   S4: Frontmatter missing description field (error)
 *   S5: Duplicate slug across categories (warning; namespaces keep them distinct)
 *   S6: Tags empty (info)
 *   S7: No trigger phrases in description (warning)
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

import { listAllSkillIds } from "../lib/resolver-local";
import { repoRoot } from "../lib/repo-root";

const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");

interface LintIssue {
  code: string;
  severity: "error" | "warning" | "info";
  skill: string;
  message: string;
}

export function parseSkillFrontmatter(frontmatter: string): {
  description: string;
  tags: string[];
} {
  try {
    // Older curated skills sometimes repeat a scalar key (usually `name`).
    // Keep linting their actual metadata instead of treating the whole
    // frontmatter as absent; the last occurrence matches the runtime parser.
    const parsed = parseYaml(frontmatter, { uniqueKeys: false }) as Record<string, unknown> | null;
    return {
      description: typeof parsed?.description === "string" ? parsed.description.trim() : "",
      tags: Array.isArray(parsed?.tags)
        ? parsed.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
    };
  } catch {
    return { description: "", tags: [] };
  }
}

function lintSkill(id: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const path = join(SKILLS_ROOT, id, "SKILL.md");

  if (!existsSync(path)) {
    issues.push({ code: "S0", severity: "error", skill: id, message: "SKILL.md not found" });
    return issues;
  }

  const content = readFileSync(path, "utf8");
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);

  // S4: Frontmatter missing
  if (!fmMatch) {
    issues.push({ code: "S4", severity: "error", skill: id, message: "No YAML frontmatter found" });
  } else {
    const fm = fmMatch[1]!;
    const metadata = parseSkillFrontmatter(fm);

    // S1: Description quality
    if (metadata.description.length < 10) {
      issues.push({ code: "S1", severity: "error", skill: id, message: "Description missing or too short (< 10 chars)" });
    }

    // S7: No trigger phrases
    if (metadata.description) {
      const desc = metadata.description.toLowerCase();
      const hasTrigger = /when|if user|asks?|request|says?|wants?/.test(desc);
      if (!hasTrigger) {
        issues.push({ code: "S7", severity: "warning", skill: id, message: "Description lacks trigger phrases (when/if user asks/says)" });
      }
    }

    // S6: Tags empty
    if (metadata.tags.length === 0) {
      issues.push({ code: "S6", severity: "info", skill: id, message: "No tags defined" });
    }
  }

  // S2: Body too large
  const bodySize = content.length;
  if (bodySize > 20000) {
    const tokens = Math.ceil(bodySize / 4);
    issues.push({ code: "S2", severity: "warning", skill: id, message: `Body too large (~${tokens} tokens). Consider splitting.` });
  }

  // S3: No examples
  const body = fmMatch ? content.slice(fmMatch[0].length) : content;
  const hasExamples = /example|e\.g\.|```|sample|demo/i.test(body);
  if (!hasExamples && body.length > 200) {
    issues.push({ code: "S3", severity: "warning", skill: id, message: "No examples found in body" });
  }

  return issues;
}

export async function run(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const all = args.includes("--all");
  const skillId = args.find(a => !a.startsWith("-"));

  let ids: string[];
  if (all) {
    ids = await listAllSkillIds();
  } else if (skillId) {
    ids = [skillId];
  } else {
    process.stderr.write("Usage: cue skills lint <skill-id> | --all\n");
    return 1;
  }

  // S5: Duplicate slug detection
  const slugMap = new Map<string, string[]>();
  for (const id of ids) {
    const slug = id.split("/").pop()!;
    const list = slugMap.get(slug) ?? [];
    list.push(id);
    slugMap.set(slug, list);
  }

  const allIssues: LintIssue[] = [];

  for (const id of ids) {
    allIssues.push(...lintSkill(id));
  }

  // S5 duplicates
  for (const [slug, owners] of slugMap) {
    if (owners.length > 1) {
      for (const id of owners) {
        allIssues.push({ code: "S5", severity: "warning", skill: id, message: `Duplicate slug "${slug}" also in: ${owners.filter(o => o !== id).join(", ")}` });
      }
    }
  }

  if (json) {
    process.stdout.write(JSON.stringify(allIssues, null, 2) + "\n");
    return allIssues.some(i => i.severity === "error") ? 1 : 0;
  }

  if (allIssues.length === 0) {
    process.stdout.write(`✅ ${ids.length} skill(s) passed lint.\n`);
    return 0;
  }

  const errors = allIssues.filter(i => i.severity === "error");
  const warnings = allIssues.filter(i => i.severity === "warning");
  const infos = allIssues.filter(i => i.severity === "info");

  process.stdout.write(`Lint: ${ids.length} skill(s), ${allIssues.length} issue(s)\n\n`);
  for (const issue of allIssues) {
    const icon = issue.severity === "error" ? "❌" : issue.severity === "warning" ? "⚠️" : "ℹ️";
    process.stdout.write(`  ${icon} [${issue.code}] ${issue.skill}: ${issue.message}\n`);
  }
  process.stdout.write(`\n  ${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info(s)\n`);

  return errors.length > 0 ? 1 : 0;
}
