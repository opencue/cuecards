/**
 * Skill sandboxing — allowed-tools enforcement.
 *
 * Parses `allowed-tools:` from SKILL.md frontmatter, validates tool usage,
 * audits permissions, and generates sandbox reports.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./repo-root";


function getSkillsRoot(): string {
  const root = process.env.CUE_REPO_ROOT ?? repoRoot();
  return join(root, "resources", "skills", "skills");
}

/**
 * Extract `allowed-tools:` from SKILL.md frontmatter.
 * Supports both inline array `[Bash(git:*), Read]` and single value `Bash(npx:*)`.
 */
export function parseAllowedTools(skillMdPath: string): string[] {
  if (!existsSync(skillMdPath)) return [];
  const content = readFileSync(skillMdPath, "utf8");
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];

  const fm = fmMatch[1]!;
  const match = fm.match(/^allowed-tools:\s*(.+)$/m);
  if (!match) return [];

  const raw = match[1]!.trim();
  // Handle array format: [Bash(git:*), Read, Write]
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw.slice(1, -1).split(",").map(t => t.trim()).filter(Boolean);
  }
  // Handle comma-separated without brackets
  if (raw.includes(",")) {
    return raw.split(",").map(t => t.trim()).filter(Boolean);
  }
  // Single value
  return [raw];
}

/**
 * Validate whether a tool name is allowed by the skill's declared tools.
 */
export function validateToolUsage(
  skillId: string,
  toolName: string,
  allowedTools: string[],
): { allowed: boolean; reason?: string } {
  if (allowedTools.length === 0) {
    return { allowed: true, reason: "No allowed-tools declared (implicit full access)" };
  }

  for (const tool of allowedTools) {
    // Exact match
    if (tool === toolName) return { allowed: true };
    // Wildcard: Bash(*) matches any Bash usage
    if (tool === "Bash(*)") {
      if (toolName.startsWith("Bash")) return { allowed: true };
    }
    // Pattern: Bash(git:*) matches Bash(git:status), Bash(git:commit), etc.
    const patternMatch = tool.match(/^(\w+)\((.+)\)$/);
    if (patternMatch) {
      const [, toolType, pattern] = patternMatch;
      if (!toolName.startsWith(toolType!)) continue;
      const innerMatch = toolName.match(/^\w+\((.+)\)$/);
      if (!innerMatch) continue;
      const inner = innerMatch[1]!;
      // Wildcard pattern: git:* matches git:anything
      if (pattern!.endsWith("*")) {
        const prefix = pattern!.slice(0, -1);
        if (inner.startsWith(prefix)) return { allowed: true };
      }
      if (inner === pattern) return { allowed: true };
    }
    // Simple tool names: Read, Write, WebFetch
    if (tool === toolName) return { allowed: true };
  }

  return { allowed: false, reason: `"${toolName}" not in allowed-tools: [${allowedTools.join(", ")}]` };
}

/**
 * Audit skill permissions and assign risk levels.
 */
export function auditSkillPermissions(
  skillIds: string[],
): { id: string; tools: string[]; risk: "low" | "medium" | "high" }[] {
  const skillsRoot = getSkillsRoot();
  return skillIds.map(id => {
    const skillMd = join(skillsRoot, id, "SKILL.md");
    const tools = parseAllowedTools(skillMd);
    const risk = assessRisk(tools);
    return { id, tools, risk };
  });
}

function assessRisk(tools: string[]): "low" | "medium" | "high" {
  if (tools.length === 0) return "medium"; // no declaration = implicit full access
  for (const t of tools) {
    if (t === "Bash(*)") return "high";
    if (t === "WebFetch(*)") return "high";
  }
  for (const t of tools) {
    if (t.startsWith("Bash(") && t.includes(":*")) return "medium";
  }
  return "low";
}

/**
 * Generate a formatted sandbox report for terminal output.
 */
export function generateSandboxReport(skillIds: string[]): string {
  const audits = auditSkillPermissions(skillIds);
  const lines: string[] = ["🔐 Skill Sandbox Report", ""];

  const high = audits.filter(a => a.risk === "high");
  const medium = audits.filter(a => a.risk === "medium");
  const low = audits.filter(a => a.risk === "low");

  if (high.length) {
    lines.push(`HIGH RISK (${high.length}):`);
    for (const a of high) {
      lines.push(`  ❌ ${a.id} — ${a.tools.join(", ") || "(no declaration)"}`);
    }
    lines.push("");
  }

  if (medium.length) {
    lines.push(`MEDIUM RISK (${medium.length}):`);
    for (const a of medium) {
      lines.push(`  ⚠️  ${a.id} — ${a.tools.join(", ") || "(no allowed-tools declared)"}`);
    }
    lines.push("");
  }

  if (low.length) {
    lines.push(`LOW RISK (${low.length}):`);
    for (const a of low) {
      lines.push(`  ✅ ${a.id} — ${a.tools.join(", ")}`);
    }
    lines.push("");
  }

  lines.push(`Total: ${skillIds.length} skills — ${high.length} high, ${medium.length} medium, ${low.length} low`);
  return lines.join("\n");
}
