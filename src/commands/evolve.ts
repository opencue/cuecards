/**
 * `cue evolve` — auto-learning loop for profiles.
 *
 * Subcommands:
 *   (default)    — scan sessions, detect gaps, propose skill changes
 *   --apply      — apply the last proposal to profile.yaml
 *   --history    — show evolution log
 */

import { spawnSync } from "node:child_process";
import {
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  appendFileSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { configDir } from "../lib/config-paths";

import { loadProfile, } from "../lib/profile-loader";
import { resolveProfileForCwd } from "../lib/cwd-resolver";

const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cue");
const EVO_LOG = join(CONFIG_DIR, "evolution-log.jsonl");
const SESSIONS_ROOT = join(homedir(), ".claude", "projects");
const DAYS_7 = 7 * 24 * 60 * 60 * 1000;
const DAYS_30 = 30 * 24 * 60 * 60 * 1000;

interface Proposal {
  add: string[];
  remove: string[];
  mcps: string[];
  gaps: string[];
}

// ---------------------------------------------------------------------------
// Session scanning
// ---------------------------------------------------------------------------

function findSessionFiles(maxAge: number): string[] {
  const files: string[] = [];
  const cutoff = Date.now() - maxAge;
  if (!existsSync(SESSIONS_ROOT)) return files;

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".jsonl")) {
        try { if (statSync(p).mtimeMs >= cutoff) files.push(p); } catch {}
      }
    }
  }
  walk(SESSIONS_ROOT);
  return files;
}

