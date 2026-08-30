/**
 * `cue suggest` — skill recommendation engine based on session transcript analysis.
 *
 * Scans ~/.claude/projects/**\/*.jsonl for patterns (failed tool calls, repeated
 * topics, unanswered questions) and matches against the full skill catalog to
 * suggest uninstalled skills that would help.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { loadProfile, } from "../lib/profile-loader";
import { listAllSkillIds } from "../lib/resolver-local";
import { resolveProfileForCwd } from "../lib/cwd-resolver";
import { repoRoot } from "../lib/repo-root";

const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");

interface Suggestion {
  skillId: string;
  reason: string;
  mentions: number;
  confidence: number;
}

/**
 * Words that say nothing about what a session was *about*.
 *
 * Two families, both of which used to dominate every score. English function
 * words arrive through skill descriptions — every SKILL.md opens with "Use this
 * when the user asks…", so "use"/"when"/"user" became keywords for the entire
 * catalogue. Transcript-structure words arrive through the raw JSONL, where
 * "assistant", "content" and "tool_result" appear on every single line and are
 * something the format said, not something anyone typed.
 */
const STOPWORDS = new Set([
  // function words (only ones longer than 2 chars can survive tokenizing)
  "the", "and", "for", "are", "was", "were", "been", "being", "does", "did",
  "have", "has", "had", "will", "would", "can", "could", "should", "may",
  "might", "must", "this", "that", "these", "those", "its", "they", "them",
  "their", "you", "your", "yours", "our", "ours", "not", "yes", "all", "any",
  "some", "more", "most", "other", "others", "such", "only", "own", "same",
  "than", "too", "very", "just", "now", "when", "where", "which", "who",
  "whom", "what", "why", "how", "there", "here", "out", "into", "about",
  "after", "before", "between", "during", "through", "each", "few", "both",
  "one", "two", "with", "from", "also", "per", "via", "but", "off", "over",
  "under", "again", "once", "then", "else", "want", "wants", "wanted",
  "need", "needs", "needed", "like", "make", "makes", "made", "give", "gives",
  "let", "lets", "ask", "asks", "asked", "say", "says", "said",
  // "Use when…" boilerplate — present in essentially every skill description
  "use", "uses", "used", "using", "usage",
  // transcript structure — the format's own vocabulary, not the user's
  "user", "users", "human", "assistant", "content", "message", "messages", "role", "tool", "tools",
  "tool_use", "tool_result", "result", "results", "type", "text", "input",
  "output", "json", "true", "false", "null", "uuid", "timestamp", "session",
  "parent", "http", "https", "www", "com", "org", "net",
]);

/** A keyword shorter than this is noise even when it isn't a stopword. */
const MIN_KEYWORD_LENGTH = 3;
/** Total keyword occurrences below which a skill isn't worth surfacing. */
const MIN_MENTIONS = 3;
/**
 * Distinct keywords a skill must match. One repeated word is a coincidence —
 * "design" appearing 80× says nothing about a Figma skill specifically. Two or
 * more of a skill's own vocabulary is a signal.
 */
const MIN_DISTINCT_KEYWORDS = 2;
/**
 * Only a skill's strongest few signals count toward its score.
 *
 * Summing every matched keyword rewards a long description over a relevant
 * one: a skill whose blurb happens to contain forty ordinary words outscores a
 * sharply-matching skill with a terse one. Scoring the best few makes the
 * measure "how strong is the evidence", not "how much prose did the author
 * write".
 */
const TOP_SIGNAL_KEYWORDS = 5;
/**
 * Ceiling on the per-keyword frequency term (≈63 occurrences). Beyond that,
 * repetition says the word is part of the furniture of these sessions, not that
 * the need is sixty times stronger.
 */
const FREQUENCY_LOG_CAP = 6;
/**
 * Weighted score at which confidence reaches ~63%.
 *
 * Calibrated against a real run over this repo's transcripts, where the score
 * distribution across 355 candidates ran p10≈30, p50≈67, p90≈88 — so this puts
 * a median candidate near 0.5 and the strongest near 0.65. Confidence
 * approaches 1 asymptotically and never arrives, which is the honest shape for
 * this measure: counting words in transcripts is a hint, and the old formula's
 * flat 1.00 for every skill claimed a certainty it could not have.
 */
const CONFIDENCE_SCALE = 100;

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

export interface CatalogEntry {
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
      // Tags and id segments go through the same tokenizer as prose, so a
      // multi-word tag ("web design") becomes matchable words rather than a
      // phrase nothing will ever equal, and id filler ("to" in image-to-code)
      // is dropped instead of becoming a keyword.
      if (tagsMatch) keywords.push(...tokenizeText(tagsMatch[1]!.replace(/,/g, " ")));
      if (nameMatch) keywords.push(...tokenizeText(nameMatch[1]!));
      // Add the slug parts
      keywords.push(...tokenizeText(id.replace(/\//g, " ")));

      entries.push({ id, keywords: [...new Set(keywords)] });
    } catch {}
  }
  return entries;
}

/**
 * Split prose into scoring words: lowercased, punctuation-stripped, short and
 * meaningless words removed. Used for both sides of the comparison — skill
 * vocabulary and session text — so the two can be matched as whole words.
 */
export function tokenizeText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length >= MIN_KEYWORD_LENGTH && !STOPWORDS.has(t));
}

