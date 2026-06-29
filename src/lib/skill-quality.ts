/**
 * Skill quality scoring — rates a skill on 11 criteria (total 100 points).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { repoRoot as cueRepoRoot } from "./repo-root";



function getSkillsRoot(): string {
  const root = process.env.CUE_REPO_ROOT ?? cueRepoRoot();
  return join(root, "resources", "skills", "skills");
}

function getRepoRoot(): string {
  return process.env.CUE_REPO_ROOT ?? cueRepoRoot();
}

interface ScoreBreakdown {
  criterion: string;
  points: number;
  max: number;
  detail?: string;
}

export interface SkillQualityResult {
  score: number;
  breakdown: ScoreBreakdown[];
}

export function scoreSkillQuality(skillId: string): SkillQualityResult {
  const skillsRoot = getSkillsRoot();
  const repoRoot = getRepoRoot();
  const skillDir = join(skillsRoot, skillId);
  const skillMd = join(skillDir, "SKILL.md");
  const breakdown: ScoreBreakdown[] = [];

  if (!existsSync(skillMd)) {
    return { score: 0, breakdown: [{ criterion: "Skill exists", points: 0, max: 100, detail: "SKILL.md not found" }] };
  }

  const content = readFileSync(skillMd, "utf8");
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const fm = fmMatch?.[1] ?? "";

  // 1. Has description (10 pts)
  const descMatch = fm.match(/^description:\s*(.+)/m);
  let desc = descMatch?.[1]?.replace(/^["'>|]\s*/, "").trim() ?? "";
  // Handle multiline YAML (>- or |): grab indented continuation lines
  if (descMatch && (desc === "" || desc === "-")) {
    const descIdx = fm.indexOf(descMatch[0]);
    const afterDesc = fm.slice(descIdx + descMatch[0].length);
    const contLines = afterDesc.split("\n").filter(l => /^\s+\S/.test(l));
    const joined: string[] = [];
    for (const l of contLines) {
      if (/^\s+\S/.test(l)) joined.push(l.trim());
      else break;
    }
    if (joined.length) desc = joined.join(" ");
  }
  breakdown.push({ criterion: "Has description", points: desc ? 10 : 0, max: 10 });

  // 2. Has tags (5 pts)
  const hasTags = /^tags:\s*\[/m.test(fm);
  breakdown.push({ criterion: "Has tags", points: hasTags ? 5 : 0, max: 5 });

  // 3. Has companions field (10 pts)
  const hasCompanions = /^companions:/m.test(fm);
  breakdown.push({ criterion: "Has companions field", points: hasCompanions ? 10 : 0, max: 10 });

  // 4. Has scripts/ directory (15 pts)
  const hasScripts = existsSync(join(skillDir, "scripts"));
  breakdown.push({ criterion: "Has scripts/ directory", points: hasScripts ? 15 : 0, max: 15 });

  // 5. Has tests (15 pts)
  let hasTests = false;
  try {
    const files = readdirSync(skillDir, { recursive: true }) as string[];
    hasTests = files.some(f => /_test\.py$|\.test\.ts$|\.test\.js$|_test\.go$/.test(String(f)));
  } catch { /* skip */ }
  breakdown.push({ criterion: "Has tests", points: hasTests ? 15 : 0, max: 15 });

  // 6. Has depends field (5 pts)
  const hasDepends = /^depends:\s*\[/m.test(fm);
  breakdown.push({ criterion: "Has depends field", points: hasDepends ? 5 : 0, max: 5 });

  // 7. Has allowed-tools (10 pts)
  const hasAllowedTools = /^allowed-tools:/m.test(fm);
  breakdown.push({ criterion: "Has allowed-tools", points: hasAllowedTools ? 10 : 0, max: 10 });

  // 8. Updated within 30 days (10 pts)
  let recentlyUpdated = false;
  try {
    const st = statSync(skillMd);
    const daysOld = (Date.now() - st.mtimeMs) / 86400000;
    recentlyUpdated = daysOld <= 30;
  } catch { /* skip */ }
  breakdown.push({ criterion: "Updated within 30 days", points: recentlyUpdated ? 10 : 0, max: 10 });

  // 9. Used in at least 1 profile (10 pts)
  let usedInProfile = false;
  try {
    const profilesDir = join(repoRoot, "profiles");
    const profiles = readdirSync(profilesDir).filter(d => {
      try { return statSync(join(profilesDir, d, "profile.yaml")).isFile(); } catch { return false; }
    });
    for (const p of profiles) {
      const yaml = readFileSync(join(profilesDir, p, "profile.yaml"), "utf8");
      if (yaml.includes(skillId)) { usedInProfile = true; break; }
    }
  } catch { /* skip */ }
  breakdown.push({ criterion: "Used in a profile", points: usedInProfile ? 10 : 0, max: 10 });

  // 10. Has .source file (5 pts)
  const hasSource = existsSync(join(skillDir, ".source"));
  breakdown.push({ criterion: "Has .source file", points: hasSource ? 5 : 0, max: 5 });

  // 11. Non-empty description > 20 chars (5 pts)
  const longDesc = desc.length > 20;
  breakdown.push({ criterion: "Description > 20 chars", points: longDesc ? 5 : 0, max: 5 });

  const score = breakdown.reduce((sum, b) => sum + b.points, 0);
  return { score, breakdown };
}

/**
 * Format a score card for terminal output with bar chart.
 */
export function formatScoreCard(result: SkillQualityResult): string {
  const lines: string[] = [];
  const grade = result.score >= 80 ? "A" : result.score >= 60 ? "B" : result.score >= 40 ? "C" : result.score >= 20 ? "D" : "F";

  lines.push(`Score: ${result.score}/100 (${grade})`);
  lines.push("");

  for (const b of result.breakdown) {
    const pct = b.max > 0 ? b.points / b.max : 0;
    const barLen = 10;
    const filled = Math.round(pct * barLen);
    const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
    const icon = b.points === b.max ? "✅" : b.points > 0 ? "◐" : "❌";
    lines.push(`  ${icon} ${bar} ${String(b.points).padStart(2)}/${b.max}  ${b.criterion}`);
  }

  return lines.join("\n");
}