function parseSessionLines(files: string[]): any[] {
  const lines: any[] = [];
  for (const f of files) {
    try {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try { lines.push(JSON.parse(line)); } catch {}
      }
    } catch {}
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Pattern detection
// ---------------------------------------------------------------------------

// Safely extract searchable text from a session-log line. Claude JSONL stores
// `message` as an object ({ role, content }), so a naive `l.message ?? ""` yields
// an object and crashes on `.toLowerCase()`. Mirror detectErrors' JSON.stringify
// fallback so non-string payloads degrade to text instead of throwing.
export function lineText(l: any): string {
  if (typeof l?.content === "string") return l.content;
  if (typeof l?.message === "string") return l.message;
  const c = l?.message?.content ?? l?.content;
  if (typeof c === "string") return c;
  if (c != null) return JSON.stringify(c);
  return "";
}

function detectGaps(lines: any[]): Map<string, number> {
  const topics = new Map<string, number>();
  const gapPatterns = /\b(can you|how do i|how to|help me|is there a way)\b/i;

  for (const msg of lines) {
    if (msg.role !== "user" && msg.type !== "human") continue;
    const text = lineText(msg);
    if (!gapPatterns.test(text)) continue;
    // Extract topic: first 3-4 meaningful words after the pattern
    const match = text.match(gapPatterns);
    if (!match) continue;
    const after = text.slice((match.index ?? 0) + match[0].length).trim().split(/\s+/).slice(0, 4).join(" ").toLowerCase();
    if (after.length > 3) topics.set(after, (topics.get(after) ?? 0) + 1);
  }
  return topics;
}

function detectErrors(lines: any[]): string[] {
  const errors: string[] = [];
  for (const msg of lines) {
    if (msg.type === "tool_result" && msg.is_error) {
      const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
      if (text.length > 5) errors.push(text.slice(0, 120));
    }
  }
  return errors;
}

function checkSkillUsage(lines: any[], skills: string[]): { used: string[]; unused: string[] } {
  const content = lines.map(l => lineText(l).toLowerCase()).join("\n");

  const used: string[] = [];
  const unused: string[] = [];
  for (const skill of skills) {
    const name = skill.split("/").pop()!.toLowerCase().replace(/-/g, " ");
    if (content.includes(name) || content.includes(skill.toLowerCase())) used.push(skill);
    else unused.push(skill);
  }
  return { used, unused };
}

// ---------------------------------------------------------------------------
// GitHub search for gap-filling skills
// ---------------------------------------------------------------------------

function ghSearchSkills(query: string): string[] {
  const res = spawnSync("gh", [
    "api", "search/repositories",
    "--method", "GET",
    "-f", `q=path:SKILL.md ${query}`,
    "-f", "per_page=5",
    "-f", "sort=stars",
    "--jq", ".items[].full_name",
  ], { encoding: "utf8", timeout: 15000 });
  if (res.status !== 0) return [];
  return res.stdout.trim().split("\n").filter(Boolean);
}

// ---------------------------------------------------------------------------
// Proposal generation
// ---------------------------------------------------------------------------

async function generateProposal(profileName: string): Promise<Proposal> {
  const profile = await loadProfile(profileName);
  const skills = [
    ...profile.skills.local.map((s) => s.id),
    ...profile.skills.npx.flatMap((ref) => ref.skills),
  ];

  const recentFiles = findSessionFiles(DAYS_7);
  const allFiles = findSessionFiles(DAYS_30);
  const recentLines = parseSessionLines(recentFiles);
  const allLines = parseSessionLines(allFiles);

  // Detect gaps (asked 3+ times, no skill covers it)
  const gaps = detectGaps(recentLines);
  const significantGaps = [...gaps.entries()].filter(([, count]) => count >= 3).map(([topic]) => topic);

  // Detect errors
  const errors = detectErrors(recentLines);

  // Check skill usage over 30 days
  const { unused } = checkSkillUsage(allLines, skills);

  // Search for skills to fill gaps
  const suggestions: string[] = [];
  for (const gap of significantGaps.slice(0, 3)) {
    suggestions.push(...ghSearchSkills(gap));
  }

  return {
    add: [...new Set(suggestions)].slice(0, 5),
    remove: unused.slice(0, 5),
    mcps: [],
    gaps: significantGaps,
  };
}

// ---------------------------------------------------------------------------
// Apply proposal
// ---------------------------------------------------------------------------

async function applyProposal(profileName: string, proposal: Proposal): Promise<void> {
  const profilesDir = resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "profiles");
  const yamlPath = join(profilesDir, profileName, "profile.yaml");
  if (!existsSync(yamlPath)) {
    process.stderr.write(`❌ Profile YAML not found: ${yamlPath}\n`);
    return;
  }

  let content = readFileSync(yamlPath, "utf8");

  // Append new skills under local: section
  for (const skill of proposal.add) {
    if (!content.includes(skill)) {
      content = content.replace(/(local:\s*\n)/,  `$1    - ${skill}\n`);
    }
  }

  // Remove unused skills
  for (const skill of proposal.remove) {
    content = content.replace(new RegExp(`\\s*-\\s*${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n?`), "\n");
  }

  writeFileSync(yamlPath, content);

  // Log the evolution
  const entry = { ts: new Date().toISOString(), profile: profileName, added: proposal.add, removed: proposal.remove, gaps: proposal.gaps };
  mkdirSync(dirname(EVO_LOG), { recursive: true });
  appendFileSync(EVO_LOG, JSON.stringify(entry) + "\n");

  process.stdout.write(`✅ Applied: +${proposal.add.length} skills, -${proposal.remove.length} skills\n`);
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function showHistory(): void {
  if (!existsSync(EVO_LOG)) {
    process.stdout.write("No evolution history yet.\n");
    return;
  }
  const lines = readFileSync(EVO_LOG, "utf8").trim().split("\n");
  for (const line of lines.slice(-20)) {
    try {
      const e = JSON.parse(line);
      process.stdout.write(`${e.ts}  ${e.profile}  +${e.added?.length ?? 0}/-${e.removed?.length ?? 0}  gaps: ${(e.gaps ?? []).join(", ")}\n`);
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function run(args: string[]): Promise<number> {
  const showHelp = args.includes("--help") || args.includes("-h");
  if (showHelp) {
    process.stdout.write(`Usage: cue evolve [--apply] [--history] [profile]

  (default)   Scan sessions, detect gaps, propose skill changes
  --apply     Apply the last proposal to profile.yaml
  --history   Show evolution log (what was added/removed and when)
`);
    return 0;
  }

  if (args.includes("--history")) { showHistory(); return 0; }

  // Resolve profile
  const cfgDir = configDir();
  const explicit = args.find(a => !a.startsWith("-"));
  let profileName = explicit;
  if (!profileName) {
    const resolved = await resolveProfileForCwd({ cwd: process.cwd(), homeDir: homedir(), configDir: cfgDir });
    profileName = "profile" in resolved ? resolved.profile : "core";
  }

  process.stdout.write(`🧬 Evolving profile: ${profileName}\n\n`);

  const proposal = await generateProposal(profileName);

  if (!proposal.gaps.length && !proposal.remove.length && !proposal.add.length) {
    process.stdout.write("✅ Profile is well-adapted — no changes suggested.\n");
    return 0;
  }

  if (proposal.gaps.length) {
    process.stdout.write(`📊 Detected gaps (asked 3+ times, no skill covers):\n`);
    for (const g of proposal.gaps) process.stdout.write(`   • ${g}\n`);
    process.stdout.write("\n");
  }

  if (proposal.remove.length) {
    process.stdout.write(`🗑️  Unused skills (30+ days, candidates for removal):\n`);
    for (const s of proposal.remove) process.stdout.write(`   • ${s}\n`);
    process.stdout.write("\n");
  }

  if (proposal.add.length) {
    process.stdout.write(`💡 Suggested skills to add:\n`);
    for (const s of proposal.add) process.stdout.write(`   • ${s}\n`);
    process.stdout.write("\n");
  }

  if (args.includes("--apply")) {
    await applyProposal(profileName, proposal);
  } else {
    process.stdout.write("Run with --apply to apply these changes.\n");
  }

  return 0;
}
