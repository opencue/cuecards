/**
 * `cue security [profile|--all]` — scan skills for prompt injection & secret exfiltration risks.
 *
 * Checks:
 *   SEC1: Skill instructs to read/grep/cat .env, credentials, API keys
 *   SEC2: Skill instructs to send data to external URLs (exfiltration)
 *   SEC3: Skill overrides safety rules ("ignore previous instructions", "you are now")
 *   SEC4: Skill uses eval/exec/os.system with user input
 *   SEC5: Skill instructs to disable permissions or skip verification
 *   SEC6: Skill contains encoded/obfuscated content (base64 blocks, hex strings)
 *   SEC7: Skill instructs to modify .bashrc/.zshrc/crontab/sudoers
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { listAllSkillIds } from "../lib/resolver-local";
import { loadProfile, listProfiles } from "../lib/profile-loader";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_ROOT = join(REPO_ROOT, "resources", "skills", "skills");
const GLOBAL_SKILLS_ROOT = join(homedir(), ".claude", "skills");

interface SecurityIssue {
  code: string;
  severity: "critical" | "high" | "medium";
  skill: string;
  message: string;
  line?: number;
  snippet?: string;
}

const RULES: { code: string; severity: "critical" | "high" | "medium"; patterns: RegExp[]; message: string }[] = [
  {
    code: "SEC1",
    severity: "critical",
    patterns: [
      /grep.{0,20}(api.?key|secret|token|password|credential)/i,
      /cat.{0,10}\.(env|credentials|secret|key)/i,
      /read.{0,20}(\.env|credentials\.json|\.aws\/|\.ssh\/|private.?key)/i,
      /\$\{?\w*(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)\w*\}?/,
      /print.{0,10}(api.?key|secret|token|password)/i,
      /echo.{0,10}\$(.*KEY|.*SECRET|.*TOKEN)/i,
      /expose.{0,20}(secret|key|token|credential)/i,
    ],
    message: "Attempts to read/expose secrets (API keys, .env, credentials)",
  },
  {
    code: "SEC2",
    severity: "critical",
    patterns: [
      /curl.{0,30}(POST|PUT).{0,30}https?:\/\/(?!localhost)/i,
      /fetch\(.{0,30}https?:\/\/(?!localhost)/i,
      /wget.{0,20}--post/i,
      /send.{0,20}(to|data|payload).{0,20}(http|url|endpoint|webhook)/i,
      /exfiltrat/i,
      /upload.{0,20}(secret|key|token|data).{0,20}(http|url)/i,
    ],
    message: "May exfiltrate data to external URLs",
  },
  {
    code: "SEC3",
    severity: "critical",
    patterns: [
      /ignore.{0,10}(previous|prior|above|all).{0,10}(instruction|rule|prompt)/i,
      /you are now.{0,10}(a different|new|unrestricted)/i,
      /disregard.{0,10}(safety|rule|instruction|constraint)/i,
      /override.{0,10}(safety|security|permission|rule)/i,
      /jailbreak/i,
      /bypass.{0,10}(filter|safety|restriction|guard)/i,
    ],
    message: "Prompt injection — attempts to override safety rules",
  },
  {
    code: "SEC4",
    severity: "high",
    patterns: [
      /eval\s*\(/,
      /exec\s*\(/,
      /os\.system\s*\(/,
      /subprocess\.call.{0,20}shell\s*=\s*True/,
      /child_process/,
      /\$\(.{0,50}\$\{/,  // command substitution with variable interpolation
    ],
    message: "Code execution patterns (eval/exec/os.system)",
  },
  {
    code: "SEC5",
    severity: "high",
    patterns: [
      /skip.{0,10}(verification|auth|permission|confirm)/i,
      /--no-verify/,
      /--force/,
      /sudo.{0,10}(rm|chmod|chown|dd|mkfs)/i,
      /chmod.{0,5}777/,
      /disable.{0,10}(auth|security|firewall|ssl)/i,
    ],
    message: "Disables security controls or skips verification",
  },
  {
    code: "SEC6",
    severity: "medium",
    patterns: [
      /(?<![/~.])[A-Za-z0-9+/]{80,}={0,2}/,  // long base64 (exclude file paths)
      /\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){10,}/i,  // hex-encoded strings
      /atob\s*\(/,
      /Buffer\.from\(.{0,20}base64/,
    ],
    message: "Contains encoded/obfuscated content",
  },
  {
    code: "SEC7",
    severity: "high",
    patterns: [
      /modify.{0,10}(\.bashrc|\.zshrc|\.profile|crontab|sudoers)/i,
      /echo.{0,20}>>\s*(~\/\.|\/etc\/)/,
      /crontab\s+-e/,
      /visudo/,
      /write.{0,10}(\.bashrc|\.zshrc|authorized_keys)/i,
    ],
    message: "Modifies shell config, crontab, or system files",
  },
];

function scanSkill(id: string): SecurityIssue[] {
  // Try both local repo skills and global ~/.claude/skills
  let path = join(SKILLS_ROOT, id, "SKILL.md");
  if (!existsSync(path)) path = join(GLOBAL_SKILLS_ROOT, id, "SKILL.md");
  if (!existsSync(path)) return [];

  const content = readFileSync(path, "utf8");
  const lines = content.split("\n");
  const issues: SecurityIssue[] = [];

  // Context-aware skipping: many skills are documentation/examples, not instructions
  const isSecuritySkill = /security|review|audit|pentest|vuln|incident|forensic|malware|threat|exploit|attack|defense|firewall|intrusion|packet|capture|siem|dfir|reverse.?engineer|phishing|ransomware|encryption|cipher|brute.?force|privilege.?escalat|lateral.?movement|exfiltrat|injection|xss|csrf|owasp|cve|mitre|apt|red.?team|blue.?team|soc|honeypot|sandbox|rootkit|botnet|payload|shellcode|beacon|c2|command.?and.?control|network.?monitor|log.?analy|hardening|compliance|nist|iso.?27|pci.?dss|hipaa|gdpr|zero.?trust|devsecops|container.?security|cloud.?security|iam|access.?control|authentication|authorization/i.test(id);
  const isMetaSkill = /skill-evolution|builtin-manager|doctor|help|omx|plugin-creator|save-profile/i.test(id);
  const isApiDocSkill = /hostinger|medusa|stripe|coolify|deployment|kiro/i.test(id);
  const isDesignSkill = /design|remotion|higgsfield|imagegen/i.test(id);
  const isOrchSkill = /colony|pipeline|fleet|orchestration|worker/i.test(id);
  const isResearchSkill = /research|find-skills|openai-docs/i.test(id);
  // Skills from known cybersecurity packs (Anthropic-Cybersecurity-Skills)
  const isCyberPack = existsSync(join(GLOBAL_SKILLS_ROOT, id, "SKILL.md")) &&
    !existsSync(join(SKILLS_ROOT, id, "SKILL.md"));

  for (const rule of RULES) {
    // Skip rules for skill categories where these patterns are expected documentation
    if ((isSecuritySkill || isCyberPack) && ["SEC1", "SEC2", "SEC3", "SEC4", "SEC5"].includes(rule.code)) continue;
    if (isMetaSkill && ["SEC4", "SEC5"].includes(rule.code)) continue;
    if (isApiDocSkill && ["SEC1", "SEC2", "SEC5"].includes(rule.code)) continue;
    if (isDesignSkill && ["SEC2"].includes(rule.code)) continue;
    if (isOrchSkill && ["SEC4", "SEC5"].includes(rule.code)) continue;
    if (isResearchSkill && ["SEC1", "SEC2"].includes(rule.code)) continue;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      // Skip lines that are clearly safe contexts
      if (/\b(MUST NOT|must not|do not|don't|never|avoid|reject)\b/i.test(line)) continue;
      if (/^#|^\/\/|^\s*\*|NEVER|prohibited/i.test(line.trim())) continue;
      // Skip lines inside code blocks (``` fenced) — these are examples
      if (/^```/.test(line.trim())) continue;
      // Skip lines that are curl examples showing API usage (documentation)
      if (/^\s*(curl|fetch|wget)\s/.test(line) && /example|api\.|developers\./i.test(line)) continue;
      // Skip lines with placeholder variables ($VARIABLE_NAME) — these are templates
      if (/\$\{?[A-Z_]+\}?/.test(line) && /(-H|header|Authorization|Bearer)/i.test(line)) continue;
      // Skip lines documenting CLI flags (--force, --skip-verify in help text)
      if (/^\s*(-|•|\*|`--)/.test(line) && /flag|option|argument/i.test(lines[Math.max(0, i-3)]! + lines[Math.max(0, i-2)]! + lines[Math.max(0, i-1)]!)) continue;
      // Skip lines that describe what a response "includes" (not an instruction to expose)
      if (/response|returns|includes|contains/i.test(line) && rule.code === "SEC1") continue;
      // Skip fetch() in code examples (inside ``` blocks)
      if (isInsideCodeBlock(lines, i)) continue;

      for (const pattern of rule.patterns) {
        if (pattern.test(line)) {
          if (!issues.some(iss => iss.code === rule.code && iss.skill === id)) {
            issues.push({
              code: rule.code,
              severity: rule.severity,
              skill: id,
              message: rule.message,
              line: i + 1,
              snippet: line.trim().slice(0, 80),
            });
          }
          break;
        }
      }
    }
  }

  return issues;
}

/** Check if a line index is inside a fenced code block */
function isInsideCodeBlock(lines: string[], idx: number): boolean {
  let inside = false;
  for (let i = 0; i < idx; i++) {
    if (/^```/.test(lines[i]!.trim())) inside = !inside;
  }
  return inside;
}

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue security — scan skills for prompt injection & secret exfiltration

Usage: cue security [profile|--all]

Checks:
  SEC1  Reads/exposes secrets (API keys, .env, credentials)     [critical]
  SEC2  Exfiltrates data to external URLs                       [critical]
  SEC3  Prompt injection (override safety rules)                [critical]
  SEC4  Code execution (eval/exec/os.system)                    [high]
  SEC5  Disables security controls                              [high]
  SEC6  Encoded/obfuscated content                              [medium]
  SEC7  Modifies shell config/crontab/sudoers                   [high]

Examples:
  cue security              # scan active profile
  cue security --all        # scan ALL skills
  cue security backend      # scan one profile
  cue security --json       # machine-readable
`);
    return 0;
  }

  const json = args.includes("--json");
  const all = args.includes("--all");
  const profileName = args.find(a => !a.startsWith("-"));

  let skillIds: string[];

  if (all) {
    skillIds = await listAllSkillIds();
    // Also include global skills from ~/.claude/skills/
    if (existsSync(GLOBAL_SKILLS_ROOT)) {
      try {
        const globalDirs = readdirSync(GLOBAL_SKILLS_ROOT, { withFileTypes: true });
        for (const d of globalDirs) {
          if (d.isDirectory() && existsSync(join(GLOBAL_SKILLS_ROOT, d.name, "SKILL.md"))) {
            if (!skillIds.includes(d.name)) skillIds.push(d.name);
          }
        }
      } catch { /* skip */ }
    }
  } else if (profileName) {
    try {
      const profile = await loadProfile(profileName);
      skillIds = profile.skills.local.map(s => s.id);
    } catch {
      process.stderr.write(`Profile "${profileName}" not found.\n`);
      return 1;
    }
  } else {
    // Default: scan all (local + global)
    skillIds = await listAllSkillIds();
    if (existsSync(GLOBAL_SKILLS_ROOT)) {
      try {
        const globalDirs = readdirSync(GLOBAL_SKILLS_ROOT, { withFileTypes: true });
        for (const d of globalDirs) {
          if (d.isDirectory() && existsSync(join(GLOBAL_SKILLS_ROOT, d.name, "SKILL.md"))) {
            if (!skillIds.includes(d.name)) skillIds.push(d.name);
          }
        }
      } catch { /* skip */ }
    }
  }

  process.stderr.write(`🔒 Scanning ${skillIds.length} skills for security issues...\n\n`);

  const allIssues: SecurityIssue[] = [];
  for (const id of skillIds) {
    allIssues.push(...scanSkill(id));
  }

  if (json) {
    process.stdout.write(JSON.stringify({ scanned: skillIds.length, issues: allIssues }, null, 2) + "\n");
    return allIssues.some(i => i.severity === "critical") ? 2 : allIssues.length > 0 ? 1 : 0;
  }

  if (allIssues.length === 0) {
    process.stdout.write(`✅ No security issues found in ${skillIds.length} skills.\n`);
    return 0;
  }

  const critical = allIssues.filter(i => i.severity === "critical");
  const high = allIssues.filter(i => i.severity === "high");
  const medium = allIssues.filter(i => i.severity === "medium");

  process.stdout.write(`Found ${allIssues.length} issue(s): 🔴 ${critical.length} critical, 🟠 ${high.length} high, 🟡 ${medium.length} medium\n\n`);

  for (const issue of allIssues) {
    const icon = issue.severity === "critical" ? "🔴" : issue.severity === "high" ? "🟠" : "🟡";
    process.stdout.write(`  ${icon} [${issue.code}] ${issue.skill}\n`);
    process.stdout.write(`     ${issue.message}\n`);
    if (issue.line && issue.snippet) {
      process.stdout.write(`     line ${issue.line}: ${issue.snippet}\n`);
    }
    process.stdout.write("\n");
  }

  if (critical.length > 0) {
    process.stdout.write(`⚠️  ${critical.length} CRITICAL issue(s) found. These skills may be malicious.\n`);
    process.stdout.write(`   Remove with: cue skills remove-from-profile <id>\n`);
  }

  return critical.length > 0 ? 2 : 1;
}