/**
 * Count whole-word occurrences across the scanned transcripts, once.
 *
 * The previous implementation scanned the joined text with `indexOf` per
 * keyword, which both counted substrings — "ops" inside "operations", "and"
 * inside "command" — and re-walked megabytes of text for every keyword of every
 * catalogue entry. One tokenizing pass is correct *and* cheaper.
 */
function wordFrequencies(chunks: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const chunk of chunks) {
    for (const word of tokenizeText(chunk)) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }
  }
  return freq;
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

/**
 * Pull just the user's own words out of a transcript chunk.
 *
 * A `.jsonl` transcript is mostly *not* the user: assistant prose, tool names,
 * tool output and file contents dwarf it. Counting the raw bytes is what made
 * `cue suggest` recommend a wedding-invitations skill because "date" appeared
 * 195×, and a robotics skill because "read" — the Read tool — appeared 798×.
 * None of that is a topic anyone raised.
 *
 * Tool results arrive under `role: "user"` too, as `tool_result` parts; only
 * `text` parts are the human talking. Unparseable lines are skipped: the reader
 * takes a byte-bounded prefix of each file, so the last line is usually torn.
 */
export function extractUserPrompts(chunk: string): string {
  const said: string[] = [];
  for (const line of chunk.split("\n")) {
    if (line.length === 0) continue;
    let row: { message?: { role?: string; content?: unknown } };
    try {
      row = JSON.parse(line) as typeof row;
    } catch {
      continue; // truncated or non-JSON line
    }
    const message = row.message;
    if (message?.role !== "user") continue;
    const content = message.content;
    if (typeof content === "string") {
      said.push(content);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const p = part as { type?: string; text?: unknown };
      if (p?.type === "text" && typeof p.text === "string") said.push(p.text);
    }
  }
  return said.join("\n");
}

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
      const said = extractUserPrompts(buf.toString("utf8", 0, n));
      if (said.length > 0) chunks.push(said);
      total += n;
    } catch {}
  }
  return chunks;
}

/** A skill's scoring vocabulary: deduped, stopword-free, long enough to mean
 *  something. Shared by the IDF pass and the scoring pass so both see the same
 *  words. */
function scoringKeywords(entry: CatalogEntry): string[] {
  return [...new Set(entry.keywords)].filter(
    (kw) => kw.length >= MIN_KEYWORD_LENGTH && !STOPWORDS.has(kw),
  );
}

/**
 * How much each keyword distinguishes one skill from the rest of the catalogue.
 *
 * A stopword list only removes words that are common in *English*. It can't
 * know that "mcp", "skill" or "profile" appear in hundreds of these particular
 * skills and therefore separate none of them — while "kubectl" appears in two
 * and separates them sharply. Weighting by catalogue-wide rarity is what stops
 * the busiest word in the transcripts from deciding every recommendation.
 */
function inverseDocFrequency(catalog: CatalogEntry[]): Map<string, number> {
  const docs = new Map<string, number>();
  for (const entry of catalog) {
    for (const kw of scoringKeywords(entry)) docs.set(kw, (docs.get(kw) ?? 0) + 1);
  }
  const total = Math.max(1, catalog.length);
  const idf = new Map<string, number>();
  for (const [kw, n] of docs) idf.set(kw, Math.log(1 + total / (1 + n)));
  return idf;
}

/**
 * Rank uninstalled skills by how strongly the scanned transcripts point at
 * them.
 *
 * A keyword contributes `rarity × log(times seen)`: repetition counts, but with
 * diminishing returns, and a word that half the catalogue shares counts for
 * little however often it appears. The old measure — `min(1, mentions / 50)`
 * over substring hits — reached 1.00 for essentially every skill, so the
 * ranking carried no information and the printed confidence was decorative.
 */
export function scoreSkills(catalog: CatalogEntry[], sessionChunks: string[]): Suggestion[] {
  const freq = wordFrequencies(sessionChunks);
  const idf = inverseDocFrequency(catalog);
  const suggestions: Suggestion[] = [];

  for (const entry of catalog) {
    let mentions = 0;
    const hits: Array<{ kw: string; count: number; weight: number }> = [];
    for (const kw of scoringKeywords(entry)) {
      const count = freq.get(kw) ?? 0;
      if (count === 0) continue;
      const weight =
        (idf.get(kw) ?? 0) * Math.min(Math.log2(1 + count), FREQUENCY_LOG_CAP);
      mentions += count;
      hits.push({ kw, count, weight });
    }
    const matched = hits.length;
    if (matched < MIN_DISTINCT_KEYWORDS || mentions < MIN_MENTIONS) continue;

    hits.sort((a, b) => b.weight - a.weight || b.count - a.count);
    const signals = hits.slice(0, TOP_SIGNAL_KEYWORDS);
    const score = signals.reduce((sum, h) => sum + h.weight, 0);
    const best = signals[0]!;

    suggestions.push({
      skillId: entry.id,
      // Names the keyword that contributed most to the score, counted from the
      // same frequency map — so the stated reason and the ranking can't disagree.
      reason: `${matched} of its keywords in your sessions — "${best.kw}" ${best.count}×`,
      mentions,
      confidence: 1 - Math.exp(-score / CONFIDENCE_SCALE),
    });
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence || b.mentions - a.mentions);
}
