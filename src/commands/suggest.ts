/**
 * `cue suggest` — skill recommendation engine based on session transcript analysis.
 *
 * Scans ~/.claude/projects/**\/*.jsonl for patterns (failed tool calls, repeated
 * topics, unanswered questions) and matches against the full skill catalog to
 * suggest uninstalled skills that would help.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { loadProfile, } from "../lib/profile-loader";
import { listAllSkillIds } from "../lib/resolver-local";
import { resolveProfileForCwd } from "../lib/cwd-resolver";

const REPO_ROOT = process.env.CUE_REPO_ROOT ?? process.env.SOUL_REPO_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_ROOT = join(REPO_ROOT, "resources", "skills", "skills");

interface Suggestion {
  skillId: string;
  reason: string;
  mentions: number;
  confidence: number;
}

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue suggest — skill recommendations based on session analysis

Usage:
  cue suggest [--days N] [--json] [--profile <name>]

Options:
  --days N       Analyze last N days of sessions (default: 7)
  --json         Machine-readable output
  --profile <n>  Override active profile
`);
    return 0;
  }

  const json = args.includes("--json");
  const daysIdx = args.indexOf("--days");
  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1] ?? "7", 10) : 7;
  const profileIdx = args.indexOf("--profile");
  let profileName = profileIdx >= 0 ? args[profileIdx + 1] : undefined;

  if (!profileName) {
    try {
      const result = await resolveProfileForCwd({ cwd: process.cwd(), homeDir: homedir(), configDir: join(homedir(), ".config", "cue") });
      if (result.source !== "none") profileName = result.profile;
    } catch {}
  }

  if (!profileName) {
    process.stderr.write("No active profile. Pin one first: cue use <profile>\n");
    return 1;
  }

  const profile = await loadProfile(profileName);
  const installedIds = new Set(profile.skills.local.map(s => s.id));

  // Get all available skills with their keywords
  const allSkillIds = await listAllSkillIds();
  const catalog = buildCatalog(allSkillIds.filter(id => !installedIds.has(id)));

  // Scan session transcripts
  const cutoff = Date.now() - days * 86400_000;
  const sessionContent = scanSessions(cutoff);

  if (!sessionContent.length) {
    process.stdout.write("No session transcripts found in the last " + days + " days.\n");
    return 0;
  }

  // Score each uninstalled skill
  const suggestions = scoreSkills(catalog, sessionContent);

  if (json) {
    process.stdout.write(JSON.stringify({ profile: profileName, days, suggestions }, null, 2) + "\n");
    return 0;
  }

  if (suggestions.length === 0) {
    process.stdout.write("✅ No skill gaps detected in your recent sessions.\n");
    return 0;
  }

  process.stdout.write(`\n  💡 Based on your last ${days} days of sessions, these skills would help:\n\n`);
  for (const s of suggestions.slice(0, 10)) {
    process.stdout.write(`  \x1b[1m${s.skillId}\x1b[0m — ${s.reason} (confidence: ${(s.confidence).toFixed(2)})\n`);
  }
  process.stdout.write(`\n  Install with: cue skills add-to-profile <skill-id>\n\n`);
  return 0;
}

interface CatalogEntry {
  id: string;
  keywords: string[];
}

function buildCatalog(skillIds: string[]): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const id of skillIds) {
    const skillPath = join(SKILLS_ROOT, id, "SKILL.md");
    try {
      const content = readFileSync(skillPath, "utf8");
      // Extract keywords from frontmatter description + name + tags
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      const fm = fmMatch?.[1] ?? "";
      const descMatch = fm.match(/^description:\s*(.+)$/m);
      const tagsMatch = fm.match(/^tags:\s*\[(.+)\]/m);
      const nameMatch = fm.match(/^name:\s*(.+)$/m);

      const keywords: string[] = [];
      if (descMatch) keywords.push(...tokenizeText(descMatch[1]!));
      if (tagsMatch) keywords.push(...tagsMatch[1]!.split(",").map(t => t.trim().toLowerCase()));
      if (nameMatch) keywords.push(...tokenizeText(nameMatch[1]!));
      // Add the slug parts
      keywords.push(...id.split("/").flatMap(p => p.split("-")));

      entries.push({ id, keywords: [...new Set(keywords)] });
    } catch {}
  }
  return entries;
}

function tokenizeText(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(t => t.length > 2);
}

// Bound the session scan so `cue suggest` stays fast regardless of how large
// the user's history is: read the most-recent transcripts first, up to a file
// and total-byte budget. Without this, a heavy user's ~/.claude/projects (many
// large .jsonl files) makes both this scan and scoreSkills run for minutes.
// `CUE_SUGGEST_SESSIONS_DIR` overrides the source dir (tests use it to stay
// hermetic). Transcripts beyond the budget are skipped — recent sessions are
// the relevant signal anyway.
const MAX_SESSION_FILES = 100;
const MAX_SESSION_BYTES = 2_000_000;
const PER_FILE_BYTES = 100_000;

function scanSessions(cutoffMs: number): string[] {
  const projectsDir = process.env.CUE_SUGGEST_SESSIONS_DIR ?? join(homedir(), ".claude", "projects");
  if (!existsSync(projectsDir)) return [];

  // Collect candidate transcripts newer than the cutoff, with mtime for ranking.
  const candidates: Array<{ path: string; mtimeMs: number }> = [];
  try {
    const dirs = readdirSync(projectsDir).filter(d => {
      try { return statSync(join(projectsDir, d)).isDirectory(); } catch { return false; }
    });
    for (const dir of dirs) {
      const dirPath = join(projectsDir, dir);
      let files: string[];
      try { files = readdirSync(dirPath).filter(f => f.endsWith(".jsonl")); } catch { continue; }
      for (const f of files) {
        const fPath = join(dirPath, f);
        try {
          const st = statSync(fPath);
          if (st.mtimeMs < cutoffMs) continue;
          candidates.push({ path: fPath, mtimeMs: st.mtimeMs });
        } catch {}
      }
    }
  } catch {}

  // Most-recent first, then read up to the file/byte budget.
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const fs = require("node:fs");
  const chunks: string[] = [];
  let total = 0;
  for (const { path: fPath } of candidates) {
    if (chunks.length >= MAX_SESSION_FILES || total >= MAX_SESSION_BYTES) break;
    try {
      const fd = fs.openSync(fPath, "r");
      const buf = Buffer.alloc(PER_FILE_BYTES);
      const n = fs.readSync(fd, buf, 0, PER_FILE_BYTES, 0);
      fs.closeSync(fd);
      chunks.push(buf.toString("utf8", 0, n));
      total += n;
    } catch {}
  }
  return chunks;
}

function scoreSkills(catalog: CatalogEntry[], sessionChunks: string[]): Suggestion[] {
  const combined = sessionChunks.join(" ").toLowerCase();
  const suggestions: Suggestion[] = [];

  for (const entry of catalog) {
    let mentions = 0;
    for (const kw of entry.keywords) {
      if (kw.length < 3) continue;
      // Count occurrences in session content
      let idx = 0;
      while ((idx = combined.indexOf(kw, idx)) !== -1) {
        mentions++;
        idx += kw.length;
      }
    }
    if (mentions < 3) continue;

    const confidence = Math.min(1, mentions / 50);
    const topKeyword = entry.keywords.reduce((best, kw) => {
      const count = (combined.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
      return count > best.count ? { kw, count } : best;
    }, { kw: "", count: 0 });

    suggestions.push({
      skillId: entry.id,
      reason: `you mentioned "${topKeyword.kw}" ${topKeyword.count} times`,
      mentions,
      confidence,
    });
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence || b.mentions - a.mentions);
}
