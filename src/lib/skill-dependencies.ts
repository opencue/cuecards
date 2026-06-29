/**
 * Skill → MCP dependency detection.
 *
 * Detects both explicit (requires_mcps frontmatter) and implicit
 * (mcp__<server>__ tool references in skill body) dependencies.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = process.env.CUE_REPO_ROOT ?? process.env.SOUL_REPO_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_ROOT = join(REPO_ROOT, "resources", "skills", "skills");

export interface SkillDependency {
  skillId: string;
  mcpId: string;
  source: "explicit" | "implicit";
}

export interface MissingDependency extends SkillDependency {
  profile: string;
}

/**
 * Parse explicit requires_mcps from skill frontmatter. Handles both the inline
 * array (`requires_mcps: [a, b]`) and YAML block-sequence forms. Exported for
 * unit testing.
 */
export function parseExplicitDeps(content: string): string[] {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];
  const fm = fmMatch[1]!;
  // Inline-array form: `requires_mcps: [a, b]`
  const inline = fm.match(/^requires_mcps:\s*\[([^\]]*)\]/m);
  if (inline) {
    return inline[1]!.split(",").map((t) => t.trim().replace(/['"]/g, "")).filter(Boolean);
  }
  // Block-sequence form:
  //   requires_mcps:
  //     - a
  //     - b
  const lines = fm.split("\n");
  const idx = lines.findIndex((l) => /^requires_mcps:\s*$/.test(l));
  if (idx === -1) return [];
  const out: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i]!.match(/^\s+-\s*(.+?)\s*$/);
    if (!m) break; // first non-item line ends the block sequence
    out.push(m[1]!.replace(/['"]/g, ""));
  }
  return out.filter(Boolean);
}

/**
 * Detect implicit MCP dependencies from mcp__<server>__<tool> references.
 */
/**
 * Pseudo-MCP names the *host* provides, not something cue installs. `conductor`
 * is the host orchestrator that exposes tools like
 * `mcp__conductor__AskUserQuestion`; skills reference it only as documentation,
 * so it must never be reported as a missing dependency.
 */
const HOST_PROVIDED_MCPS = new Set(["conductor"]);

function parseImplicitDeps(content: string): string[] {
  const refs = content.match(/mcp__([a-zA-Z][a-zA-Z0-9_-]*)__/g);
  if (!refs) return [];
  const servers = new Set<string>();
  for (const ref of refs) {
    const match = ref.match(/^mcp__([a-zA-Z][a-zA-Z0-9_-]*)__$/);
    if (match && !HOST_PROVIDED_MCPS.has(match[1]!)) servers.add(match[1]!);
  }
  return [...servers];
}

/**
 * Resolve the SKILL.md path for a skill ID.
 * Handles both "category/slug" and bare "slug" formats.
 */
function findSkillContent(skillId: string): string | null {
  // Try direct path (category/slug)
  const direct = join(SKILLS_ROOT, skillId, "SKILL.md");
  if (existsSync(direct)) {
    return readFileSync(direct, "utf8");
  }

  // Search all categories for the slug
  try {
    const cats = readdirSync(SKILLS_ROOT, { withFileTypes: true });
    for (const cat of cats) {
      if (!cat.isDirectory() || cat.name.startsWith("_")) continue;
      const p = join(SKILLS_ROOT, cat.name, skillId, "SKILL.md");
      if (existsSync(p)) return readFileSync(p, "utf8");
    }
  } catch { /* skip */ }

  return null;
}

/**
 * Get all MCP dependencies for a skill (explicit + implicit).
 */
export function getSkillDependencies(skillId: string): SkillDependency[] {
  const content = findSkillContent(skillId);
  if (!content) return [];

  const deps: SkillDependency[] = [];

  for (const mcp of parseExplicitDeps(content)) {
    deps.push({ skillId, mcpId: mcp, source: "explicit" });
  }

  for (const mcp of parseImplicitDeps(content)) {
    // Avoid duplicates with explicit
    if (!deps.some(d => d.mcpId === mcp)) {
      deps.push({ skillId, mcpId: mcp, source: "implicit" });
    }
  }

  return deps;
}

/**
 * Check a profile's skills against its MCPs and return missing dependencies.
 */
export function detectMissingDependencies(
  profileName: string,
  skillIds: string[],
  profileMcpIds: string[],
): MissingDependency[] {
  const mcpSet = new Set(profileMcpIds.map(id => id.toLowerCase()));
  const missing: MissingDependency[] = [];

  for (const skillId of skillIds) {
    const deps = getSkillDependencies(skillId);
    for (const dep of deps) {
      // Case-insensitive match (MCP IDs can vary in casing)
      if (!mcpSet.has(dep.mcpId.toLowerCase())) {
        missing.push({ ...dep, profile: profileName });
      }
    }
  }

  return missing;
}
