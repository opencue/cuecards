/**
 * `cue audit --security` — profile-level security audit.
 *
 * Checks:
 *   CRITICAL: Skills with Bash(*) unrestricted shell
 *   HIGH: Skills with WebFetch(*) unrestricted, skills without allowed-tools
 *   MEDIUM: MCPs with filesystem write, hooks with --no-verify bypass
 *   LOW: Profile with no quality gates
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { loadProfile } from "../lib/profile-loader";
import { resolveActiveProfile } from "../lib/cwd-resolver";
import { parseAllowedTools } from "../lib/skill-sandbox";
import { repoRoot } from "../lib/repo-root";

const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");

type Severity = "critical" | "high" | "medium" | "low";

interface AuditFinding {
  severity: Severity;
  message: string;
}

function auditProfile(profile: Awaited<ReturnType<typeof loadProfile>>): AuditFinding[] {
  const findings: AuditFinding[] = [];

  // Check each skill
  const noToolsSkills: string[] = [];

  for (const skill of profile.skills.local) {
    const skillMd = join(SKILLS_ROOT, skill.id, "SKILL.md");
    const tools = parseAllowedTools(skillMd);

    if (tools.length === 0) {
      noToolsSkills.push(skill.id);
      continue;
    }

    // CRITICAL: Bash(*) unrestricted
    if (tools.includes("Bash(*)")) {
      findings.push({
        severity: "critical",
        message: `${skill.id} — Bash(*) unrestricted shell access`,
      });
    }

    // HIGH: WebFetch(*) unrestricted
    if (tools.includes("WebFetch(*)") || tools.includes("WebFetch")) {
      findings.push({
        severity: "high",
        message: `${skill.id} — WebFetch(*) unrestricted network access`,
      });
    }
  }

  // HIGH: Skills without allowed-tools declaration
  if (noToolsSkills.length > 0) {
    findings.push({
      severity: "high",
      message: `${noToolsSkills.length} skill(s) have no allowed-tools declaration (implicit full access)`,
    });
  }

  // MEDIUM: MCPs with filesystem write access
  const fsWriteMcps = ["gbrain", "word-mcp", "excel-mcp", "filesystem"];
  for (const mcp of profile.mcps) {
    if (fsWriteMcps.some(m => mcp.id.includes(m))) {
      findings.push({
        severity: "medium",
        message: `${mcp.id} MCP has filesystem write access`,
      });
    }
  }

  // MEDIUM: Hooks that can be bypassed
  for (const hook of profile.hooks) {
    const hookPath = join(repoRoot(), "resources", "hooks", hook);
    if (existsSync(hookPath)) {
      try {
        const content = readFileSync(hookPath, "utf8");
        if (content.includes("--no-verify") || content.includes("skip_hook")) {
          findings.push({
            severity: "medium",
            message: `Hook "${hook}" can be bypassed (--no-verify pattern)`,
          });
        }
      } catch { /* skip */ }
    }
  }

  // LOW: No quality gates
  if (profile.qualityGates.length === 0) {
    findings.push({
      severity: "low",
      message: "Profile has no quality gates (no Stop-hook validators)",
    });
  }

  return findings;
}

function computeScore(findings: AuditFinding[]): number {
  let score = 100;
  for (const f of findings) {
    switch (f.severity) {
      case "critical": score -= 20; break;
      case "high": score -= 12; break;
      case "medium": score -= 5; break;
      case "low": score -= 2; break;
    }
  }
  return Math.max(0, Math.min(100, score));
}

export async function runSecurityAudit(args: string[]): Promise<number> {
  let profileName = args.find(a => !a.startsWith("-"));
  if (!profileName) {
    try {
      profileName = await resolveActiveProfile() ?? undefined;
    } catch {}
  }

  if (!profileName) {
    process.stderr.write("No active profile. Specify a profile name or set .cue.profile.\n");
    return 1;
  }

  let profile;
  try {
    profile = await loadProfile(profileName);
  } catch (e: any) {
    process.stderr.write(`Failed to load profile "${profileName}": ${e.message}\n`);
    return 1;
  }

  const findings = auditProfile(profile);
  const score = computeScore(findings);

  const critical = findings.filter(f => f.severity === "critical");
  const high = findings.filter(f => f.severity === "high");
  const medium = findings.filter(f => f.severity === "medium");
  const low = findings.filter(f => f.severity === "low");

  process.stdout.write(`🔒 Security Audit for "${profileName}"\n\n`);

  if (critical.length) {
    process.stdout.write(`CRITICAL (${critical.length}):\n`);
    for (const f of critical) process.stdout.write(`  ❌ ${f.message}\n`);
    process.stdout.write("\n");
  }

  if (high.length) {
    process.stdout.write(`HIGH (${high.length}):\n`);
    for (const f of high) process.stdout.write(`  ⚠️  ${f.message}\n`);
    process.stdout.write("\n");
  }

  if (medium.length) {
    process.stdout.write(`MEDIUM (${medium.length}):\n`);
    for (const f of medium) process.stdout.write(`  ℹ️  ${f.message}\n`);
    process.stdout.write("\n");
  }

  if (low.length) {
    process.stdout.write(`LOW (${low.length}):\n`);
    for (const f of low) process.stdout.write(`  💡 ${f.message}\n`);
    process.stdout.write("\n");
  }

  if (findings.length === 0) {
    process.stdout.write("✅ No security issues found.\n\n");
  }

  const label = score >= 80 ? "good" : score >= 60 ? "needs attention" : score >= 40 ? "concerning" : "critical";
  process.stdout.write(`Score: ${score}/100 (${label})\n`);

  return critical.length > 0 ? 2 : findings.length > 0 ? 1 : 0;
}
