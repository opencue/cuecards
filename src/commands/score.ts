/**
 * `cue score` — profile efficiency score (A+ to F) with SVG badge.
 *
 * Scoring:
 *   - Token budget (lower = better): 40% weight
 *   - Skill usage rate (higher = better): 35% weight
 *   - No unused skills (fewer = better): 25% weight
 *
 * Output:
 *   - Terminal: colored grade + breakdown
 *   - --badge: SVG file (tokscale-inspired dark card)
 *   - --markdown: one-liner for README
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { loadProfile, listProfiles } from "../lib/profile-loader";
import { resolveProfileForCwd } from "../lib/cwd-resolver";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_ROOT = join(REPO_ROOT, "resources", "skills", "skills");

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function getSkillTokens(id: string): number {
  const path = join(SKILLS_ROOT, id, "SKILL.md");
  try { return estimateTokens(readFileSync(path, "utf8")); } catch { return 0; }
}

function getSkillUsage(profileName: string, skillIds: string[]): { used: Set<string>; total: number } {
  const projectsDir = join(homedir(), ".claude", "projects");
  const used = new Set<string>();
  if (!existsSync(projectsDir)) return { used, total: 0 };

  const slugs = skillIds.map(id => id.split("/").pop()!);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // last 30 days

  try {
    const dirs = readdirSync(projectsDir).filter(d => {
      try { return statSync(join(projectsDir, d)).isDirectory(); } catch { return false; }
    });
    outer:
    for (const dir of dirs) {
      const fullDir = join(projectsDir, dir);
      const files = readdirSync(fullDir)
        .filter(f => f.endsWith(".jsonl"))
        .map(f => ({ name: f, mtime: statSync(join(fullDir, f)).mtimeMs }))
        .filter(f => f.mtime > cutoff)
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 5); // only check 5 most recent per project dir

      for (const f of files) {
        try {
          // Read only first 50KB of each file to check for skill refs
          const fd = require("node:fs").openSync(join(fullDir, f.name), "r");
          const buf = Buffer.alloc(50_000);
          const bytesRead = require("node:fs").readSync(fd, buf, 0, 50_000, 0);
          require("node:fs").closeSync(fd);
          const content = buf.toString("utf8", 0, bytesRead);

          for (let i = 0; i < slugs.length; i++) {
            if (content.includes(slugs[i]!)) used.add(skillIds[i]!);
          }
        } catch {}
        if (used.size === skillIds.length) break outer;
      }
    }
  } catch {}
  return { used, total: skillIds.length };
}

interface ScoreResult {
  profile: string;
  grade: string;
  score: number; // 0-100
  tokens: number;
  skillCount: number;
  usedSkills: number;
  unusedSkills: number;
  usageRate: number;
  tokenScore: number;
  usageScore: number;
  unusedScore: number;
}

function computeScore(profileName: string, profile: any): ScoreResult {
  const skillIds = profile.skills.local.map((s: any) => s.id);
  const tokens = skillIds.reduce((sum: number, id: string) => sum + getSkillTokens(id), 0) + 200;
  const { used } = getSkillUsage(profileName, skillIds);
  const usedCount = used.size;
  const unusedCount = skillIds.length - usedCount;
  const usageRate = skillIds.length > 0 ? usedCount / skillIds.length : 1;

  // Token score: 100 at ≤2k, 0 at ≥50k (linear)
  const tokenScore = Math.max(0, Math.min(100, 100 - ((tokens - 2000) / 480)));

  // Usage score: 100 at 100% usage, 0 at 0%
  const usageScore = Math.round(usageRate * 100);

  // Unused penalty: 100 at 0 unused, 0 at 10+ unused
  const unusedScore = Math.max(0, Math.min(100, 100 - (unusedCount * 10)));

  const score = Math.round(tokenScore * 0.4 + usageScore * 0.35 + unusedScore * 0.25);

  const grade = score >= 95 ? "A+" : score >= 90 ? "A" : score >= 85 ? "A-"
    : score >= 80 ? "B+" : score >= 75 ? "B" : score >= 70 ? "B-"
    : score >= 65 ? "C+" : score >= 60 ? "C" : score >= 55 ? "C-"
    : score >= 50 ? "D+" : score >= 45 ? "D" : "F";

  return {
    profile: profileName, grade, score, tokens,
    skillCount: skillIds.length, usedSkills: usedCount,
    unusedSkills: unusedCount, usageRate,
    tokenScore, usageScore, unusedScore,
  };
}

function gradeColor(grade: string): string {
  if (grade.startsWith("A")) return "#3FB950";
  if (grade.startsWith("B")) return "#58A6FF";
  if (grade.startsWith("C")) return "#D29922";
  if (grade.startsWith("D")) return "#F85149";
  return "#F85149";
}

function generateBadgeSvg(result: ScoreResult): string {
  const color = gradeColor(result.grade);
  const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="460" height="162" viewBox="0 0 460 162" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="cue profile score for ${result.profile}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="460" y2="162" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0D1117"/>
      <stop offset="1" stop-color="#010409"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.82" cy="0.12" r="0.55">
      <stop offset="0" stop-color="${color}" stop-opacity="0.07"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="score-grad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${color}"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0.6"/>
    </linearGradient>
    <linearGradient id="divider-grad" x1="18" y1="0" x2="442" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#30363D" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#30363D" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#30363D" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="acc-tokens" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.15" stop-color="#58A6FF" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#58A6FF" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="acc-usage" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.15" stop-color="#3FB950" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#3FB950" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="acc-grade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.15" stop-color="${color}" stop-opacity="0.9"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="card-clip">
      <rect width="460" height="162" rx="16"/>
    </clipPath>
  </defs>
  <rect width="460" height="162" rx="16" fill="url(#bg)"/>
  <rect x="0.5" y="0.5" width="459" height="161" rx="15.5" fill="none" stroke="#30363D"/>
  <rect width="460" height="162" rx="16" fill="url(#glow)" clip-path="url(#card-clip)"/>
  <text x="18" y="26" fill="#8B949E" font-size="12" font-weight="600" font-family="Segoe UI, sans-serif" letter-spacing="0.03em">cue score</text>
  <text x="18" y="44" fill="#E6EDF3" font-size="15" font-weight="700" font-family="Segoe UI, sans-serif">${result.profile}</text>
  <text x="${18 + (result.profile.length * 9) + 10}" y="44" fill="#8B949E" font-size="13" font-family="Segoe UI, sans-serif">${result.skillCount} skills · ${result.tokens.toLocaleString()} tokens</text>
  <rect x="374" y="14" width="68" height="28" rx="14" fill="rgba(${grade2rgb(result.grade)},0.1)" stroke="rgba(${grade2rgb(result.grade)},0.3)"/>
  <text x="408" y="33" fill="${color}" font-size="16" font-weight="800" font-family="Segoe UI, sans-serif" text-anchor="middle">${result.grade}</text>
  <rect x="18" y="54" width="424" height="1" fill="url(#divider-grad)"/>
  <rect x="18" y="64" width="136" height="58" rx="10" fill="rgba(22,27,34,0.6)" stroke="rgba(48,54,61,0.6)"/>
  <rect x="18" y="74" width="2.5" height="38" rx="1.25" fill="url(#acc-tokens)"/>
  <text x="32" y="84" fill="#8B949E" font-size="11" font-weight="600" font-family="Segoe UI, sans-serif" letter-spacing="0.03em">Token Budget</text>
  <text x="32" y="110" fill="#58A6FF" font-size="22" font-weight="800" font-family="Segoe UI, sans-serif">${formatTokens(result.tokens)}</text>
  <rect x="162" y="64" width="136" height="58" rx="10" fill="rgba(22,27,34,0.6)" stroke="rgba(48,54,61,0.6)"/>
  <rect x="162" y="74" width="2.5" height="38" rx="1.25" fill="url(#acc-usage)"/>
  <text x="176" y="84" fill="#8B949E" font-size="11" font-weight="600" font-family="Segoe UI, sans-serif" letter-spacing="0.03em">Skill Usage</text>
  <text x="176" y="110" fill="#3FB950" font-size="22" font-weight="800" font-family="Segoe UI, sans-serif">${Math.round(result.usageRate * 100)}%</text>
  <rect x="306" y="64" width="136" height="58" rx="10" fill="rgba(22,27,34,0.6)" stroke="rgba(48,54,61,0.6)"/>
  <rect x="306" y="74" width="2.5" height="38" rx="1.25" fill="url(#acc-grade)"/>
  <text x="320" y="84" fill="#8B949E" font-size="11" font-weight="600" font-family="Segoe UI, sans-serif" letter-spacing="0.03em">Score</text>
  <text x="320" y="110" fill="${color}" font-size="22" font-weight="800" font-family="Segoe UI, sans-serif">${result.score}/100</text>
  <text x="18" y="148" fill="#8B949E" font-size="11" font-family="Segoe UI, sans-serif">${date}</text>
  <text x="442" y="148" fill="#8B949E" font-size="11" font-family="Segoe UI, sans-serif" text-anchor="end">github.com/recodeee/cue</text>
</svg>`;
}

function grade2rgb(grade: string): string {
  if (grade.startsWith("A")) return "63,185,80";
  if (grade.startsWith("B")) return "88,166,255";
  if (grade.startsWith("C")) return "210,153,34";
  return "248,81,73";
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue score — profile efficiency score with SVG badge

Usage:
  cue score                    Score active profile
  cue score --profile <name>   Score specific profile
  cue score --all              Score all profiles
  cue score --badge <path>     Generate SVG badge file
  cue score --markdown         Output README badge markdown
  cue score --json             Machine-readable output
`);
    return 0;
  }

  const json = args.includes("--json");
  const all = args.includes("--all");
  const markdown = args.includes("--markdown");
  const badgeIdx = args.indexOf("--badge");
  const badgePath = badgeIdx >= 0 ? args[badgeIdx + 1] : null;
  const profileIdx = args.indexOf("--profile");
  let profileName = profileIdx >= 0 ? args[profileIdx + 1] : args.find(a => !a.startsWith("-"));

  if (!profileName && !all) {
    try { profileName = await resolveProfileForCwd(process.cwd()); } catch {}
    if (!profileName) {
      process.stderr.write("No active profile. Use --profile <name> or --all.\n");
      return 1;
    }
  }

  if (all) {
    const profiles = await listProfiles();
    const results: ScoreResult[] = [];
    for (const name of profiles) {
      try {
        const profile = await loadProfile(name);
        results.push(computeScore(name, profile));
      } catch {}
    }
    results.sort((a, b) => b.score - a.score);

    if (json) {
      process.stdout.write(JSON.stringify(results, null, 2) + "\n");
      return 0;
    }

    process.stdout.write("🏆 Profile Scores\n\n");
    for (const r of results) {
      const color = r.grade.startsWith("A") ? "\x1b[32m" : r.grade.startsWith("B") ? "\x1b[34m"
        : r.grade.startsWith("C") ? "\x1b[33m" : "\x1b[31m";
      process.stdout.write(`  ${color}${r.grade.padEnd(3)}\x1b[0m ${r.profile.padEnd(20)} ${String(r.score).padStart(3)}/100  ${formatTokens(r.tokens).padStart(6)} tokens  ${Math.round(r.usageRate * 100)}% usage\n`);
    }
    return 0;
  }

  const profile = await loadProfile(profileName!);
  const result = computeScore(profileName!, profile);

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  if (markdown) {
    const color = gradeColor(result.grade).replace("#", "");
    process.stdout.write(`![cue score](https://img.shields.io/badge/cue_score-${result.grade}-${color}?style=flat-square)\n`);
    return 0;
  }

  if (badgePath) {
    const svg = generateBadgeSvg(result);
    writeFileSync(badgePath, svg);
    process.stdout.write(`✅ Badge saved to ${badgePath}\n`);
    return 0;
  }

  // Terminal output
  const color = result.grade.startsWith("A") ? "\x1b[32m" : result.grade.startsWith("B") ? "\x1b[34m"
    : result.grade.startsWith("C") ? "\x1b[33m" : "\x1b[31m";

  process.stdout.write(`\n  ${color}${result.grade}\x1b[0m  \x1b[1m${result.profile}\x1b[0m  (${result.score}/100)\n\n`);
  process.stdout.write(`  Token budget:  ${formatTokens(result.tokens).padStart(6)}  (score: ${Math.round(result.tokenScore)}/100)\n`);
  process.stdout.write(`  Skill usage:   ${Math.round(result.usageRate * 100)}%`.padEnd(20) + `(score: ${result.usageScore}/100)\n`);
  process.stdout.write(`  Unused skills: ${result.unusedSkills}`.padEnd(20) + `(score: ${result.unusedScore}/100)\n\n`);

  if (result.unusedSkills > 0) {
    process.stdout.write(`  💡 Remove ${result.unusedSkills} unused skill(s) to improve your score.\n`);
    process.stdout.write(`     Run: cue skills audit\n`);
  }

  process.stdout.write(`\n  Badge: cue score --badge docs/assets/score.svg\n`);
  process.stdout.write(`  README: cue score --markdown\n\n`);
  return 0;
}
