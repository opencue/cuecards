/**
 * `cue discover` — find hidden gem skill repos and export a curated index.
 *
 * Subcommands:
 *   search [query]          — search GitHub for undiscovered skill repos
 *   list                    — show already-discovered gems (from cache)
 *   --export [path]         — generate docs/discovered.md
 *   --json                  — JSON output
 *   --min-score <n>         — minimum gem score to include (default: 3)
 *   --limit <n>             — max results (default: 50)
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { loadProfile, listProfiles } from "../lib/profile-loader";
import { clusterByKeywords, clusterByEmbeddings, unclustered, type Cluster, type ClusterItem } from "../lib/cluster-skills";
import { findRealClaudeBin } from "../lib/claude-binary";
import { fetchCompanionFiles, detectSkillPath } from "../lib/companion-fetch";

const REPO_ROOT = process.env.CUE_REPO_ROOT ?? process.env.SOUL_REPO_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Cache path resolved lazily so tests can redirect via XDG_CONFIG_HOME without
// re-importing the module. (Bun shares module state across test files; const
// values captured at import time wouldn't see runtime env changes.)
function cacheDir(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cue", "discover");
}
function cacheFile(): string { return join(cacheDir(), "gems.json"); }
const DEFAULT_EXPORT = join(REPO_ROOT, "docs", "discovered.md");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GemRepo {
  full_name: string;
  owner: string;
  name: string;
  description: string;
  stars: number;
  forks: number;
  created_at: string;
  pushed_at: string;
  topics: string[];
  language: string;
  has_skill_md: boolean;
  has_claude_dir: boolean;
  has_mcp_sdk: boolean;
  gem_score: number;
  suggested_profiles: string[];
  suggested_mcps: string[];
  suggested_clis: string[];
  quality: number;
  url: string;
}

interface GemCache {
  updated: string;
  gems: GemRepo[];
}

/** Get cached gems filtered by profile and minimum score. Returns [] if no cache. */
export function getCachedGemsForProfile(profile: string, minScore = 8): GemRepo[] {
  if (!existsSync(cacheFile())) return [];
  try {
    const cache: GemCache = JSON.parse(readFileSync(cacheFile(), "utf8"));
    return cache.gems
      .filter(g => g.gem_score >= minScore && g.suggested_profiles.includes(profile))
      .sort((a, b) => b.gem_score - a.gem_score);
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// GitHub search queries for hidden gems
// ---------------------------------------------------------------------------

const SEARCH_QUERIES = [
  // Catch-all SKILL.md scan. A `stars:>=1` floor excludes the wave of pure
  // LLM-dump repos (zero stars, freshly minted) that flooded results without
  // killing legitimate early-stage skills that already attracted at least one
  // user beyond the author themself.
  { q: "path:SKILL.md stars:>=1", label: "has SKILL.md (★≥1)" },
  // .claude directory — recent activity only
  { q: "path:.claude pushed:>{RECENT} stars:>=1", label: "has .claude/ (★≥1)" },
  // Topic-based — authors who bothered to topic-tag have already self-selected
  { q: "topic:claude-skill", label: "topic:claude-skill" },
  { q: "topic:claude-code-skill", label: "topic:claude-code-skill" },
  { q: "topic:mcp-server pushed:>{RECENT}", label: "topic:mcp-server" },
  { q: "topic:ai-agent-skill", label: "topic:ai-agent-skill" },
  { q: "topic:agent-skill stars:>=2", label: "topic:agent-skill (★≥2)" },
  // Frontmatter patterns (allowed-tools is a real skill marker, not just topic)
  { q: "\"allowed-tools\" in:file extension:md pushed:>{RECENT} stars:>=1", label: "allowed-tools frontmatter (★≥1)" },
  // MCP SDK dependents — package.json import signals a working server
  { q: "\"@modelcontextprotocol/sdk\" in:file filename:package.json stars:>=2", label: "MCP SDK users (★≥2)" },
  // Popular tier — known-quality high-star repos. These need no filter.
  { q: "path:SKILL.md stars:>50", label: "popular skills (★50+)" },
  { q: "topic:claude-code stars:>100", label: "popular claude-code (★100+)" },
  { q: "topic:mcp-server stars:>100", label: "popular MCP servers (★100+)" },
  { q: "\"claude\" \"skill\" in:readme stars:>200 pushed:>{RECENT}", label: "popular claude repos (★200+)" },
  // Verified-org sources — repos under well-known skill publishers. High
  // base-rate of quality; we accept them even without star floors.
  { q: "path:SKILL.md user:anthropics", label: "anthropics-owned skills" },
  { q: "path:SKILL.md user:vercel-labs", label: "vercel-labs skills" },
];

function recentDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().split("T")[0]!;
}

// ---------------------------------------------------------------------------
// Gem scoring
// ---------------------------------------------------------------------------

const SLOP_OPENERS = [
  /^(production-grade|premium saas|local-first ai|enterprise-ready|next-gen)\b/i,
  /\bauto-fill\s+ATS\b/i,
  /\bcertified\s+(architect|professional)\s+exam/i,
  /\bLibrary OS\b/i,
];

/** Spot obvious AI-generated/dump repos that hit search but aren't gems. */
export function isLikelySpam(repo: GemRepo): boolean {
  const desc = (repo.description ?? "").trim();
  const created = repo.created_at ? new Date(repo.created_at).getTime() : Date.now();
  const daysSinceCreation = (Date.now() - created) / 86400000;

  // "Truly engaged" — non-trivial stars or forks. Used as the safety override
  // for the hard signals below, so legit accounts that happen to have numeric
  // usernames or year-stamped repo names aren't culled.
  const trulyEngaged = repo.stars >= 5 || repo.forks >= 2;

  // HARD spam signals — applied even when SKILL.md is present, because
  // LLM-spam pipelines now cargo-cult SKILL.md to game the discovery query.
  //
  // (1) Owner with a high-entropy numeric tail: Axelendometrial4386,
  //     Leontynestirredup43, Lepidochelyscleavage180, karthik768990, …
  //     These are essentially all LLM-generated throwaway accounts.
  const ownerNumericTail = /[a-zA-Z][0-9]{3,}$/.test(repo.owner);
  if (ownerNumericTail && !trulyEngaged) return true;

  // (2) Year-stamped repo names: foo-2026, editor_pack_v3_2026-03-17.
  //     A year suffix on a brand-new repo with zero engagement is a tell.
  const yearInName = /(^|[_-])(2025|2026)([_-]|$)/.test(repo.name);
  if (yearInName && !trulyEngaged) return true;

  // SKILL.md is load-bearing for the remaining soft checks — accept.
  if (repo.has_skill_md) return false;

  // SOFT signals — only flag freshly-created repos with zero engagement.
  const freshAndDead = daysSinceCreation < 14 && repo.stars === 0 && repo.forks === 0;
  if (!freshAndDead) return false;

  const slopDesc = SLOP_OPENERS.some(re => re.test(desc));
  return slopDesc || desc.length === 0;
}

/** One score component — used for the breakdown view (`--explain-score`). */
export interface ScoreComponent {
  label: string;
  delta: number;
}

// ---------------------------------------------------------------------------
// Niche / regional-vertical detection
// ---------------------------------------------------------------------------

/**
 * Regex hits for repos whose primary subject is a regional product, narrow
 * consumer vertical, or non-software niche. These repos commonly score high
 * (stars + SKILL.md + topic tags) but are irrelevant to cue's mainstream
 * developer users — they shouldn't crowd out fleet/MCP/code-intel gems in the
 * `core` bucket.
 *
 * Match scope: description + repo name. CJK script ranges included so we catch
 * `造价大师`, `倪海厦`, `恋爱聊天` even when the English desc is empty.
 */
const NICHE_VERTICALS: RegExp[] = [
  // Traditional Chinese medicine / acupuncture / herbal / TCM teachers
  /\b(tcm|traditional chinese medicine|acupuncture|herbology|chinese herbal)\b/i,
  /(中医|针灸|经方|伤寒论|金匮要略|黄帝内经|神农本草经|倪海厦|针灸篇|人纪|医案)/,
  // Chinese construction cost engineering / 造价
  /(造价|GB\/T 50500|定额|广联达|建设工程造价)/,
  // BOSS 直聘 / job-board niche
  /(直聘|招聘者|BOSS直聘)/,
  // Religion / theology / Bible-only tooling
  /\b(bible[- ]?study|biblical|theology|concordance|hebrew[- ]?aramaic|true[- ]?gospel)\b/i,
  // Dating / relationship coach
  /\b(dating[- ]?coach|relationship[- ]?coach|romance[- ]?coach|love[- ]?coach)\b/i,
  /(恋爱聊天|恋爱教练|相亲|追女生|追男生)/,
  // K-pop / Korean cosmetics / Korean dermatology booking / K-retail
  /\b(k[- ]?pop[- ]?booking|k[- ]?beauty|korea[n]?[- ]?(retail|dermatology|cosmetics|booking|store))\b/i,
  /(韩流|韩剧|韩国美容|韩国整形)/,
  // Hospital / cinema / store local-retail lookups (Daiso, Don Quijote, FamilyMart…)
  /\b(daiso|don[- ]?quijote|family[- ]?mart|seven[- ]?eleven[- ]?japan)\b/i,
  // App-store deployment automation (Apple Connect / TencentAS / Huawei niche)
  /\b(app[- ]?store[- ]?(connect|deployment)[- ]?automation|tencent[- ]?appstore|huawei[- ]?gallery)\b/i,
  // Region-specific privacy / legal templates (Korean, Japanese, EU-specific)
  /\b(korean[- ]?privacy|korean[- ]?law|japan[- ]?privacy|china[- ]?compliance)\b/i,
  // Embedded hobby firmware (ESP32, Pico, Arduino IoT toys)
  /\b(esp32|esp8266|raspberry[- ]?pi[- ]?pico|arduino[- ]?nano)\b/i,
  /(xiaozhi|小智|esp32-server)/i,
  // Niche regional design-tool importers
  /\b(mockplus|摹客|sketch[- ]?importer|figma[- ]?taobao)\b/i,
  // China-grant / China-specific funding helpers
  /\b(china[- ]?grant|cn[- ]?biology[- ]?grant|grant[- ]?thinking)\b/i,
  // Slang / colloquial niche
  /(devil[- ]?chat[- ]?coach|chat[- ]?coach[- ]?bot)/i,
  // Strict reading / niche literary distillations
  /(machiavelli[- ]?skill|马基雅维利|论语|孟子|庄子)/i,
];

/**
 * True iff the repo is locale-bound or vertical-niche by:
 *   (a) Hitting any NICHE_VERTICALS regex on description+name, OR
 *   (b) Description is >40% CJK chars AND contains no English keyword from
 *       any cue profile (escape hatch: a Chinese-described AI router that
 *       mentions e.g. "openai/proxy/mcp" still counts as a generic tool).
 *
 * Pure / deterministic. Used by scoreGemBreakdown (penalty) and
 * suggestProfiles (routes to `niche` bucket instead of `core`).
 */
export function hasNicheTopicSignal(repo: GemRepo): boolean {
  const desc = repo.description ?? "";
  const name = repo.name ?? "";
  const subject = `${desc} ${name}`;

  for (const re of NICHE_VERTICALS) {
    if (re.test(subject)) return true;
  }

  // CJK density: any of Han (Chinese), Hiragana/Katakana (Japanese),
  // Hangul (Korean), or CJK fullwidth punctuation.
  const cjkChars = (desc.match(/[　-鿿가-힯＀-￯]/g) ?? []).length;
  const cjkDensity = desc.length > 0 ? cjkChars / desc.length : 0;
  if (cjkDensity >= 0.4) {
    const descLower = desc.toLowerCase();
    // Escape hatch: any English profile-keyword OR generic AI-tool words.
    const allKeywords = Object.values(PROFILE_KEYWORDS).flat();
    const aiToolWords = ["claude", "openai", "gemini", "anthropic", "mcp", "agent", "skill", "proxy", "router", "gateway"];
    const escapes = [...allKeywords, ...aiToolWords];
    const hasEnglishSignal = escapes.some(kw => descLower.includes(kw));
    if (!hasEnglishSignal) return true;
  }

  return false;
}

/**
 * Returns score + per-factor breakdown. Pure: no I/O, deterministic.
 *
 * Keep additions multiplicative-resistant — if you add a factor, balance it
 * against the existing fixture ranges in discover.scoring.test.ts.
 */
export function scoreGemBreakdown(repo: GemRepo): { score: number; components: ScoreComponent[] } {
  if (isLikelySpam(repo)) return { score: 0, components: [{ label: "likely spam", delta: 0 }] };

  const now = Date.now();
  const pushed = repo.pushed_at ? new Date(repo.pushed_at).getTime() : now;
  const created = repo.created_at ? new Date(repo.created_at).getTime() : now;
  const daysSincePush = (now - pushed) / 86400000;
  const ageDays = (now - created) / 86400000;

  const cs: ScoreComponent[] = [];
  const add = (label: string, delta: number) => { if (Math.abs(delta) >= 0.05) cs.push({ label, delta }); };

  // Recency: smooth decay, half-life ~60 days.
  add(`recency (push ${Math.round(daysSincePush)}d ago)`, 3 * Math.exp(-daysSincePush / 60));

  // Real skill signals (file-level evidence)
  if (repo.has_skill_md) add("has SKILL.md", 5);
  if (repo.has_claude_dir) add("has .claude/", 3);
  if (repo.has_mcp_sdk) add("uses MCP SDK", 2);

  // Topic hits — count + diversity bonus
  const gemTopics = ["claude-skill", "claude-code", "mcp-server", "ai-agent", "codex-plugin", "claude-code-skill", "agent-skill"];
  const matchingTopics = repo.topics.filter(t => gemTopics.includes(t));
  const topicHits = Math.min(3, matchingTopics.length);
  if (topicHits > 0) add(`relevant topics (×${topicHits})`, topicHits * 2);
  // Diversity bonus: hits across both "claude-*" AND "mcp-*"/agent-* categories
  const hasClaudeTopic = matchingTopics.some(t => t.startsWith("claude"));
  const hasAgentOrMcpTopic = matchingTopics.some(t => t.startsWith("mcp") || t.includes("agent"));
  if (hasClaudeTopic && hasAgentOrMcpTopic) add("topic diversity (claude+agent/mcp)", 0.5);

  // Star curve
  add(`stars (${repo.stars}★)`, Math.min(2.5, Math.log(1 + repo.stars) * 0.5));

  // Proven gem: high stars + skill-related content
  if (repo.stars >= 50) {
    const descLower = (repo.description ?? "").toLowerCase();
    const isSkillRepo = descLower.includes("skill") || descLower.includes("mcp") || descLower.includes("claude") || descLower.includes("agent");
    if (isSkillRepo) add("proven gem (≥50★ + skill desc)", 3);
  }
  if (repo.stars >= 500) add("highly proven (≥500★)", 2);

  // Fork-to-star ratio
  if (repo.stars >= 5 && repo.forks > 0) {
    const ratio = repo.forks / repo.stars;
    if (ratio >= 0.1) add(`fork ratio ≥0.10 (${repo.forks}⑂)`, 1);
    if (ratio >= 0.3) add("fork ratio ≥0.30 (strong reuse)", 1);
  }

  // Description quality
  const desc = (repo.description ?? "").trim();
  if (desc.length >= 40 && desc.length <= 200) add("description length 40-200 chars", 1);

  // Penalty: year-stamped description (2025/2026 in desc — marketing slop signal)
  if (!repo.has_skill_md && /\b(2025|2026)\b/.test(desc)) add("year-stamped description", -0.5);

  // Penalty: owner with high-entropy numeric tail (bot/dump signal — only when no SKILL.md)
  if (!repo.has_skill_md && /[a-zA-Z][0-9]{3,}$/.test(repo.owner)) add("owner numeric tail", -1);

  // Penalty: year-stamped repo name (already partly caught by spam filter; reinforces for borderline cases)
  if (!repo.has_skill_md && /(^|[_-])(2025|2026)([_-]|$)/.test(repo.name)) add("year-stamped repo name", -1);

  // Mature AND actively maintained: >90 days old, pushed in last 30
  if (ageDays > 90 && daysSincePush < 30) add("mature + actively maintained", 1.5);

  // Earned-attention bonus: stars accrued over real time
  if (repo.stars >= 5 && ageDays > 60) add("earned attention (stars × age)", Math.min(1, Math.log(1 + repo.stars * ageDays / 365) * 0.15));

  // Stale penalty
  if (daysSincePush > 365) add("stale (>1yr no push)", -3);

  // Niche/regional vertical penalty — keeps locale-bound repos out of the
  // premium tier (score ≥12) without erasing them entirely. Gated at <500★
  // so genuinely massive cross-locale projects aren't punished for having a
  // Chinese-language description.
  if (repo.stars < 500 && hasNicheTopicSignal(repo)) add("niche/regional vertical", -2.5);

  const raw = cs.reduce((s, c) => s + c.delta, 0);
  const score = Math.max(0, Math.round(raw * 10) / 10);
  return { score, components: cs };
}

export function scoreGem(repo: GemRepo): number {
  return scoreGemBreakdown(repo).score;
}

// ---------------------------------------------------------------------------
// Render helpers — colors, formatting, slop strip, freshness, install detection
// ---------------------------------------------------------------------------

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};
const wrap = (color: string, s: string): string => `${color}${s}${ANSI.reset}`;

/** Strip marketing-slop openers from a description so the real feature shows first. */
export function stripSlopOpener(desc: string): string {
  let s = desc.trim();
  for (const re of SLOP_OPENERS) s = s.replace(re, "").trim();
  s = s.replace(/^[—:·\-,]\s*/, "").trim();           // dangling punctuation after strip
  s = s.replace(/^\d{4}\s*(:|—|-)\s*/, "").trim();    // "2026 - actual feature" → "actual feature"
  s = s.replace(/^Best\s+(?:AI\s+)?[A-Z][a-z]+\s+\d{4}:?\s*/i, "").trim();  // "Best AI Code Architect 2026:"
  return s;
}

/** Word-wrap to width, returning lines with the given hanging indent on continuations. */
export function wrapText(text: string, width: number, indent: string): string[] {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line.length + 1 + w.length > width && line) {
      lines.push(line);
      line = indent + w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Color stars by tier: magenta ≥1000, green ≥100, yellow ≥10, gray <10. */
export function colorStars(n: number): string {
  if (n >= 1000) return wrap(ANSI.magenta + ANSI.bold, `★ ${n}`);
  if (n >= 100) return wrap(ANSI.green, `★ ${n}`);
  if (n >= 10) return wrap(ANSI.yellow, `★ ${n}`);
  return wrap(ANSI.gray, `★ ${n}`);
}

/** Pretty "Nd ago" / "Nw ago" / "Nmo ago" / "Nyr ago". */
export function freshnessLabel(pushed_at: string): string {
  if (!pushed_at) return "unknown";
  const days = Math.floor((Date.now() - new Date(pushed_at).getTime()) / 86400000);
  if (days < 0) return "in future";
  if (days === 0) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}yr ago`;
}

/** Green if hot (<14d), yellow if warm (<60d), gray if cold (<365d), red if stale. */
export function freshnessColor(pushed_at: string): string {
  if (!pushed_at) return ANSI.gray;
  const days = Math.floor((Date.now() - new Date(pushed_at).getTime()) / 86400000);
  if (days < 14) return ANSI.green;
  if (days < 60) return ANSI.yellow;
  if (days < 365) return ANSI.gray;
  return ANSI.red;
}

/** Tier name + tier color for a score. */
export function tierName(score: number): string {
  if (score >= 12) return "premium";
  if (score >= 8) return "strong";
  if (score >= 5) return "worth";
  return "tail";
}
export function tierColorFor(score: number): string {
  if (score >= 12) return ANSI.magenta;
  if (score >= 8) return ANSI.cyan;
  if (score >= 5) return ANSI.yellow;
  return ANSI.gray;
}

/**
 * Scan all profile.yaml files for a skill ref matching the gem's name or
 * `owner/name` slug. Returns the list of profiles that already include it.
 * Cheap enough to call per-gem (cached once per session via the closure pattern
 * in renderers).
 */
export function getInstalledIn(gem: GemRepo, profilesDir = join(REPO_ROOT, "profiles")): string[] {
  if (!existsSync(profilesDir)) return [];
  const hits: string[] = [];
  const slugs = [gem.name.toLowerCase(), gem.full_name.toLowerCase()];
  try {
    const profiles = require("node:fs").readdirSync(profilesDir);
    for (const p of profiles) {
      if (p.startsWith("_") || p.startsWith(".")) continue;
      const yaml = join(profilesDir, p, "profile.yaml");
      if (!existsSync(yaml)) continue;
      const content = readFileSync(yaml, "utf8").toLowerCase();
      if (slugs.some(s => content.includes(s))) hits.push(p);
    }
  } catch { /* ignore */ }
  return hits;
}

/** Detect active profile from cwd (`.cue-profile` file). Returns undefined if none. */
export function getActiveProfile(cwd: string = process.cwd()): string | undefined {
  const f = join(cwd, ".cue-profile");
  if (!existsSync(f)) return undefined;
  try {
    const s = readFileSync(f, "utf8").trim();
    return s || undefined;
  } catch { return undefined; }
}

// ---------------------------------------------------------------------------
// Filters — `cue discover` supports many slicing dimensions over GemRepo[]
// ---------------------------------------------------------------------------

export interface GemFilter {
  minStars?: number;
  maxStars?: number;
  freshDays?: number;       // pushed within last N days
  staleDays?: number;       // pushed more than N days ago
  hasMcp?: boolean;
  hasSkillMd?: boolean;
  hasClaudeDir?: boolean;
  language?: string;        // case-insensitive
  topic?: string;           // case-insensitive substring
  owner?: string;
  excludeOwner?: string;
  tier?: Set<"premium" | "strong" | "worth" | "tail">;
  profile?: string;         // gem suggested_profiles includes this
  installed?: boolean;      // gem is referenced by some profile.yaml
  notInstalled?: boolean;
}

export function applyFilters(gems: GemRepo[], f: GemFilter): GemRepo[] {
  if (!Object.keys(f).length) return gems;
  return gems.filter(g => {
    if (f.minStars !== undefined && g.stars < f.minStars) return false;
    if (f.maxStars !== undefined && g.stars > f.maxStars) return false;
    if (f.freshDays !== undefined) {
      const days = (Date.now() - new Date(g.pushed_at || 0).getTime()) / 86400000;
      if (days > f.freshDays) return false;
    }
    if (f.staleDays !== undefined) {
      const days = (Date.now() - new Date(g.pushed_at || 0).getTime()) / 86400000;
      if (days < f.staleDays) return false;
    }
    if (f.hasMcp && !(g.has_mcp_sdk || g.topics.includes("mcp-server"))) return false;
    if (f.hasSkillMd && !g.has_skill_md) return false;
    if (f.hasClaudeDir && !g.has_claude_dir) return false;
    if (f.language && (g.language || "").toLowerCase() !== f.language.toLowerCase()) return false;
    if (f.topic && !g.topics.some(t => t.toLowerCase().includes(f.topic!.toLowerCase()))) return false;
    if (f.owner && g.owner.toLowerCase() !== f.owner.toLowerCase()) return false;
    if (f.excludeOwner && g.owner.toLowerCase() === f.excludeOwner.toLowerCase()) return false;
    if (f.tier && !f.tier.has(tierName(g.gem_score) as any)) return false;
    if (f.profile && !g.suggested_profiles.includes(f.profile)) return false;
    if (f.installed || f.notInstalled) {
      const isIn = getInstalledIn(g).length > 0;
      if (f.installed && !isIn) return false;
      if (f.notInstalled && isIn) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Profile suggestion (keyword matching)
// ---------------------------------------------------------------------------

const PROFILE_KEYWORDS: Record<string, string[]> = {
  backend: ["api", "server", "express", "fastapi", "django", "flask", "webhook", "database", "sql", "graphql", "deploy", "docker", "kubernetes", "microservice", "redis", "postgres", "mongo", "supabase", "prisma"],
  frontend: ["react", "vue", "svelte", "nextjs", "css", "tailwind", "component", "browser", "dom", "ui", "ux", "responsive", "animation", "spa"],
  nextjs: ["nextjs", "next.js", "vercel", "app-router", "server-component", "next-auth"],
  "python-api": ["python", "fastapi", "django", "flask", "sqlalchemy", "pytest", "pip", "uvicorn", "pydantic", "celery"],
  rust: ["rust", "cargo", "tokio", "crate", "wasm", "async-std"],
  "go-api": ["golang", "gin", "echo", "chi", "gorm", "goroutine"],
  cybersecurity: ["security", "pentest", "vulnerability", "exploit", "forensic", "dfir", "red-team", "blue-team", "malware", "audit", "cve", "owasp", "threat", "osint", "recon", "dork", "credential", "phishing"],
  "creative-media": ["image", "video", "media", "design", "brand", "visual", "photo", "illustration", "figma", "canvas"],
  "docs-writer": ["documentation", "markdown", "docs", "writing", "obsidian", "knowledge-base", "wiki", "readme", "technical-writing", "docusaurus"],
  research: ["research", "paper", "literature", "citation", "academic", "notebook", "arxiv", "scholar", "study", "analysis"],
  threejs: ["three.js", "threejs", "webgl", "shader", "3d", "scene", "geometry"],
  video: ["video", "ffmpeg", "transcription", "frame", "subtitle", "stream", "recording", "youtube"],
  marketing: ["seo", "marketing", "copywriting", "growth", "conversion", "analytics", "campaign", "funnel", "landing-page"],
  medusa: ["medusa", "ecommerce", "storefront", "shop", "cart", "checkout", "product-catalog", "amazon", "seller"],
  "fleet-control": ["multi-agent", "orchestrat", "coordinator", "dispatch", "parallel", "swarm", "colony"],
};

// `core` is the fallback — don't match it via keywords, only assign when nothing else matches.

/**
 * Subject hints for repos whose primary purpose is a named non-tech subject
 * (a human language, country, product, game, or app). Such repos commonly tag
 * themselves with the stack they happen to be built on (nextjs, vue, tailwind),
 * which historically mismapped them into generic stack profiles. When a subject
 * hint matches, stack profiles require a description-level keyword hit — not
 * just incidental stack tags — to remain assigned.
 */
const NICHE_SUBJECT_HINTS: RegExp[] = [
  /\b(korean|russian|chinese|japanese|spanish|french|german|italian|portuguese|arabic|hindi|thai|vietnamese)\b/i,
  /\b(bilibili|spotify|reddit|bbc|wechat|notion|jira|servicenow|obsidian|home\s?assistant|farming\s?simulator|gospel|grant)\b/i,
];

const STACK_PROFILES: ReadonlySet<string> = new Set([
  "frontend", "backend", "nextjs", "python-api", "rust", "go-api", "threejs",
]);

export function suggestProfiles(repo: GemRepo): string[] {
  const desc = (repo.description ?? "").toLowerCase();
  const topicStr = repo.topics.join(" ").toLowerCase();
  const name = repo.name.toLowerCase();
  const lang = repo.language.toLowerCase();

  const subjectLine = `${desc} ${name}`;
  const hasNicheSubject = NICHE_SUBJECT_HINTS.some(re => re.test(subjectLine));

  const scored: { profile: string; score: number }[] = [];

  for (const [profile, keywords] of Object.entries(PROFILE_KEYWORDS)) {
    let hits = 0;
    let distinctHits = 0;
    let descMatch = false;

    for (const kw of keywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${escaped}`, "i");
      let matched = false;
      // Topics get 3× weight
      if (re.test(topicStr)) { hits += 3; matched = true; }
      // Description gets 1× weight
      if (re.test(desc))     { hits += 1; matched = true; descMatch = true; }
      // Repo name gets 2× weight
      if (re.test(name))     { hits += 2; matched = true; }
      if (matched) distinctHits++;
    }

    // Language-based boost
    if (profile === "python-api" && lang === "python") hits += 2;
    if (profile === "rust" && lang === "rust") hits += 2;
    if (profile === "go-api" && lang === "go") hits += 2;
    if (profile === "frontend" && (lang === "typescript" || lang === "javascript")) hits += 1;

    // Need both enough total weight AND at least two distinct keyword hits.
    // The distinct check kills single-tag mismaps (one `nextjs` topic alone
    // used to drag a Korean-legal-tech repo into frontend).
    if (hits < 3 || distinctHits < 2) continue;

    // Niche-subject veto: if the repo describes a specific non-tech subject
    // (a named language, product, game), stack-profile membership requires
    // the description itself to mention that profile's keywords — not just
    // incidental stack tags like `tailwind` on a Bilibili scraper.
    if (hasNicheSubject && STACK_PROFILES.has(profile) && !descMatch) continue;

    scored.push({ profile, score: hits });
  }

  // Sort by score, take top 2
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 2).map(s => s.profile);

  // Niche/regional vertical: keep non-stack matches if any (e.g. a TCM-themed
  // pentest skill still belongs in cybersecurity); otherwise route to the
  // dedicated `niche` bucket instead of falling through to `core`. This is
  // the lever that stops 倪海厦中医 / 造价大师 / dating-coach / Bible-study
  // skills from crowding out fleet/MCP gems on the core profile page.
  if (hasNicheTopicSignal(repo)) {
    const nonStack = top.filter(p => !STACK_PROFILES.has(p));
    return nonStack.length ? nonStack : ["niche"];
  }

  return top.length ? top : ["core"];
}

// ---------------------------------------------------------------------------
// GitHub API search
// ---------------------------------------------------------------------------

function ghSearch(query: string, limit: number): any[] {
  const q = query.replace("{RECENT}", recentDate());
  const res = spawnSync("gh", [
    "api", "search/repositories",
    "--method", "GET",
    "-f", `q=${q}`,
    "-f", `per_page=${Math.min(limit, 30)}`,
    "-f", "sort=updated",
    "--jq", ".items",
  ], { encoding: "utf8", timeout: 30000 });

  if (res.status !== 0) return [];
  try { return JSON.parse(res.stdout); } catch { return []; }
}

function checkFileExists(fullName: string, path: string): boolean {
  const res = spawnSync("gh", ["api", `repos/${fullName}/contents/${path}`, "--jq", ".name"], {
    encoding: "utf8", timeout: 8000,
  });
  return res.status === 0 && !!res.stdout.trim();
}

/** Build profile-specific GitHub search queries */
export function buildProfileQueries(profile: string): { q: string; label: string }[] {
  const PROFILE_SEARCH_TERMS: Record<string, string[]> = {
    backend: ["api server deploy", "webhook microservice", "database migration", "docker kubernetes skill", "ci cd pipeline"],
    frontend: ["react component skill", "ui design system", "tailwind css", "browser testing", "responsive web"],
    nextjs: ["nextjs skill", "next.js vercel", "app router server component", "next-auth"],
    "python-api": ["python fastapi skill", "django api", "flask sqlalchemy", "pytest automation"],
    rust: ["rust cargo skill", "rust cli tool", "tokio async", "rust wasm"],
    "go-api": ["golang api skill", "go gin echo", "golang microservice"],
    cybersecurity: ["security audit skill", "pentest tool", "vulnerability scanner", "red team blue team", "threat detection"],
    "creative-media": ["image generation skill", "video editing ai", "design asset brand", "figma automation"],
    "docs-writer": ["documentation generator", "markdown writing skill", "knowledge base wiki", "technical writing"],
    research: ["research paper skill", "literature review", "citation manager", "academic notebook", "arxiv"],
    threejs: ["three.js skill", "webgl shader", "3d scene interactive"],
    video: ["video processing skill", "ffmpeg automation", "transcription subtitle", "youtube tool"],
    marketing: ["seo optimization skill", "marketing automation", "copywriting ai", "conversion funnel", "growth hacking"],
    medusa: ["medusa ecommerce", "storefront skill", "shopping cart", "product catalog", "amazon seller"],
    "fleet-control": ["multi-agent orchestration", "agent coordinator", "parallel agent", "task dispatch"],
    coolify: ["coolify deploy", "self-hosted paas", "server management"],
    hostinger: ["hosting dns", "vps management", "domain config"],
    nvidia: ["nvidia cuda", "gpu optimization", "cuopt routing"],
  };

  const terms = PROFILE_SEARCH_TERMS[profile] ?? [profile];
  const recent = recentDate();

  return [
    // Profile-specific skill searches
    ...terms.map(t => ({ q: `${t} pushed:>${recent}`, label: t })),
    // Also search for SKILL.md repos matching profile keywords
    { q: `path:SKILL.md ${terms[0]}`, label: `SKILL.md + ${terms[0]}` },
    // Topic-based for the profile
    { q: `topic:claude-skill ${terms[0]?.split(" ")[0]}`, label: `topic:claude-skill + ${profile}` },
  ];
}

// ---------------------------------------------------------------------------
// Rich gem rendering (rich card, badges, hanging-indent description, dup flag)
// ---------------------------------------------------------------------------

const TIER_ICON: Record<string, string> = { premium: "🏆", strong: "💎", worth: "✨", tail: "🔹" };

export interface RenderOpts {
  compact?: boolean;            // one line per gem
  verbose?: boolean;            // show score breakdown
  showMatchers?: boolean;       // show keyword matches under "Best for"
  termWidth?: number;           // assume 100 if undefined
  installedIn?: (gem: GemRepo) => string[];   // injection for tests
}

/**
 * Strip ANSI escape codes for true visual length measurement.
 * Used for padding/right-aligning when ANSI codes would inflate apparent width.
 */
function visualLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/** Pad a string to a visual width, accounting for ANSI codes. */
function padVisual(s: string, width: number): string {
  const len = visualLen(s);
  return len >= width ? s : s + " ".repeat(width - len);
}

/**
 * Format a gem as a tight, readable card. ~4 lines per gem:
 *   1. header   — icon · bold name · ✓installed-tag · right-aligned metrics
 *   2-3. desc   — word-wrapped, normal weight (this is what the eye reads)
 *   4. facts    — lang · freshness · badges · → profile · topics (dim)
 *   5. action   — $ cue discover install <name>   (the takeaway)
 * Plus a blank line after for breathing room.
 */
export function renderGemRich(gem: GemRepo, opts: RenderOpts = {}): string {
  const term = opts.termWidth ?? process.stdout.columns ?? 100;
  const width = Math.max(80, Math.min(term, 120));   // sane bounds
  const tn = tierName(gem.gem_score);
  const icon = TIER_ICON[tn] ?? "🔹";
  const tcolor = tierColorFor(gem.gem_score);
  const installedIn = (opts.installedIn ?? getInstalledIn)(gem);

  const lines: string[] = [];
  const prefix = "     ";   // 5-space inner indent for all rows below the header

  // -- Line 1: header --------------------------------------------------------
  // Left chunk: icon + bold repo name + optional installed badge
  const installedBadge = installedIn.length
    ? "  " + wrap(ANSI.green, `✓ in ${installedIn.join(",")}`)
    : "";
  const leftHeader = `  ${icon}  ${wrap(ANSI.bold, gem.full_name)}${installedBadge}`;
  // Right chunk: stars · forks · score (right-aligned with dim dots between)
  const rightParts: string[] = [colorStars(gem.stars)];
  if (gem.forks > 0) rightParts.push(wrap(ANSI.gray, `⑂${gem.forks}`));
  rightParts.push(wrap(tcolor, `s:${gem.gem_score}`));
  const rightHeader = rightParts.join(wrap(ANSI.gray, "  ·  "));
  const gap = Math.max(2, width - visualLen(leftHeader) - visualLen(rightHeader));
  lines.push(leftHeader + " ".repeat(gap) + rightHeader);

  // -- Lines 2-3: description ------------------------------------------------
  const cleanDesc = stripSlopOpener(gem.description);
  if (cleanDesc) {
    for (const ln of wrapText(cleanDesc, width - prefix.length, "")) {
      lines.push(prefix + ln);
    }
  }

  // -- Line 4: facts row -----------------------------------------------------
  // Each fact keeps its own color (e.g. green = fresh) so signals survive the
  // dim-dot separators between them.
  const facts: string[] = [];
  if (gem.language) facts.push(wrap(ANSI.dim, gem.language));
  facts.push(wrap(freshnessColor(gem.pushed_at), freshnessLabel(gem.pushed_at)));
  if (gem.quality > 0) {
    const qColor = gem.quality >= 7 ? ANSI.green : gem.quality >= 4 ? ANSI.yellow : ANSI.red;
    facts.push(wrap(qColor, `q:${gem.quality}/10`));
  }
  const badges: string[] = [];
  if (gem.has_skill_md) badges.push(wrap(ANSI.green, "[SKILL]"));
  if (gem.has_claude_dir) badges.push(wrap(ANSI.cyan, "[.claude]"));
  if (gem.has_mcp_sdk) badges.push(wrap(ANSI.magenta, "[MCP]"));
  if (badges.length) facts.push(badges.join(""));
  if (gem.suggested_profiles.length) {
    facts.push(wrap(ANSI.cyan, `→ ${gem.suggested_profiles.join(", ")}`));
  }
  if (gem.topics.length) {
    facts.push(wrap(ANSI.gray, `#${gem.topics.slice(0, 3).join(" #")}`));
  }
  lines.push(prefix + facts.join(wrap(ANSI.dim, "  ·  ")));

  // -- Line 5: action --------------------------------------------------------
  lines.push(prefix + wrap(ANSI.dim, "$ ") + wrap(ANSI.bold, `cue discover install ${gem.full_name}`));

  // Score breakdown (verbose / --explain-score) — extra row below the action
  if (opts.verbose) {
    const { components } = scoreGemBreakdown(gem);
    const parts = components.map(c => `${c.delta > 0 ? "+" : ""}${c.delta.toFixed(1)} ${c.label}`).join(", ");
    if (parts) {
      // Wrap so the breakdown doesn't blow out the line width.
      const breakdownPrefix = prefix + wrap(ANSI.dim, "└ ");
      const continuationPrefix = prefix + "  ";
      const wrapped = wrapText(parts, width - prefix.length - 2, "");
      wrapped.forEach((ln, i) => {
        lines.push((i === 0 ? breakdownPrefix : continuationPrefix) + wrap(ANSI.dim, ln));
      });
    }
  }

  return lines.join("\n");
}

/** One-line compact mode. */
export function renderGemCompact(gem: GemRepo): string {
  const tn = tierName(gem.gem_score);
  const icon = TIER_ICON[tn] ?? "🔹";
  const installedMark = getInstalledIn(gem).length ? wrap(ANSI.green, "✓ ") : "";
  const desc = stripSlopOpener(gem.description).slice(0, 60);
  return `  ${icon} ${installedMark}${wrap(ANSI.bold, gem.full_name.padEnd(40))}  ${colorStars(gem.stars).padEnd(20)}  ${wrap(tierColorFor(gem.gem_score), `s:${gem.gem_score}`).padEnd(8)}  ${wrap(ANSI.dim, desc)}`;
}

/** Join rich-card renders with a blank line between for breathing room. */
function joinCards(gems: GemRepo[], opts: RenderOpts): string {
  if (opts.compact) return gems.map(g => renderGemCompact(g)).join("\n");
  return gems.map(g => renderGemRich(g, opts)).join("\n\n");
}

/** Group gems by suggested profile and render with section headers. */
export function renderGroupedByProfile(gems: GemRepo[], opts: RenderOpts = {}): string {
  const byProfile = new Map<string, GemRepo[]>();
  for (const g of gems) {
    const profiles = g.suggested_profiles.length ? g.suggested_profiles : ["core"];
    for (const p of profiles) {
      const list = byProfile.get(p) ?? [];
      list.push(g);
      byProfile.set(p, list);
    }
  }
  const sorted = [...byProfile.entries()].sort((a, b) => b[1].length - a[1].length);
  const active = getActiveProfile();
  const out: string[] = [];
  for (const [profile, list] of sorted) {
    const isActive = profile === active;
    const header = isActive
      ? `${wrap(ANSI.bold + ANSI.cyan, `▶ ${profile}`)} ${wrap(ANSI.gray, `· ${list.length} gem${list.length === 1 ? "" : "s"} · your active profile`)}`
      : `${wrap(ANSI.bold, profile)} ${wrap(ANSI.gray, `· ${list.length} gem${list.length === 1 ? "" : "s"}`)}`;
    out.push("\n  " + header + "\n");
    out.push(joinCards(list, opts));
  }
  return out.join("\n");
}

/** Render gems split into tier buckets with collapsed long-tail summary. */
export function renderTiered(gems: GemRepo[], opts: RenderOpts & { showTail?: boolean } = {}): string {
  const buckets: Record<string, GemRepo[]> = { premium: [], strong: [], worth: [], tail: [] };
  for (const g of gems) buckets[tierName(g.gem_score)]!.push(g);
  const out: string[] = [];
  for (const [tier, list] of Object.entries(buckets)) {
    if (list.length === 0) continue;
    if (tier === "tail" && !opts.showTail) {
      out.push(`\n  ${TIER_ICON[tier]}  ${wrap(ANSI.gray, `${list.length} more long-tail gem${list.length === 1 ? "" : "s"} hidden`)} ${wrap(ANSI.dim, "(pass --all to expand)")}\n`);
      continue;
    }
    const tcolor = tierColorFor(tier === "premium" ? 12 : tier === "strong" ? 8 : tier === "worth" ? 5 : 0);
    out.push(`\n  ${TIER_ICON[tier]}  ${wrap(tcolor + ANSI.bold, tier.toUpperCase())} ${wrap(ANSI.gray, `· ${list.length} gem${list.length === 1 ? "" : "s"}`)}\n`);
    out.push(joinCards(list, opts));
  }
  return out.join("\n");
}

async function cmdSearch(query: string | undefined, opts: { limit: number; minScore: number; json: boolean; profile?: string; filter?: GemFilter; render?: "rich" | "compact" | "grouped" | "tiered"; verbose?: boolean; showTail?: boolean }): Promise<number> {
  const profileLabel = opts.profile ? ` for "${opts.profile}" profile` : "";
  process.stderr.write(`🔍 Searching GitHub for hidden gem skill repos${profileLabel}...\n\n`);

  const seen = new Set<string>();
  const gems: GemRepo[] = [];

  let queries: { q: string; label: string }[];

  if (query) {
    queries = [{ q: `${query} pushed:>${recentDate()}`, label: `"${query}"` }];
  } else if (opts.profile) {
    queries = buildProfileQueries(opts.profile);
  } else {
    queries = SEARCH_QUERIES;
  }

  for (const { q, label } of queries) {
    if (gems.length >= opts.limit) break;
    process.stderr.write(`  ⏳ ${label}...\n`);

    const items = ghSearch(q, opts.limit - gems.length);
    for (const item of items) {
      if (seen.has(item.full_name)) continue;
      seen.add(item.full_name);

      const gem: GemRepo = {
        full_name: item.full_name,
        owner: item.owner?.login ?? "",
        name: item.name,
        description: item.description ?? "",
        stars: item.stargazers_count ?? 0,
        forks: item.forks_count ?? 0,
        created_at: item.created_at ?? "",
        pushed_at: item.pushed_at ?? "",
        topics: item.topics ?? [],
        language: item.language ?? "",
        has_skill_md: false,
        has_claude_dir: false,
        has_mcp_sdk: false,
        gem_score: 0,
        suggested_profiles: [],
        suggested_mcps: [],
        suggested_clis: [],
        quality: 0,
        url: item.html_url ?? `https://github.com/${item.full_name}`,
      };

      // SKILL.md / .claude detection is load-bearing for scoring, so always check.
      // Authenticated `gh api` raises the rate ceiling enough to absorb 2 calls per repo.
      gem.has_skill_md = checkFileExists(gem.full_name, "SKILL.md");
      gem.has_claude_dir = checkFileExists(gem.full_name, ".claude");

      gem.gem_score = scoreGem(gem);
      gem.suggested_profiles = suggestProfiles(gem);

      if (gem.gem_score >= opts.minScore) gems.push(gem);
    }
  }

  // Sort by score descending
  gems.sort((a, b) => b.gem_score - a.gem_score);

  // Cache results (BEFORE filtering — cache is the raw scan, filters are display-time)
  mkdirSync(cacheDir(), { recursive: true });
  const cache: GemCache = { updated: new Date().toISOString(), gems };
  writeFileSync(cacheFile(), JSON.stringify(cache, null, 2));

  // Apply filters for display only
  const filtered = opts.filter ? applyFilters(gems, opts.filter) : gems;
  const display = filtered.slice(0, opts.limit);

  if (opts.json) {
    process.stdout.write(JSON.stringify(display, null, 2) + "\n");
    return 0;
  }

  const headerCount = filtered.length === gems.length
    ? `${gems.length}`
    : `${filtered.length}${wrap(ANSI.dim, `/${gems.length}`)}`;
  process.stdout.write(`\n  🎯 ${wrap(ANSI.bold, `Hidden Gems: ${headerCount}`)}${opts.filter && Object.keys(opts.filter).length ? wrap(ANSI.dim, "  (filtered)") : ""}\n`);

  const renderOpts: RenderOpts = { verbose: opts.verbose };
  const mode = opts.render ?? "tiered";

  if (display.length === 0) {
    process.stdout.write(`\n  ${wrap(ANSI.yellow, "No gems match those filters.")} Try loosening with --min-stars 0 --fresh 365 --all\n`);
    return 0;
  }

  if (mode === "compact") {
    process.stdout.write("\n");
    for (const g of display) process.stdout.write(renderGemCompact(g) + "\n");
  } else if (mode === "grouped") {
    process.stdout.write(renderGroupedByProfile(display, renderOpts) + "\n");
  } else if (mode === "tiered") {
    process.stdout.write(renderTiered(display, { ...renderOpts, showTail: opts.showTail }) + "\n");
  } else {
    process.stdout.write("\n");
    for (const g of display) process.stdout.write(renderGemRich(g, renderOpts) + "\n\n");
  }

  process.stdout.write(`\n  ${wrap(ANSI.dim, "Tip:")} ${wrap(ANSI.bold, "cue discover --export")} · filters: --min-stars N · --fresh N · --has-mcp · --tier premium,strong · --not-installed · --compact · --verbose\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// Export to docs/discovered.md
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Export — SEO/GEO-friendly artifacts.
//
//   --export <path.md>           single markdown file (legacy)
//   --export <dir> --site        per-profile pages + index (SEO targets long-tail
//                                 queries: "Claude Code skills for cybersecurity")
//   --export <dir> --site --html same, with HTML + JSON-LD schema for LLM citation
// ---------------------------------------------------------------------------

function tierIcon(score: number): string {
  return score >= 8 ? "💎" : score >= 5 ? "✨" : "🔹";
}
function tierLabel(score: number): string {
  return score >= 8 ? "exceptional" : score >= 5 ? "strong" : "potential";
}
function repoAnchor(repo: string): string {
  return repo.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

// Neutralize Liquid delimiters in scraped text so Jekyll (GitHub Pages runs
// v3 — no per-file render_with_liquid) doesn't choke on `{{ }}` / `{% %}` /
// stray `{% endraw %}` embedded in third-party README content. A space inside
// the delimiter stops Liquid recognizing a tag and renders near-identically.
function escapeLiquid(s: string): string {
  return s
    .replace(/\{\{/g, "{ {")
    .replace(/\}\}/g, "} }")
    .replace(/\{%/g, "{ %")
    .replace(/%\}/g, "% }");
}

function buildProfilePage(profile: string, gems: GemRepo[], updated: string): string {
  const sorted = [...gems].sort((a, b) => b.gem_score - a.gem_score);
  let md = `---
title: "Claude Code Skills for ${profile}"
description: "${gems.length} community Claude Code skills curated by cue for the ${profile} profile. Hidden-gem repos with SKILL.md, MCP servers, and CLI integrations."
layout: page
updated: ${updated.split("T")[0]}
tags: [claude-code, ${profile}, skills, mcp, ai-agents]
---

`;
  md += `# Claude Code Skills for \`${profile}\`\n\n`;
  md += `> ${gems.length} community-built skills curated by [cue](https://github.com/opencue/claude-code-skills) for the **${profile}** profile.\n`;
  md += `> Each one was discovered via GitHub Code Search, scored on signal quality, and mapped to this profile by keyword overlap.\n\n`;
  md += `**[← back to all discovered skills](./index.md)**\n\n---\n\n`;

  for (const gem of sorted) {
    const icon = tierIcon(gem.gem_score);
    md += `<a id="${repoAnchor(gem.full_name)}"></a>\n`;
    md += `## ${icon} [${gem.full_name}](${gem.url})\n\n`;
    md += `**★ ${gem.stars}** · ${tierLabel(gem.gem_score)} (score ${gem.gem_score})`;
    if (gem.language) md += ` · ${gem.language}`;
    if (gem.topics.length > 0) md += ` · tags: ${gem.topics.slice(0, 5).join(", ")}`;
    md += `\n\n${escapeLiquid(gem.description)}\n\n`;
    const evidence: string[] = [];
    if (gem.has_skill_md) evidence.push("✅ SKILL.md");
    if (gem.has_claude_dir) evidence.push("✅ `.claude/` directory");
    if (gem.has_mcp_sdk) evidence.push("✅ MCP SDK");
    if (evidence.length > 0) md += `${evidence.join(" · ")}\n\n`;
    if (gem.suggested_clis.length > 0) {
      md += `**CLIs needed:** ${gem.suggested_clis.map((c) => `\`${c}\``).join(", ")}\n\n`;
    }
    md += `\`\`\`bash\ncue skills add ${gem.full_name} --profile ${profile}\n\`\`\`\n\n---\n\n`;
  }
  md += `## About this list\n\nGenerated by [cue](https://github.com/opencue/claude-code-skills) — an open-source agent profile manager. cue runs nightly GitHub Code Search for \`filename:SKILL.md\` and scores each repo by recency, skill format, MCP integration, and engagement signals.\n\n**Authors:** if you'd rather not be listed, add \`<!-- cue: ignore -->\` to your README — we respect it permanently. Want to opt in explicitly? Add \`<!-- cue: ok -->\`.\n\n`;
  return md;
}

function buildIndexPage(byProfile: Map<string, GemRepo[]>, totalGems: number, updated: string): string {
  const sorted = [...byProfile.entries()].sort((a, b) => b[1].length - a[1].length);
  let md = `---
title: "Discovered Claude Code Skills"
description: "${totalGems} community Claude Code skills curated by cue across ${byProfile.size} profiles. Find skills for backend, frontend, marketing, cybersecurity, and more."
layout: page
updated: ${updated.split("T")[0]}
tags: [claude-code, skills, mcp, ai-agents, marketplace]
---

# 🎯 Discovered Claude Code Skills

> **${totalGems} hidden-gem skills** discovered by [cue](https://github.com/opencue/claude-code-skills) across **${byProfile.size} profiles**.
> Last updated: ${updated.split("T")[0]} · refreshed nightly via GitHub Code Search.

## Browse by profile

| Profile | Skills | Sample |
|---|---|---|
`;
  for (const [profile, gems] of sorted) {
    const top = [...gems].sort((a, b) => b.gem_score - a.gem_score).slice(0, 3);
    const samples = top.map((g) => `\`${g.full_name.split("/")[1]}\``).join(", ");
    md += `| [**${profile}**](./${profile}.md) | ${gems.length} | ${samples} |\n`;
  }
  md += `\n## How scoring works\n\n| Tier | Score | Meaning |\n|---|---|---|\n| 💎 exceptional | 8+ | Active repo, proper skill format, low star count (true hidden gem) |\n| ✨ strong | 5–7 | Good signal mix — proven format or active maintainer |\n| 🔹 potential | 3–4 | Some signal — worth a look |\n\n`;
  md += `## Use cue to install any of these\n\n\`\`\`bash\nnpx cue@latest\ncue skills add owner/repo --profile <profile>\n\`\`\`\n\n## About cue\n\ncue is an agent profile manager for Claude Code and Codex CLI. [github.com/opencue/claude-code-skills](https://github.com/opencue/claude-code-skills)\n`;
  return md;
}

function buildJsonLdItemList(name: string, description: string, gems: GemRepo[]): string {
  const list = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    description,
    numberOfItems: gems.length,
    itemListElement: gems.slice(0, 100).map((g, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "SoftwareApplication",
        name: g.full_name,
        description: g.description,
        url: g.url,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Cross-platform",
        codeRepository: g.url,
        ...(g.language ? { programmingLanguage: g.language } : {}),
      },
    })),
  };
  return JSON.stringify(list, null, 2);
}

function buildIndexHtml(byProfile: Map<string, GemRepo[]>, totalGems: number, updated: string): string {
  const sorted = [...byProfile.entries()].sort((a, b) => b[1].length - a[1].length);
  const allGems: GemRepo[] = [];
  for (const [, gems] of sorted) for (const g of gems) if (!allGems.some((x) => x.full_name === g.full_name)) allGems.push(g);
  const jsonLd = buildJsonLdItemList(
    "Discovered Claude Code Skills",
    `${totalGems} community-built skills for Claude Code, curated by cue.`,
    allGems,
  );
  const rows = sorted.map(([profile, gems]) => {
    const top = [...gems].sort((a, b) => b.gem_score - a.gem_score).slice(0, 3);
    const samples = top.map((g) => `<code>${g.full_name.split("/")[1]}</code>`).join(", ");
    return `    <tr><td><a href="./${profile}.html">${profile}</a></td><td>${gems.length}</td><td>${samples}</td></tr>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Discovered Claude Code Skills · cue</title>
<meta name="description" content="${totalGems} community Claude Code skills curated by cue across ${byProfile.size} profiles. Find skills for backend, frontend, marketing, cybersecurity, and more.">
<meta property="og:title" content="Discovered Claude Code Skills · cue">
<meta property="og:description" content="${totalGems} community Claude Code skills curated by cue.">
<meta property="og:type" content="website">
<link rel="canonical" href="https://opencue.github.io/cue/discovered/">
<style>body{font:16px/1.6 -apple-system,sans-serif;max-width:760px;margin:2em auto;padding:0 1em;color:#222}table{border-collapse:collapse;width:100%}th,td{padding:.5em .75em;border-bottom:1px solid #eee;text-align:left}code{background:#f4f4f4;padding:1px 5px;border-radius:3px;font-size:.9em}a{color:#0a58ca;text-decoration:none}a:hover{text-decoration:underline}</style>
<script type="application/ld+json">
${jsonLd}
</script>
</head><body>
<h1>🎯 Discovered Claude Code Skills</h1>
<p><strong>${totalGems} hidden-gem skills</strong> discovered by <a href="https://github.com/opencue/claude-code-skills">cue</a> across <strong>${byProfile.size} profiles</strong>.</p>
<p><small>Last updated: ${updated.split("T")[0]} · refreshed nightly via GitHub Code Search.</small></p>
<h2>Browse by profile</h2>
<table><thead><tr><th>Profile</th><th>Skills</th><th>Sample</th></tr></thead>
<tbody>
${rows}
</tbody></table>
<p><a href="https://github.com/opencue/claude-code-skills">github.com/opencue/claude-code-skills</a></p>
</body></html>
`;
}

function buildProfileHtml(profile: string, gems: GemRepo[], updated: string): string {
  const sorted = [...gems].sort((a, b) => b.gem_score - a.gem_score);
  const jsonLd = buildJsonLdItemList(
    `Claude Code Skills for ${profile}`,
    `${gems.length} community Claude Code skills for ${profile}, curated by cue.`,
    sorted,
  );
  const cards = sorted.map((g) => {
    const icon = tierIcon(g.gem_score);
    const escDesc = g.description.replace(/[<>]/g, (c) => c === "<" ? "&lt;" : "&gt;");
    return `<article id="${repoAnchor(g.full_name)}">
<h2>${icon} <a href="${g.url}">${g.full_name}</a></h2>
<p><small>★ ${g.stars} · ${tierLabel(g.gem_score)} (score ${g.gem_score})${g.language ? " · " + g.language : ""}</small></p>
<p>${escDesc}</p>
<pre><code>cue skills add ${g.full_name} --profile ${profile}</code></pre>
</article>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Claude Code Skills for ${profile} · cue</title>
<meta name="description" content="${gems.length} community Claude Code skills for ${profile}, curated by cue. Discovered via GitHub Code Search, scored on signal quality.">
<meta property="og:title" content="Claude Code Skills for ${profile} · cue">
<meta property="og:description" content="${gems.length} skills for ${profile}, curated by cue.">
<link rel="canonical" href="https://opencue.github.io/cue/discovered/${profile}.html">
<style>body{font:16px/1.6 -apple-system,sans-serif;max-width:760px;margin:2em auto;padding:0 1em;color:#222}article{border-bottom:1px solid #eee;padding:1em 0}pre{background:#f4f4f4;padding:.6em;border-radius:4px;overflow-x:auto}a{color:#0a58ca;text-decoration:none}a:hover{text-decoration:underline}</style>
<script type="application/ld+json">
${jsonLd}
</script>
</head><body>
<p><a href="./index.html">← back to all profiles</a></p>
<h1>Claude Code Skills for <code>${profile}</code></h1>
<p>${gems.length} skills discovered by <a href="https://github.com/opencue/claude-code-skills">cue</a>. Last updated ${updated.split("T")[0]}.</p>
${cards}
</body></html>
`;
}

// ---------------------------------------------------------------------------
// Per-repo inbound pages — reverse-direction backlinks. Every discovered repo
// gets its own indexable surface so cue's SEO covers the long tail (repo
// names), and so the repo's authors get a backlink from cue.dev.
// ---------------------------------------------------------------------------

function buildRepoPage(gem: GemRepo, updated: string): string {
  const icon = tierIcon(gem.gem_score);
  const profileLinks = gem.suggested_profiles.map((p) => `[${p}](../${p}.md)`).join(", ") || "_(no profile match)_";
  return `---
title: "${gem.full_name} — Claude Code skill discovered by cue"
description: "${(gem.description || `Claude Code skill from ${gem.full_name}`).slice(0, 160)}"
layout: page
updated: ${updated.split("T")[0]}
tags: [claude-code, skill, ${gem.suggested_profiles.join(", ")}]
---

# ${icon} [${gem.full_name}](${gem.url})

**★ ${gem.stars}** · ${tierLabel(gem.gem_score)} (score ${gem.gem_score})${gem.language ? ` · ${gem.language}` : ""}${gem.topics.length > 0 ? ` · ${gem.topics.slice(0, 5).join(", ")}` : ""}

> ${escapeLiquid(gem.description || `A Claude Code skill repository discovered by cue.`)}

## Why cue indexed it

cue ran [GitHub Code Search](https://docs.github.com/en/search-github/searching-on-github/searching-code) for \`filename:SKILL.md\` and found this repo. It scored ${gem.gem_score} based on:
${gem.has_skill_md ? "- ✅ Contains SKILL.md\n" : ""}${gem.has_claude_dir ? "- ✅ Has \`.claude/\` directory\n" : ""}${gem.has_mcp_sdk ? "- ✅ Uses Model Context Protocol SDK\n" : ""}- ⭐ ${gem.stars} stars
- 🗓️ Last pushed: ${gem.pushed_at?.split("T")[0] ?? "unknown"}
- 🏷️ Tags: ${gem.topics.join(", ") || "(none)"}

## Best fit cue profiles

${profileLinks}

${gem.suggested_clis.length > 0 ? `## CLIs needed

${gem.suggested_clis.map((c) => `- \`${c}\``).join("\n")}

Run \`cue cli install ${gem.suggested_clis.join(" ")} --yes\` to install them.
` : ""}

## Install via cue

\`\`\`bash
npm install -g cue-ai
cue skills add ${gem.full_name}${gem.suggested_profiles[0] ? ` --profile ${gem.suggested_profiles[0]}` : ""}
\`\`\`

## About

This page was auto-generated by [cue](https://github.com/opencue/claude-code-skills) — an open-source agent profile manager for Claude Code, Codex, Cursor, Cline, Gemini, Copilot, and 4 other AI coding agents. cue scopes skills + MCPs + plugins per-directory so each project only loads what it needs.

**Repo author:** if you'd rather we don't list this skill, add \`<!-- cue: ignore -->\` to your README and we'll skip it permanently.

---

[← back to all profiles](../index.md) · [view repo on GitHub →](${gem.url})
`;
}

function buildRepoHtml(gem: GemRepo, updated: string): string {
  const icon = tierIcon(gem.gem_score);
  const desc = (gem.description || `Claude Code skill from ${gem.full_name}`).slice(0, 160);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: gem.full_name,
    description: gem.description || desc,
    url: gem.url,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Cross-platform",
    codeRepository: gem.url,
    ...(gem.language ? { programmingLanguage: gem.language } : {}),
    ...(gem.stars > 0 ? {
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: Math.min(5, 1 + Math.log10(gem.stars + 1)).toFixed(2),
        reviewCount: gem.stars,
      },
    } : {}),
  };
  const profileLinks = gem.suggested_profiles.map((p) => `<a href="../${p}.html">${p}</a>`).join(", ") || "<em>(no profile match)</em>";
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${gem.full_name} — Claude Code skill discovered by cue</title>
<meta name="description" content="${desc.replace(/"/g, "&quot;")}">
<meta property="og:title" content="${gem.full_name} — Claude Code skill">
<meta property="og:description" content="${desc.replace(/"/g, "&quot;")}">
<link rel="canonical" href="https://opencue.github.io/cue/discovered/skills/${gem.full_name.replace("/", "-").toLowerCase()}.html">
<style>body{font:16px/1.6 -apple-system,sans-serif;max-width:760px;margin:2em auto;padding:0 1em;color:#222}code{background:#f4f4f4;padding:1px 5px;border-radius:3px;font-size:.9em}pre{background:#f4f4f4;padding:.6em;border-radius:4px;overflow-x:auto}a{color:#0a58ca;text-decoration:none}a:hover{text-decoration:underline}</style>
<script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
</script>
</head><body>
<p><a href="../index.html">← back to all profiles</a></p>
<h1>${icon} <a href="${gem.url}">${gem.full_name}</a></h1>
<p><small>★ ${gem.stars} · ${tierLabel(gem.gem_score)} (score ${gem.gem_score})${gem.language ? " · " + gem.language : ""}</small></p>
<p>${(gem.description || `A Claude Code skill repository discovered by cue.`).replace(/[<>]/g, (c) => c === "<" ? "&lt;" : "&gt;")}</p>
<h2>Best fit cue profiles</h2>
<p>${profileLinks}</p>
<h2>Install via cue</h2>
<pre><code>npm install -g cue-ai
cue skills add ${gem.full_name}${gem.suggested_profiles[0] ? ` --profile ${gem.suggested_profiles[0]}` : ""}</code></pre>
<p><a href="${gem.url}">View repo on GitHub →</a></p>
<hr>
<p><small>This page was auto-generated by <a href="https://github.com/opencue/claude-code-skills">cue</a>. Repo authors can opt out by adding <code>&lt;!-- cue: ignore --&gt;</code> to their README.</small></p>
</body></html>
`;
}

// ---------------------------------------------------------------------------
// sitemap.xml — index every page for Search Console + Bing Webmaster.
// ---------------------------------------------------------------------------

function buildSitemap(byProfile: Map<string, GemRepo[]>, gems: GemRepo[], updated: string): string {
  const base = "https://opencue.github.io/cue/discovered";
  const date = updated.split("T")[0];
  const urls: string[] = [];
  urls.push(`<url><loc>${base}/index.html</loc><lastmod>${date}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`);
  for (const profile of byProfile.keys()) {
    urls.push(`<url><loc>${base}/${profile}.html</loc><lastmod>${date}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`);
  }
  for (const gem of gems) {
    const slug = gem.full_name.replace("/", "-").toLowerCase();
    urls.push(`<url><loc>${base}/skills/${slug}.html</loc><lastmod>${date}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls.join("\n  ")}
</urlset>
`;
}

interface ExportOpts { site: boolean; html: boolean; }

function cmdExport(exportPath: string, opts: ExportOpts = { site: false, html: false }): number {
  if (!existsSync(cacheFile())) {
    process.stderr.write("No cached gems. Run `cue discover search` first.\n");
    return 1;
  }
  const cache: GemCache = JSON.parse(readFileSync(cacheFile(), "utf8"));
  // Re-apply the current spam filter at export time so tightened rules can
  // purge entries from a stale cache without requiring a full re-search.
  const gems = cache.gems.filter(g => !isLikelySpam(g));

  const byProfile = new Map<string, GemRepo[]>();
  for (const gem of gems) {
    for (const p of gem.suggested_profiles) {
      const list = byProfile.get(p) ?? [];
      list.push(gem);
      byProfile.set(p, list);
    }
  }

  // --- Site mode: per-profile pages + index + per-repo pages + sitemap.xml ---
  if (opts.site) {
    const dir = exportPath.endsWith(".md") ? dirname(exportPath) : exportPath;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.md"), buildIndexPage(byProfile, gems.length, cache.updated));
    if (opts.html) writeFileSync(join(dir, "index.html"), buildIndexHtml(byProfile, gems.length, cache.updated));
    for (const [profile, profGems] of byProfile) {
      writeFileSync(join(dir, `${profile}.md`), buildProfilePage(profile, profGems, cache.updated));
      if (opts.html) writeFileSync(join(dir, `${profile}.html`), buildProfileHtml(profile, profGems, cache.updated));
    }

    // Per-repo inbound pages — reverse-direction backlinks. Every discovered
    // repo gets its own indexable surface, helping the repo's SEO + giving cue
    // long-tail keyword reach per repo.
    const repoPagesDir = join(dir, "skills");
    mkdirSync(repoPagesDir, { recursive: true });
    for (const gem of gems) {
      const slug = gem.full_name.replace("/", "-").toLowerCase();
      writeFileSync(join(repoPagesDir, `${slug}.md`), buildRepoPage(gem, cache.updated));
      if (opts.html) writeFileSync(join(repoPagesDir, `${slug}.html`), buildRepoHtml(gem, cache.updated));
    }

    // sitemap.xml — every per-profile and per-repo page enumerated for Search
    // Console / Bing Webmaster submission.
    if (opts.html) writeFileSync(join(dir, "sitemap.xml"), buildSitemap(byProfile, gems, cache.updated));

    const pageCount = (byProfile.size + 1 + gems.length) * (opts.html ? 2 : 1);
    process.stdout.write(`✅ Exported ${gems.length} gems → ${pageCount} files under ${dir}/\n`);
    process.stdout.write(`   index: ${join(dir, "index.md")}${opts.html ? " (+ .html with JSON-LD)" : ""}\n`);
    process.stdout.write(`   per-profile pages: ${byProfile.size}${opts.html ? " (+ HTML)" : ""}\n`);
    process.stdout.write(`   per-repo pages: ${gems.length} (under skills/)${opts.html ? " (+ HTML)" : ""}\n`);
    if (opts.html) process.stdout.write(`   sitemap.xml: ${join(dir, "sitemap.xml")} — submit to Google Search Console + Bing Webmaster\n`);
    return 0;
  }

  // --- Legacy single-file mode ---
  let md = `<p align="center">
  <img src="https://img.shields.io/badge/cue-💎_Discovered_Skills-6366f1?style=for-the-badge&labelColor=1e1b4b" alt="cue discovered skills">
</p>

# 🎯 Discovered Skills & Hidden Gems

> **${gems.length} repos** discovered across **${byProfile.size} profiles** · Last scan: ${cache.updated.split("T")[0]}
>
> Found by scanning GitHub for skill-compatible projects that most developers haven't discovered yet.

<table>
<tr><td>💎 <b>8+</b></td><td>Exceptional — active, proper skill format, community-validated</td></tr>
<tr><td>✨ <b>5–7</b></td><td>Strong — good signals, worth checking out</td></tr>
<tr><td>🔹 <b>3–4</b></td><td>Potential — some signals present</td></tr>
</table>

## Quick install

\`\`\`bash
npm install -g cue-ai
cue discover search                    # find gems
cue discover install --min-score 8     # install top gems into profiles
\`\`\`

---

`;
  const sortedProfiles = [...byProfile.keys()].sort();
  for (const profile of sortedProfiles) {
    const profileGems = byProfile.get(profile)!.sort((a, b) => b.gem_score - a.gem_score);
    const topScore = profileGems[0]?.gem_score ?? 0;
    const profileIcon = topScore >= 10 ? "🏆" : topScore >= 8 ? "💎" : "✨";
    md += `## ${profileIcon} ${profile} <sub>(${profileGems.length} gems)</sub>\n\n`;
    md += `| | Repo | ★ | Score | What it does |\n|---|------|---|-------|-------------|\n`;
    for (const gem of profileGems) {
      const icon = tierIcon(gem.gem_score);
      const desc = escapeLiquid(gem.description).slice(0, 70).replace(/\|/g, "\\|");
      const skillBadge = gem.has_skill_md ? " 📄" : "";
      md += `| ${icon} | [${gem.full_name}](${gem.url})${skillBadge} | ${gem.stars} | ${gem.gem_score} | ${desc} |\n`;
    }
    md += `\n<details><summary>Install all ${profile} gems</summary>\n\n\`\`\`bash\ncue discover install --profile ${profile} --min-score 5\n\`\`\`\n</details>\n\n---\n\n`;
  }
  md += `## Contributing

Want your repo listed? Either:
- Add \`topic:claude-skill\` to your GitHub repo
- Include a \`SKILL.md\` in your repo root
- Both get you discovered automatically on the next nightly scan

Want out? Add \`<!-- cue: ignore -->\` to your README.

---

<p align="center">
  <a href="https://github.com/opencue/claude-code-skills">
    <img src="https://img.shields.io/badge/powered_by-cue-6366f1?style=flat-square&labelColor=1e1b4b" alt="powered by cue">
  </a>
</p>
`;
  mkdirSync(dirname(exportPath), { recursive: true });
  writeFileSync(exportPath, md);
  process.stdout.write(`✅ Exported ${gems.length} gems to ${exportPath}\n`);
  process.stdout.write(`   💡 Add --site for per-profile SEO pages, --html for indexable HTML with JSON-LD.\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// Analyze gems with Claude Code (reads README/SKILL.md, determines profile)
// ---------------------------------------------------------------------------

async function cmdAnalyze(opts: { profile?: string; minScore: number; limit: number }): Promise<number> {
  if (!existsSync(cacheFile())) {
    process.stderr.write("No cached gems. Run `cue discover search` first.\n");
    return 1;
  }

  const cache: GemCache = JSON.parse(readFileSync(cacheFile(), "utf8"));
  let gems = cache.gems.filter(g => g.gem_score >= opts.minScore).slice(0, opts.limit);

  if (opts.profile) {
    gems = gems.filter(g => g.suggested_profiles.includes(opts.profile!));
  }

  if (gems.length === 0) {
    process.stdout.write("No gems to analyze. Try lowering --min-score.\n");
    return 0;
  }

  const profiles = await listProfiles();
  const profileList = profiles.join(", ");

  process.stdout.write(`\n  🧠 Analyzing ${gems.length} gem(s) with Claude Code...\n\n`);

  for (const gem of gems) {
    process.stdout.write(`  ⏳ ${gem.full_name} (★ ${gem.stars})...\n`);

    // Fetch README content
    const readmeRes = spawnSync("gh", [
      "api", `repos/${gem.full_name}/readme`, "--jq", ".content",
    ], { encoding: "utf8", timeout: 15000 });

    let readme = "";
    if (readmeRes.status === 0 && readmeRes.stdout.trim()) {
      readme = Buffer.from(readmeRes.stdout.trim(), "base64").toString("utf8").slice(0, 3000);
    }

    // Fetch SKILL.md if exists
    let skillMd = "";
    if (gem.has_skill_md) {
      const skillRes = spawnSync("gh", [
        "api", `repos/${gem.full_name}/contents/SKILL.md`, "--jq", ".content",
      ], { encoding: "utf8", timeout: 10000 });
      if (skillRes.status === 0 && skillRes.stdout.trim()) {
        skillMd = Buffer.from(skillRes.stdout.trim(), "base64").toString("utf8").slice(0, 2000);
      }
    }

    if (!readme && !skillMd) {
      process.stdout.write(`     ⚠️  No readable content, skipping\n`);
      continue;
    }

    // Use claude --print to analyze
    const prompt = `You are a profile classifier for "cue" (an agent profile manager). Given a GitHub repo's content, determine which cue profile(s) it best fits into.

Available profiles: ${profileList}

Repo: ${gem.full_name} (★ ${gem.stars})
Description: ${gem.description}
Language: ${gem.language}
Topics: ${gem.topics.join(", ")}

${skillMd ? `SKILL.md (first 2000 chars):\n${skillMd}\n` : ""}
${readme ? `README (first 3000 chars):\n${readme}\n` : ""}

Respond in EXACTLY this format (no other text):
PROFILES: <profile1>, <profile2>
MCPS: <mcp-server-names that this skill needs or provides, comma-separated, or "none">
CLIS: <cli tools required to run this skill, comma-separated, or "none">
REASON: <one sentence why>
QUALITY: <1-10 score of how useful this skill actually is>`;

    const claudeRes = spawnSync("claude", ["--print", "-p", prompt], {
      encoding: "utf8", timeout: 30000,
      env: { ...process.env, CUE_BYPASS: "1" },
    });

    if (claudeRes.status !== 0 || !claudeRes.stdout.trim()) {
      // Fallback: use the real claude binary directly (cue's PATH shim recurses)
      const realClaude = findRealClaudeBin();
      const fallbackRes = realClaude
        ? spawnSync(realClaude, ["--print", "-p", prompt], { encoding: "utf8", timeout: 30000 })
        : null;
      if (!fallbackRes || fallbackRes.status !== 0) {
        process.stdout.write(`     ⚠️  Claude analysis failed, keeping keyword suggestion\n`);
        continue;
      }
      claudeRes.stdout = fallbackRes.stdout;
    }

    const output = claudeRes.stdout.trim();
    const profileMatch = output.match(/PROFILES?:\s*(.+)/i);
    const mcpsMatch = output.match(/MCPS?:\s*(.+)/i);
    const clisMatch = output.match(/CLIS?:\s*(.+)/i);
    const reasonMatch = output.match(/REASON:\s*(.+)/i);
    const qualityMatch = output.match(/QUALITY:\s*(\d+)/i);

    if (profileMatch) {
      const newProfiles = profileMatch[1]!.split(",").map(p => p.trim().toLowerCase()).filter(p => profiles.includes(p));
      const mcps = (mcpsMatch?.[1] ?? "").split(",").map(m => m.trim().toLowerCase()).filter(m => m && m !== "none");
      const clis = (clisMatch?.[1] ?? "").split(",").map(c => c.trim().toLowerCase()).filter(c => c && c !== "none");
      const reason = reasonMatch?.[1] ?? "";
      const quality = parseInt(qualityMatch?.[1] ?? "5", 10);

      if (newProfiles.length > 0) {
        gem.suggested_profiles = newProfiles.slice(0, 2);
      }
      gem.suggested_mcps = mcps;
      gem.suggested_clis = clis;
      gem.quality = quality;

      process.stdout.write(`     ✅ → ${gem.suggested_profiles.join(", ")} (quality: ${quality}/10)\n`);
      if (mcps.length) process.stdout.write(`        MCPs: ${mcps.join(", ")}\n`);
      if (clis.length) process.stdout.write(`        CLIs: ${clis.join(", ")}\n`);
      if (reason) process.stdout.write(`        ${reason}\n`);
    }
  }

  // Save updated cache
  writeFileSync(cacheFile(), JSON.stringify(cache, null, 2));
  process.stdout.write(`\n  ✅ Analysis complete. Cache updated.\n`);
  process.stdout.write(`  Next: cue discover install --dry-run\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// Notify repo owner via GitHub issue
// ---------------------------------------------------------------------------

const NOTIFY_LOG = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "cue",
  "discover-notified.json",
);

interface NotifyLog {
  notified: Record<string, { date: string; issueUrl: string }>;
  // Daily digest discussion posts in opencue/claude-code-skills, keyed by YYYY-MM-DD.
  digests?: Record<string, { discussionUrl: string; gems: string[] }>;
}

function loadNotifyLog(): NotifyLog {
  if (!existsSync(NOTIFY_LOG)) return { notified: {}, digests: {} };
  try {
    const log = JSON.parse(readFileSync(NOTIFY_LOG, "utf8")) as NotifyLog;
    log.digests ??= {};
    return log;
  } catch { return { notified: {}, digests: {} }; }
}

function saveNotifyLog(log: NotifyLog): void {
  mkdirSync(dirname(NOTIFY_LOG), { recursive: true });
  writeFileSync(NOTIFY_LOG, JSON.stringify(log, null, 2));
}

// ---------------------------------------------------------------------------
// Daily digest discussion (in opencue/claude-code-skills) — lower-pressure analog to --notify
// ---------------------------------------------------------------------------

const DIGEST_REPO = process.env.CUE_DIGEST_REPO ?? "opencue/claude-code-skills";
const DIGEST_CATEGORY_PREF = ["Discoveries", "Show and tell", "Announcements", "General"];

interface DiscussionTarget { repoId: string; categoryId: string; categoryName: string }

function resolveDiscussionTarget(repo: string): DiscussionTarget | null {
  const [owner, name] = repo.split("/");
  if (!owner || !name) return null;
  const query = `query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ id discussionCategories(first:20){ nodes { id name } } } }`;
  const res = spawnSync("gh", [
    "api", "graphql",
    "-f", `query=${query}`,
    "-F", `owner=${owner}`,
    "-F", `name=${name}`,
  ], { encoding: "utf8", timeout: 15000 });
  if (res.status !== 0) return null;
  try {
    const data = JSON.parse(res.stdout);
    const repoNode = data?.data?.repository;
    if (!repoNode?.id) return null;
    const cats: { id: string; name: string }[] = repoNode.discussionCategories?.nodes ?? [];
    if (cats.length === 0) return null;
    for (const pref of DIGEST_CATEGORY_PREF) {
      const hit = cats.find(c => c.name.toLowerCase() === pref.toLowerCase());
      if (hit) return { repoId: repoNode.id, categoryId: hit.id, categoryName: hit.name };
    }
    return { repoId: repoNode.id, categoryId: cats[0]!.id, categoryName: cats[0]!.name };
  } catch { return null; }
}

function buildDigestBody(gems: GemRepo[], date: string): string {
  const byProfile = new Map<string, GemRepo[]>();
  for (const gem of gems) {
    const p = gem.suggested_profiles[0] ?? "core";
    const list = byProfile.get(p) ?? [];
    list.push(gem);
    byProfile.set(p, list);
  }
  const sections: string[] = [];
  for (const profile of [...byProfile.keys()].sort()) {
    const list = byProfile.get(profile)!.sort((a, b) => b.gem_score - a.gem_score);
    const lines = list.map(g => {
      const icon = g.gem_score >= 15 ? "🏆" : g.gem_score >= 8 ? "💎" : "✨";
      const desc = (g.description ?? "").slice(0, 110).replace(/\n+/g, " ");
      const signals: string[] = [];
      if (g.has_skill_md) signals.push("SKILL.md");
      if (g.has_claude_dir) signals.push(".claude/");
      if (g.has_mcp_sdk) signals.push("MCP SDK");
      const sigTag = signals.length ? ` _(${signals.join(", ")})_` : "";
      return `- ${icon} [\`${g.full_name}\`](${g.url}) — ★ ${g.stars} · score ${g.gem_score}${sigTag}\n  ${desc}`;
    }).join("\n");
    sections.push(`### \`${profile}\` (${list.length})\n\n${lines}`);
  }

  return `> Daily digest from [\`cue discover\`](https://github.com/opencue/claude-code-skills) — repos newly indexed on **${date}**, grouped by profile.

cue scans GitHub for high-quality skill repos (\`SKILL.md\`, \`.claude/\`, MCP servers) and routes them into per-profile bundles for users of Claude Code, Codex, and other agents. Today we indexed **${gems.length}** gem(s) across **${byProfile.size}** profile(s).

${sections.join("\n\n")}

---

**Want to be indexed?** Add a \`SKILL.md\` to your repo root or tag it \`topic:claude-skill\`. We scan daily.

**Don't want to be indexed?** Open an issue and we'll exclude your repo.

<sub>Posted by \`cue discover install --digest\`. One post per day.</sub>`;
}

function postDailyDigest(gems: GemRepo[], opts: { dryRun: boolean }): void {
  if (gems.length === 0) {
    process.stdout.write(`  ⏭  Digest: nothing new to post.\n`);
    return;
  }

  const log = loadNotifyLog();
  const date = new Date().toISOString().split("T")[0]!;
  if (log.digests?.[date]) {
    process.stdout.write(`  ⏭  Digest: already posted today (${log.digests[date].discussionUrl}).\n`);
    return;
  }

  const title = `cue discover — daily digest ${date} (${gems.length} new gem${gems.length === 1 ? "" : "s"})`;
  const body = buildDigestBody(gems, date);

  if (opts.dryRun) {
    process.stdout.write(`  [dry-run] Would post digest to ${DIGEST_REPO} discussions:\n`);
    process.stdout.write(`     Title: ${title}\n`);
    process.stdout.write(`     Body: ${body.length} chars across ${gems.length} gems\n`);
    return;
  }

  const target = resolveDiscussionTarget(DIGEST_REPO);
  if (!target) {
    process.stdout.write(`  ⚠️  Digest: could not resolve discussion category on ${DIGEST_REPO} (discussions enabled? gh auth?). Skipped.\n`);
    return;
  }

  const mutation = `mutation($repoId:ID!,$catId:ID!,$title:String!,$body:String!){ createDiscussion(input:{repositoryId:$repoId,categoryId:$catId,title:$title,body:$body}){ discussion { url } } }`;
  const res = spawnSync("gh", [
    "api", "graphql",
    "-f", `query=${mutation}`,
    "-F", `repoId=${target.repoId}`,
    "-F", `catId=${target.categoryId}`,
    "-F", `title=${title}`,
    "-F", `body=${body}`,
  ], { encoding: "utf8", timeout: 20000 });

  if (res.status !== 0) {
    process.stdout.write(`  ⚠️  Digest: failed to post — ${res.stderr?.trim().slice(0, 120)}\n`);
    return;
  }

  try {
    const out = JSON.parse(res.stdout);
    const url: string = out?.data?.createDiscussion?.discussion?.url ?? "";
    log.digests ??= {};
    log.digests[date] = { discussionUrl: url, gems: gems.map(g => g.full_name) };
    saveNotifyLog(log);
    process.stdout.write(`  📰 Posted daily digest (${target.categoryName}): ${url}\n`);
  } catch {
    process.stdout.write(`  ⚠️  Digest: posted but couldn't parse response.\n`);
  }
}

// ---------------------------------------------------------------------------
// Hero badge composition — tokscale-style 3-stat row for issues + export pages
// ---------------------------------------------------------------------------

/** URL-encode a shields.io label segment (escape - and _, spaces become _). */
function shieldsEscape(s: string): string {
  return encodeURIComponent(s).replace(/-/g, "--").replace(/_/g, "__").replace(/%20/g, "_");
}

/** Build a shields.io for-the-badge URL with optional logo/labelColor. */
function shieldsBadge(label: string, value: string, color: string, opts: { labelColor?: string; logo?: string } = {}): string {
  const params = new URLSearchParams();
  params.set("style", "for-the-badge");
  if (opts.labelColor) params.set("labelColor", opts.labelColor);
  if (opts.logo) params.set("logo", opts.logo);
  return `https://img.shields.io/badge/${shieldsEscape(label)}-${shieldsEscape(value)}-${color}?${params.toString()}`;
}

/** Tier → palette: { primary, label, tier name } matching the TTY render. */
function tierPalette(score: number): { primary: string; label: string; tier: string } {
  if (score >= 12) return { primary: "8b5cf6", label: "1e1b4b", tier: "PREMIUM" };
  if (score >= 8) return { primary: "06b6d4", label: "0e2a3a", tier: "STRONG" };
  if (score >= 5) return { primary: "eab308", label: "3a2a0e", tier: "WORTH" };
  return { primary: "6b7280", label: "1f2937", tier: "TAIL" };
}

/** Stars magnitude → palette + abbreviated display (1.5K, 15K, etc.). */
function starsPalette(stars: number): { primary: string; display: string } {
  const display = stars >= 1000 ? `★ ${(stars / 1000).toFixed(stars >= 10000 ? 0 : 1)}K` : `★ ${stars}`;
  if (stars >= 1000) return { primary: "ec4899", display };
  if (stars >= 100) return { primary: "22c55e", display };
  if (stars >= 10) return { primary: "eab308", display };
  return { primary: "6b7280", display };
}

/**
 * Markdown for the tokscale-style 3-badge hero strip:
 *   [ Score: 20.5 (PREMIUM) ]  [ Stars: ★ 15.5K ]  [ Profile: core ]
 * Centered in <p align="center"> for GitHub issue / markdown rendering.
 */
export function buildGemHeroBadges(gem: GemRepo, profile: string): string {
  const t = tierPalette(gem.gem_score);
  const s = starsPalette(gem.stars);
  const scoreBadge = shieldsBadge("Score", `${gem.gem_score} (${t.tier})`, t.primary, { labelColor: "1e1b4b" });
  const starsBadge = shieldsBadge("Stars", s.display, s.primary, { labelColor: "1e1b4b" });
  const profileBadge = shieldsBadge("Profile", profile, "c084fc", { labelColor: "1e1b4b" });
  return `<p align="center">
  <img src="${scoreBadge}" alt="score ${gem.gem_score} (${t.tier})">&nbsp;
  <img src="${starsBadge}" alt="${gem.stars} stars">&nbsp;
  <img src="${profileBadge}" alt="${profile} profile">
</p>`;
}

/**
 * Standalone SVG card mimicking tokscale — dark gradient bg, three stat cards
 * (Score · Stars · Profile) with bold colored numbers. Self-contained, no
 * external font deps. Embed via raw URL or inline.
 */
export function buildGemBadgeSvg(gem: GemRepo, profile: string): string {
  const t = tierPalette(gem.gem_score);
  const s = starsPalette(gem.stars);
  const esc = (str: string) => str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const W = 720, H = 220;
  const cardW = 220, cardH = 100, gap = 20, padX = 20, cardY = 95;
  const cards = [
    { label: "Score", value: `${gem.gem_score}`, sub: t.tier, color: `#${t.primary}`, bg: `#${t.label}` },
    { label: "Stars", value: s.display, sub: "github", color: `#${s.primary}`, bg: "#1f3a1d" },
    { label: "Profile", value: profile, sub: gem.has_skill_md ? "SKILL.md" : "matched", color: "#c084fc", bg: "#3a1d3a" },
  ];
  const updated = new Date().toISOString().split("T")[0];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="cue hidden gem: ${esc(gem.full_name)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a14"/>
      <stop offset="100%" stop-color="#1e1b4b"/>
    </linearGradient>
    <style>
      .title { font: bold 18px -apple-system, system-ui, sans-serif; fill: #fff; }
      .sub { font: 13px -apple-system, system-ui, sans-serif; fill: #9ca3af; }
      .card-label { font: bold 12px -apple-system, system-ui, sans-serif; letter-spacing: .5px; text-transform: uppercase; }
      .card-value { font: bold 32px -apple-system, system-ui, sans-serif; }
      .card-sub { font: 11px -apple-system, system-ui, sans-serif; fill: #6b7280; }
      .footer { font: 11px -apple-system, system-ui, sans-serif; fill: #4b5563; }
    </style>
  </defs>
  <rect width="${W}" height="${H}" rx="14" fill="url(#bg)"/>
  <text class="title" x="${padX}" y="36">💎 cue · hidden gem</text>
  <text class="sub" x="${padX}" y="58">@${esc(gem.full_name)}</text>
${cards.map((c, i) => {
  const x = padX + i * (cardW + gap);
  return `  <g transform="translate(${x}, ${cardY})">
    <rect width="${cardW}" height="${cardH}" rx="10" fill="${c.bg}" stroke="${c.color}" stroke-opacity="0.4" stroke-width="1"/>
    <text class="card-label" x="14" y="22" fill="${c.color}">${esc(c.label)}</text>
    <text class="card-value" x="14" y="62" fill="${c.color}">${esc(c.value)}</text>
    <text class="card-sub" x="14" y="84">${esc(c.sub)}</text>
  </g>`;
}).join("\n")}
  <text class="footer" x="${padX}" y="${H - 14}">cue discovery engine · scored ${updated}</text>
  <text class="footer" x="${W - padX}" y="${H - 14}" text-anchor="end">github.com/opencue/claude-code-skills</text>
</svg>`;
}

function notifyOwner(gem: GemRepo, profile: string, opts: { dryRun?: boolean; force?: boolean } = {}): void {
  const log = loadNotifyLog();
  if (log.notified[gem.full_name] && !opts.force) {
    process.stdout.write(`     ⏭  ${gem.full_name} already notified at ${log.notified[gem.full_name]!.issueUrl}\n`);
    return;
  }

  // Rate limit: max 15 issues per day to stay under GitHub's radar
  const today = new Date().toISOString().split("T")[0]!;
  const todayCount = Object.values(log.notified).filter(n => n.date.startsWith(today)).length;
  if (todayCount >= 15) {
    process.stdout.write(`     🛑 Daily limit reached (${todayCount}/15) — skipping notify to protect your account\n`);
    return;
  }

  // Neutral, dependabot-style title — visual hooks live in the body.
  const t = tierPalette(gem.gem_score);
  const title = `💎 Hidden Gem — your repo was added to cue's "${profile}" profile`;
  const heroBadges = buildGemHeroBadges(gem, profile);
  const readmeBadge = shieldsBadge("cue", `💎 hidden gem`, t.primary, { labelColor: "1e1b4b" });

  // Per-repo evidence — only show signals that actually fired.
  const evidence: string[] = [];
  if (gem.has_skill_md) evidence.push("`SKILL.md` in repo root");
  if (gem.has_claude_dir) evidence.push("`.claude/` directory present");
  if (gem.has_mcp_sdk) evidence.push("uses `@modelcontextprotocol/sdk`");
  const gemTopics = gem.topics.filter(t => ["claude-skill", "claude-code", "mcp-server", "ai-agent", "codex-plugin", "claude-code-skill", "agent-skill"].includes(t));
  if (gemTopics.length) evidence.push(`relevant topic${gemTopics.length > 1 ? "s" : ""}: ${gemTopics.map(t => `\`${t}\``).join(", ")}`);
  if (gem.stars >= 5 && gem.forks > 0 && gem.forks / gem.stars >= 0.1) {
    evidence.push(`${gem.stars}★ / ${gem.forks} forks — genuine reuse ratio`);
  }
  const pushedDays = gem.pushed_at ? Math.floor((Date.now() - new Date(gem.pushed_at).getTime()) / 86400000) : null;
  if (pushedDays !== null && pushedDays < 30) evidence.push(`actively maintained — last push ${pushedDays}d ago`);
  const evidenceList = evidence.length
    ? evidence.map(s => `- ✅ ${s}`).join("\n")
    : "- ✅ matched cue's profile search query";

  // Per-factor score breakdown for the collapsible "How it scored" details.
  const { components } = scoreGemBreakdown(gem);
  const breakdownRows = components
    .map(c => `| ${c.delta > 0 ? "+" : ""}${c.delta.toFixed(1)} | ${c.label} |`)
    .join("\n");

  const body = `> **Automated, one-time notification.** Close this issue to opt out — we'll never open another on this repo.

${heroBadges}

<h2 align="center">💎 Your repo was added to cue's <code>${profile}</code> profile</h2>

[**cue**](https://github.com/opencue/claude-code-skills) scans GitHub for high-quality skill repos and routes them to per-profile bundles for Claude Code & Codex users. \`${gem.full_name}\` cleared the discovery threshold (score **${gem.gem_score}**, tier **${t.tier}**) and is now auto-loaded for everyone on the **\`${profile}\`** profile.

## Install (one line)

\`\`\`bash
cue skills add ${gem.full_name}
\`\`\`

## Why your repo was picked

${evidenceList}

<details>
<summary><strong>How the score was computed</strong> (click to expand)</summary>

| Δ | Factor |
|---:|---|
${breakdownRows}
| **${gem.gem_score}** | **Total** |

[Full scoring rubric →](https://github.com/opencue/claude-code-skills/blob/main/src/commands/discover.ts)

</details>

## Where you appear now

| Channel | Status |
|---|---|
| \`cue discover\` results | ✅ Listed |
| \`cue optimizer\` dashboard | ✅ Shown to all users on \`${profile}\` |
| [\`docs/discovered.md\`](https://github.com/opencue/claude-code-skills/blob/main/docs/discovered.md) | ✅ Indexed |
| GitHub backlink traffic | ✅ Active |

## Optional: README badge

<p align="center">
  <a href="https://github.com/opencue/claude-code-skills"><img src="${readmeBadge}" alt="cue hidden gem"></a>
</p>

\`\`\`markdown
[![cue hidden gem](${readmeBadge})](https://github.com/opencue/claude-code-skills)
\`\`\`

---

<sub>Opened by <a href="https://github.com/opencue/claude-code-skills"><code>cue discover install --notify</code></a>. One issue per repo, ever. To opt out, close this issue or <a href="https://github.com/opencue/claude-code-skills/issues/new">file an issue against cue</a>.</sub>`;

  if (opts.dryRun) {
    process.stdout.write(`\n${wrap(ANSI.bold, "─── DRY RUN ───────────────────────────────────────────────────────────")}\n`);
    process.stdout.write(`${wrap(ANSI.dim, "would post to")} ${wrap(ANSI.bold, "https://github.com/" + gem.full_name + "/issues/new")}\n\n`);
    process.stdout.write(`${wrap(ANSI.bold, "Title:")} ${title}\n\n`);
    process.stdout.write(`${wrap(ANSI.bold, "Body:")}\n${body}\n`);
    process.stdout.write(`${wrap(ANSI.bold, "───────────────────────────────────────────────────────────────────────")}\n`);
    process.stdout.write(`${wrap(ANSI.dim, "(dry-run — no issue created. Remove --dry-run to post.)")}\n\n`);
    return;
  }

  const res = spawnSync("gh", [
    "issue", "create",
    "--repo", gem.full_name,
    "--title", title,
    "--body", body,
  ], { encoding: "utf8", timeout: 15000 });

  if (res.status === 0) {
    const issueUrl = res.stdout.trim();
    process.stdout.write(`     📬 Notified owner: ${issueUrl}\n`);
    log.notified[gem.full_name] = { date: new Date().toISOString(), issueUrl };
    saveNotifyLog(log);
  } else {
    process.stdout.write(`     ⚠️  Could not notify (issues may be disabled, repo private, or no gh auth)\n`);
    if (res.stderr) process.stdout.write(`     ${wrap(ANSI.dim, res.stderr.trim().slice(0, 200))}\n`);
  }
}

/**
 * `cue discover notify <repo>` — open a one-time GitHub issue on a specific
 * gem repo, announcing that cue indexed it. Notify-only — does NOT install
 * the skill, clone, or modify any profile.yaml. Idempotent via NOTIFY_LOG.
 */
async function cmdNotify(repo: string | undefined, opts: { profile?: string; dryRun: boolean; force: boolean }): Promise<number> {
  if (!repo) {
    process.stderr.write("Usage: cue discover notify <owner/repo> [--profile <name>] [--dry-run] [--force]\n");
    return 1;
  }
  if (!existsSync(cacheFile())) {
    process.stderr.write("No cached gems. Run `cue discover search` first.\n");
    return 1;
  }
  const cache: GemCache = JSON.parse(readFileSync(cacheFile(), "utf8"));
  const gem = cache.gems.find(g => g.full_name.toLowerCase() === repo.toLowerCase());
  if (!gem) {
    process.stderr.write(`Gem "${repo}" not found in cache. Run \`cue discover search\` to refresh, or check spelling.\n`);
    return 1;
  }

  const profile = opts.profile ?? gem.suggested_profiles[0] ?? "core";
  process.stdout.write(`  📬 ${opts.dryRun ? "Dry-run" : "Notifying"}: ${wrap(ANSI.bold, gem.full_name)} → profile ${wrap(ANSI.cyan, profile)}\n`);
  notifyOwner(gem, profile, { dryRun: opts.dryRun, force: opts.force });
  return 0;
}

// ---------------------------------------------------------------------------
// Auto-install CLI dependencies from skill's SKILL.md
// ---------------------------------------------------------------------------

export function autoInstallClis(skillName: string): void {
  const skillsDir = join(homedir(), ".claude", "skills");
  const skillMdPath = join(skillsDir, skillName, "SKILL.md");
  if (!existsSync(skillMdPath)) return;

  const content = readFileSync(skillMdPath, "utf8");

  // Extract install commands from ## Prerequisites section
  const prereqMatch = content.match(/## Prerequisites\n([\s\S]*?)(?=\n##|\n---|\n\n\n|$)/i);
  if (!prereqMatch) return;

  const prereqBlock = prereqMatch[1]!;
  const installCmds: { cmd: string; args: string[]; label: string }[] = [];

  // Match npm install -g <pkg>
  for (const m of prereqBlock.matchAll(/npm install -g\s+([\w@/-]+)/g)) {
    const pkg = m[1]!;
    if (spawnSync("which", [pkg.split("/").pop()!.replace(/@.*/, "")], { encoding: "utf8" }).status === 0) continue;
    installCmds.push({ cmd: "npm", args: ["install", "-g", pkg], label: `npm install -g ${pkg}` });
  }

  // Match brew install <pkg>
  for (const m of prereqBlock.matchAll(/brew install\s+([\w-]+)/g)) {
    const pkg = m[1]!;
    if (spawnSync("which", [pkg], { encoding: "utf8" }).status === 0) continue;
    installCmds.push({ cmd: "brew", args: ["install", pkg], label: `brew install ${pkg}` });
  }

  // Match cargo install <pkg>
  for (const m of prereqBlock.matchAll(/cargo install\s+([\w-]+)/g)) {
    const pkg = m[1]!;
    if (spawnSync("which", [pkg.replace("-cli", "")], { encoding: "utf8" }).status === 0) continue;
    installCmds.push({ cmd: "cargo", args: ["install", pkg], label: `cargo install ${pkg}` });
  }

  // Match pip install <pkg> / pipx install <pkg>
  for (const m of prereqBlock.matchAll(/(?:pip|pipx) install\s+([\w-]+)/g)) {
    const pkg = m[1]!;
    if (spawnSync("which", [pkg], { encoding: "utf8" }).status === 0) continue;
    installCmds.push({ cmd: "pipx", args: ["install", pkg], label: `pipx install ${pkg}` });
  }

  if (installCmds.length === 0) return;

  for (const { cmd, args, label } of installCmds) {
    // Check if the package manager exists
    if (spawnSync("which", [cmd], { encoding: "utf8" }).status !== 0) {
      process.stdout.write(`     ⚠️  CLI needed: ${label} (${cmd} not found)\n`);
      continue;
    }
    process.stdout.write(`     📦 Installing CLI: ${label}...\n`);
    const res = spawnSync(cmd, args, { encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] });
    if (res.status === 0) {
      process.stdout.write(`     ✅ ${label}\n`);
    } else {
      process.stdout.write(`     ⚠️  Failed: ${label}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// Install gems into profiles
// ---------------------------------------------------------------------------

async function cmdInstall(opts: { profile?: string; minScore: number; minQuality: number; dryRun: boolean; all: boolean; notify: boolean; digest: boolean }): Promise<number> {
  if (!existsSync(cacheFile())) {
    process.stderr.write("No cached gems. Run `cue discover search` first.\n");
    return 1;
  }

  const cache: GemCache = JSON.parse(readFileSync(cacheFile(), "utf8"));
  let gems = cache.gems.filter(g => g.gem_score >= opts.minScore);

  if (opts.profile) {
    gems = gems.filter(g => g.suggested_profiles.includes(opts.profile!));
  }

  // Quality gate: skip gems that were analyzed and scored below threshold
  gems = gems.filter(g => {
    if (g.quality > 0 && g.quality < opts.minQuality) {
      process.stdout.write(`  ⏭  ${g.full_name} — skipped (quality ${g.quality}/10 < min ${opts.minQuality})\n`);
      return false;
    }
    return true;
  });

  if (gems.length === 0) {
    process.stdout.write("No gems match the criteria. Try lowering --min-score or --min-quality, or running a new search.\n");
    return 0;
  }

  process.stdout.write(`\n  📦 Installing ${gems.length} gem(s) into profiles${opts.profile ? ` (filtered: ${opts.profile})` : ""}...\n\n`);

  let installed = 0;
  let skipped = 0;

  for (const gem of gems) {
    const targetProfile = opts.profile ?? gem.suggested_profiles[0] ?? "core";
    const icon = gem.gem_score >= 8 ? "💎" : gem.gem_score >= 5 ? "✨" : "🔹";

    process.stdout.write(`  ${icon} ${gem.full_name} → ${targetProfile}\n`);
    if (gem.suggested_mcps?.length) process.stdout.write(`     MCPs: ${gem.suggested_mcps.join(", ")}\n`);
    if (gem.suggested_clis?.length) process.stdout.write(`     CLIs: ${gem.suggested_clis.join(", ")}\n`);

    if (opts.dryRun) {
      process.stdout.write(`     [dry-run] Would run: npx skills add ${gem.full_name} -a claude-code -y\n`);
      installed++;
      continue;
    }

    // Install the skill via npx skills add
    const addRes = spawnSync("npx", ["skills", "add", gem.full_name, "-a", "claude-code", "-y"], {
      encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"],
    });

    if (addRes.status !== 0) {
      // Fallback: clone into skills dir
      const skillsDir = join(homedir(), ".claude", "skills");
      const targetDir = join(skillsDir, gem.name);
      if (!existsSync(targetDir)) {
        const cloneRes = spawnSync("git", ["clone", "--depth", "1", gem.url, targetDir], {
          encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"],
        });
        if (cloneRes.status !== 0) {
          process.stdout.write(`     ⚠️  Failed to install: ${addRes.stderr?.trim().slice(0, 80)}\n`);
          skipped++;
          continue;
        }
      }
    } else {
      // npx succeeded — fetch companion files (scripts/, forms.md, etc.)
      const skillsDir = join(homedir(), ".claude", "skills");
      const localDir = join(skillsDir, gem.name);
      if (existsSync(localDir)) {
        const skillPath = detectSkillPath(gem.full_name, gem.name);
        if (skillPath) {
          const { fetched } = fetchCompanionFiles(gem.full_name, skillPath, localDir, { quiet: true });
          if (fetched.length > 0) {
            process.stdout.write(`     📂 Fetched companion files: ${fetched.join(", ")}\n`);
          }
        }
      }
    }

    // Auto-install CLI dependencies from the skill's SKILL.md Prerequisites
    autoInstallClis(gem.name);

    // Add to profile.yaml
    const profileYaml = join(REPO_ROOT, "profiles", targetProfile, "profile.yaml");
    if (existsSync(profileYaml)) {
      const content = readFileSync(profileYaml, "utf8");
      // Find the skill ID (use repo name as fallback)
      const skillId = gem.name;
      if (!content.includes(skillId)) {
        // Append under skills.local
        const localMatch = content.match(/(skills:\s*\n\s*local:\s*\n)([\s\S]*?)(\n\S|\n*$)/);
        if (localMatch) {
          const indent = "    ";
          const insertion = `${indent}- ${skillId}\n`;
          const updated = content.replace(localMatch[0], localMatch[1] + localMatch[2] + insertion + (localMatch[3] ?? ""));
          writeFileSync(profileYaml, updated);
          process.stdout.write(`     ✅ Added skill to ${targetProfile}/profile.yaml\n`);
        }
      } else {
        process.stdout.write(`     ⏭  Skill already in profile\n`);
      }

      // Add MCPs if detected by analyze
      if (gem.suggested_mcps?.length) {
        let current = readFileSync(profileYaml, "utf8");
        const newMcps = gem.suggested_mcps.filter(m => !current.includes(m));
        if (newMcps.length) {
          const mcpsMatch = current.match(/(mcps:\s*\n)([\s\S]*?)(\n\S|\n*$)/);
          if (mcpsMatch) {
            const mcpLines = newMcps.map(m => `  - ${m}\n`).join("");
            current = current.replace(mcpsMatch[0], mcpsMatch[1] + mcpsMatch[2] + mcpLines + (mcpsMatch[3] ?? ""));
          } else {
            // No mcps section yet — add one
            current += `\nmcps:\n${newMcps.map(m => `  - ${m}`).join("\n")}\n`;
          }
          writeFileSync(profileYaml, current);
          process.stdout.write(`     ✅ Added MCPs: ${newMcps.join(", ")}\n`);
        }
      }

      // Show CLI requirements
      if (gem.suggested_clis?.length) {
        const missing = gem.suggested_clis.filter(c => {
          const which = spawnSync("which", [c], { encoding: "utf8" });
          return which.status !== 0;
        });
        if (missing.length) {
          process.stdout.write(`     ⚠️  Missing CLIs: ${missing.join(", ")} — install them for full functionality\n`);
        }
      }
    }

    installed++;

    // Notify repo owner via GitHub issue
    if (opts.notify && !opts.dryRun) {
      notifyOwner(gem, targetProfile);
    }
  }

  process.stdout.write(`\n  Done: ${installed} installed, ${skipped} skipped\n`);
  if (opts.dryRun) process.stdout.write(`  (dry-run — no changes made. Remove --dry-run to apply)\n`);

  // Daily digest discussion in opencue/claude-code-skills — covers everything we just touched,
  // so owners who don't get a --notify issue can still find the post.
  if (opts.digest) {
    const log = loadNotifyLog();
    const today = new Date().toISOString().split("T")[0]!;
    // Skip repos already mentioned in today's digest (dedupe across runs).
    const alreadyDigested = new Set(log.digests?.[today]?.gems ?? []);
    const newToday = gems.filter(g => !alreadyDigested.has(g.full_name));
    postDailyDigest(newToday, { dryRun: opts.dryRun });
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Suggest new profiles from clusters of poorly-fit gems
// ---------------------------------------------------------------------------

interface ProfileDraft {
  name: string;
  description: string;
  cluster_term: string;
  skills: string[];
}

/** Ask Claude for a profile name + one-line description. Falls back to the cluster term on failure. */
function nameClusterWithClaude(cluster: Cluster, existingProfiles: string[]): { name: string; description: string } {
  const sampleLines = cluster.items.slice(0, 8).map(i => `- ${i.id}: ${i.text.slice(0, 140)}`).join("\n");
  const prompt = `You name cue profiles (skill bundles). Given a cluster of skill repos that share vocabulary, propose ONE short profile name and a one-line description.

Cluster keyword: "${cluster.term}"
Existing profile names (do not collide): ${existingProfiles.join(", ")}

Member skills:
${sampleLines}

Respond in EXACTLY this format (no other text):
NAME: <lowercase-kebab, 1-3 words, no quotes>
DESCRIPTION: <one line, under 80 chars, no quotes>`;

  const tryOne = (bin: string) => spawnSync(bin, ["--print", "-p", prompt], {
    encoding: "utf8", timeout: 30000, env: { ...process.env, CUE_BYPASS: "1" },
  });

  let res = tryOne("claude");
  if (res.status !== 0 || !res.stdout.trim()) {
    const fallback = findRealClaudeBin();
    if (fallback) res = tryOne(fallback);
  }

  const fallbackName = cluster.term.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  if (res.status !== 0 || !res.stdout.trim()) {
    return { name: fallbackName, description: `Cluster of skills around "${cluster.term}"` };
  }

  const out = res.stdout.trim();
  const nameMatch = out.match(/NAME:\s*([a-z0-9][a-z0-9-]{0,30})/i);
  const descMatch = out.match(/DESCRIPTION:\s*(.+)/i);
  let name = (nameMatch?.[1] ?? fallbackName).toLowerCase();
  // Collision-avoid: append the cluster term suffix if needed.
  if (existingProfiles.includes(name)) name = `${name}-${fallbackName}`.slice(0, 40);
  const description = (descMatch?.[1] ?? `Skills around "${cluster.term}"`).trim().slice(0, 100);
  return { name, description };
}

async function cmdSuggestProfiles(opts: { minSize: number; outDir: string; dryRun: boolean; noClaude: boolean; embeddings: boolean }): Promise<number> {
  if (!existsSync(cacheFile())) {
    process.stderr.write("No cached gems. Run `cue discover search` first.\n");
    return 1;
  }
  const cache: GemCache = JSON.parse(readFileSync(cacheFile(), "utf8"));

  // Candidates: gems whose only fit is `core` (or no fit at all). These are
  // the ones a new profile would actually help.
  const candidates = cache.gems.filter(g => {
    if (!g.suggested_profiles?.length) return true;
    return g.suggested_profiles.length === 1 && g.suggested_profiles[0] === "core";
  });

  if (candidates.length < opts.minSize) {
    process.stdout.write(`  No clustering needed: only ${candidates.length} gem(s) lack a specific profile.\n`);
    return 0;
  }

  const items: ClusterItem[] = candidates.map(g => ({
    id: g.full_name,
    // Pack name, description, and topics into the text so the tokenizer sees all signals.
    text: `${g.name} ${g.description ?? ""} ${(g.topics ?? []).join(" ")}`,
  }));

  let clusters: Cluster[] = [];
  if (opts.embeddings) {
    if (!process.env.VOYAGE_API_KEY) {
      process.stdout.write(`  ⚠️  --embeddings requested but VOYAGE_API_KEY not set. Falling back to keyword clustering.\n\n`);
    } else {
      try {
        process.stdout.write(`  🧠 Embedding ${items.length} gems via Voyage...\n`);
        clusters = await clusterByEmbeddings(items, { minSize: opts.minSize, maxClusters: 8 });
      } catch (err) {
        process.stdout.write(`  ⚠️  Embedding call failed (${(err as Error).message}). Falling back to keyword clustering.\n\n`);
        clusters = [];
      }
    }
  }
  if (clusters.length === 0) {
    clusters = clusterByKeywords(items, { minSize: opts.minSize, maxClusters: 8 });
  }
  if (clusters.length === 0) {
    process.stdout.write(`  No clusters of ≥${opts.minSize} skills found among ${candidates.length} unfit gem(s).\n`);
    return 0;
  }

  const existing = await listProfiles();
  process.stdout.write(`\n  🧩 Found ${clusters.length} cluster(s) of poorly-fit gems\n\n`);

  const drafts: ProfileDraft[] = [];
  for (const cluster of clusters) {
    process.stdout.write(`  ▸ "${cluster.term}" (${cluster.items.length} skills)\n`);
    for (const item of cluster.items.slice(0, 6)) {
      process.stdout.write(`      · ${item.id}\n`);
    }
    if (cluster.items.length > 6) process.stdout.write(`      … +${cluster.items.length - 6} more\n`);

    const { name, description } = opts.noClaude
      ? { name: cluster.term.replace(/\s+/g, "-").toLowerCase(), description: `Skills around "${cluster.term}"` }
      : nameClusterWithClaude(cluster, [...existing, ...drafts.map(d => d.name)]);
    process.stdout.write(`      → proposed profile: \`${name}\` — ${description}\n\n`);

    drafts.push({
      name,
      description,
      cluster_term: cluster.term,
      skills: cluster.items.map(i => i.id),
    });
  }

  const orphans = unclustered(items, clusters);
  if (orphans.length) {
    process.stdout.write(`  ${orphans.length} unfit gem(s) didn't join any cluster (stay in core).\n\n`);
  }

  if (opts.dryRun) {
    process.stdout.write(`  [dry-run] Would write ${drafts.length} draft profile(s) under ${opts.outDir}\n`);
    return 0;
  }

  mkdirSync(opts.outDir, { recursive: true });
  for (const draft of drafts) {
    const profileDir = join(opts.outDir, draft.name);
    mkdirSync(profileDir, { recursive: true });
    const yaml = `name: ${draft.name}
icon: "🧩"
description: ${draft.description}
inherits: core
# Draft generated by \`cue discover suggest-profiles\` (cluster term: "${draft.cluster_term}").
# Review, rename if needed, then move to profiles/${draft.name}/ to adopt.
skills:
  local:
${draft.skills.map(s => `    - ${s}`).join("\n")}
`;
    writeFileSync(join(profileDir, "profile.yaml"), yaml);
  }
  process.stdout.write(`  📝 Wrote ${drafts.length} draft profile(s) to ${opts.outDir}\n`);
  process.stdout.write(`     Review, then mv <draft>/ profiles/<name>/ to adopt.\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// List cached gems
// ---------------------------------------------------------------------------

function cmdList(opts: { json: boolean; limit: number; filter?: GemFilter; render?: "rich" | "compact" | "grouped" | "tiered"; verbose?: boolean; showTail?: boolean }): number {
  if (!existsSync(cacheFile())) {
    process.stdout.write("No cached gems. Run `cue discover search` first.\n");
    return 1;
  }

  const cache: GemCache = JSON.parse(readFileSync(cacheFile(), "utf8"));
  const filtered = opts.filter ? applyFilters(cache.gems, opts.filter) : cache.gems;
  const display = filtered.slice(0, opts.limit);

  if (opts.json) {
    process.stdout.write(JSON.stringify(display, null, 2) + "\n");
    return 0;
  }

  const headerCount = filtered.length === cache.gems.length
    ? `${cache.gems.length}`
    : `${filtered.length}${wrap(ANSI.dim, `/${cache.gems.length}`)}`;
  process.stdout.write(`\n  📚 ${wrap(ANSI.bold, `Cached Gems: ${headerCount}`)}  ${wrap(ANSI.dim, `(scanned ${cache.updated.split("T")[0]})`)}\n`);

  if (display.length === 0) {
    process.stdout.write(`\n  ${wrap(ANSI.yellow, "No gems match those filters.")}\n`);
    return 0;
  }

  const renderOpts: RenderOpts = { verbose: opts.verbose };
  const mode = opts.render ?? "tiered";
  if (mode === "compact") {
    process.stdout.write("\n");
    for (const g of display) process.stdout.write(renderGemCompact(g) + "\n");
  } else if (mode === "grouped") {
    process.stdout.write(renderGroupedByProfile(display, renderOpts) + "\n");
  } else if (mode === "tiered") {
    process.stdout.write(renderTiered(display, { ...renderOpts, showTail: opts.showTail }) + "\n");
  } else {
    process.stdout.write("\n");
    for (const g of display) process.stdout.write(renderGemRich(g, renderOpts) + "\n\n");
  }

  process.stdout.write(`\n  ${wrap(ANSI.dim, "Tip:")} ${wrap(ANSI.bold, "cue discover --export")} · filters: --min-stars N · --fresh N · --has-mcp · --tier premium,strong · --not-installed · --compact · --verbose\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// Discover MCP servers on GitHub
// ---------------------------------------------------------------------------

const MCP_SEARCH_QUERIES = [
  { q: `"@modelcontextprotocol/sdk" in:file filename:package.json`, label: "MCP SDK in package.json" },
  { q: `topic:mcp-server`, label: "topic:mcp-server" },
  { q: `"McpServer" in:file extension:ts`, label: "McpServer class in .ts" },
  { q: `"StdioServerTransport" in:file extension:ts`, label: "StdioServerTransport in .ts" },
  { q: `topic:model-context-protocol`, label: "topic:model-context-protocol" },
];

interface McpResult {
  full_name: string;
  name: string;
  description: string;
  stars: number;
  pushed_at: string;
  topics: string[];
  url: string;
  server_name: string;
  stdio_command: string;
  score: number;
  suggested_profiles: string[];
}

function scoreMcp(item: any): number {
  const now = Date.now();
  const pushed = item.pushed_at ? new Date(item.pushed_at).getTime() : now;
  const daysSincePush = (now - pushed) / 86400000;
  let score = 0;
  score += 3 * Math.exp(-daysSincePush / 60);
  score += Math.min(2.5, Math.log(1 + (item.stargazers_count ?? 0)) * 0.5);
  if (item.description) score += 1;
  const topics: string[] = item.topics ?? [];
  if (topics.includes("mcp-server") || topics.includes("model-context-protocol")) score += 2;
  if (item.stargazers_count >= 50) score += 2;
  if (daysSincePush > 365) score -= 3;
  return Math.max(0, Math.round(score * 10) / 10);
}

function suggestMcpProfiles(item: any): string[] {
  const desc = (item.description ?? "").toLowerCase();
  const topicStr = (item.topics ?? []).join(" ").toLowerCase();
  const name = (item.name ?? "").toLowerCase();
  const scored: { profile: string; score: number }[] = [];
  for (const [profile, keywords] of Object.entries(PROFILE_KEYWORDS)) {
    let hits = 0;
    for (const kw of keywords) {
      const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
      if (re.test(topicStr)) hits += 3;
      if (re.test(desc)) hits += 1;
      if (re.test(name)) hits += 2;
    }
    if (hits >= 3) scored.push({ profile, score: hits });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 2).map(s => s.profile);
  return top.length ? top : ["core"];
}

function extractMcpMeta(fullName: string, repoName: string): { server_name: string; stdio_command: string } {
  // Try to get package.json for bin/name
  const pkgRes = spawnSync("gh", ["api", `repos/${fullName}/contents/package.json`, "--jq", ".content"], {
    encoding: "utf8", timeout: 10000,
  });
  let serverName = repoName.replace(/^mcp-/, "").replace(/-mcp$/, "").replace(/-server$/, "");
  let stdioCommand = `npx ${repoName}`;

  if (pkgRes.status === 0 && pkgRes.stdout.trim()) {
    try {
      const pkg = JSON.parse(Buffer.from(pkgRes.stdout.trim(), "base64").toString("utf8"));
      if (pkg.name) serverName = pkg.name.replace(/^@[^/]+\//, "").replace(/^mcp-/, "").replace(/-mcp$/, "").replace(/-server$/, "");
      if (pkg.bin) {
        const binName = typeof pkg.bin === "string" ? repoName : Object.keys(pkg.bin)[0] ?? repoName;
        stdioCommand = `npx -y ${pkg.name ?? repoName}`;
        if (binName !== repoName && typeof pkg.bin !== "string") stdioCommand = `npx -y ${pkg.name ?? repoName}`;
      } else if (pkg.scripts?.start) {
        stdioCommand = `npx -y ${pkg.name ?? repoName}`;
      }
    } catch { /* keep defaults */ }
  }
  return { server_name: serverName, stdio_command: stdioCommand };
}

async function cmdDiscoverMcps(opts: { limit: number; minScore: number; json: boolean; profile?: string; install: boolean; dryRun: boolean }): Promise<number> {
  process.stderr.write(`🔍 Searching GitHub for MCP server repos...\n\n`);

  const seen = new Set<string>();
  const results: McpResult[] = [];

  for (const { q, label } of MCP_SEARCH_QUERIES) {
    if (results.length >= opts.limit) break;
    process.stderr.write(`  ⏳ ${label}...\n`);
    const items = ghSearch(q, Math.min(30, opts.limit - results.length));
    for (const item of items) {
      if (seen.has(item.full_name)) continue;
      seen.add(item.full_name);
      const score = scoreMcp(item);
      if (score < opts.minScore) continue;
      const profiles = suggestMcpProfiles(item);
      if (opts.profile && !profiles.includes(opts.profile)) continue;

      const { server_name, stdio_command } = extractMcpMeta(item.full_name, item.name);
      results.push({
        full_name: item.full_name,
        name: item.name,
        description: item.description ?? "",
        stars: item.stargazers_count ?? 0,
        pushed_at: item.pushed_at ?? "",
        topics: item.topics ?? [],
        url: item.html_url ?? `https://github.com/${item.full_name}`,
        server_name,
        stdio_command,
        score,
        suggested_profiles: profiles,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  const display = results.slice(0, opts.limit);

  if (opts.json) {
    process.stdout.write(JSON.stringify(display, null, 2) + "\n");
    return 0;
  }

  if (display.length === 0) {
    process.stdout.write(`\n  No MCP servers found matching criteria.\n`);
    return 0;
  }

  process.stdout.write(`\n  🎯 ${wrap(ANSI.bold, `Found ${display.length} MCP server(s)`)}\n\n`);

  for (const mcp of display) {
    const starsStr = colorStars(mcp.stars);
    process.stdout.write(`  ${wrap(ANSI.magenta, "[MCP]")} ${wrap(ANSI.bold, mcp.full_name)}  ${starsStr}  ${wrap(tierColorFor(mcp.score), `s:${mcp.score}`)}\n`);
    if (mcp.description) process.stdout.write(`       ${mcp.description.slice(0, 80)}\n`);
    process.stdout.write(`       ${wrap(ANSI.cyan, `name: ${mcp.server_name}`)}  ${wrap(ANSI.dim, `cmd: ${mcp.stdio_command}`)}\n`);
    process.stdout.write(`       ${wrap(ANSI.cyan, `→ ${mcp.suggested_profiles.join(", ")}`)}\n\n`);
  }

  if (opts.install) {
    const targetProfile = opts.profile ?? getActiveProfile() ?? "core";
    const profileYaml = join(REPO_ROOT, "profiles", targetProfile, "profile.yaml");
    if (!existsSync(profileYaml)) {
      process.stderr.write(`  ⚠️  Profile "${targetProfile}" not found at ${profileYaml}\n`);
      return 1;
    }

    let content = readFileSync(profileYaml, "utf8");
    let added = 0;
    for (const mcp of display) {
      if (content.includes(mcp.server_name)) {
        process.stdout.write(`  ⏭  ${mcp.server_name} already in ${targetProfile}\n`);
        continue;
      }
      if (opts.dryRun) {
        process.stdout.write(`  [dry-run] Would add "${mcp.server_name}" to ${targetProfile}/profile.yaml mcps:\n`);
        added++;
        continue;
      }
      const mcpsMatch = content.match(/(mcps:\s*\n)([\s\S]*?)(\n\S|\n*$)/);
      if (mcpsMatch) {
        content = content.replace(mcpsMatch[0], mcpsMatch[1] + mcpsMatch[2] + `  - ${mcp.server_name}\n` + (mcpsMatch[3] ?? ""));
      } else if (content.includes("mcps: []")) {
        content = content.replace("mcps: []", `mcps:\n  - ${mcp.server_name}`);
      } else {
        content += `\nmcps:\n  - ${mcp.server_name}\n`;
      }
      added++;
      process.stdout.write(`  ✅ Added ${mcp.server_name} to ${targetProfile}\n`);
    }
    if (added > 0 && !opts.dryRun) writeFileSync(profileYaml, content);
    process.stdout.write(`\n  Done: ${added} MCP(s) ${opts.dryRun ? "would be " : ""}added to ${targetProfile}\n`);
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/** Pull `--flag <value>` out of args, returning value (or undefined). */
function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (!v || v.startsWith("-")) return undefined;
  return v;
}
function intFlag(args: string[], flag: string, dflt?: number): number | undefined {
  const v = flagValue(args, flag);
  if (v === undefined) return dflt;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

/** Build a GemFilter from args. Returns undefined if no filter flags present. */
function parseFilter(args: string[]): GemFilter | undefined {
  const f: GemFilter = {};
  const minStars = intFlag(args, "--min-stars");
  const maxStars = intFlag(args, "--max-stars");
  const freshDays = intFlag(args, "--fresh");
  const staleDays = intFlag(args, "--stale");
  if (minStars !== undefined) f.minStars = minStars;
  if (maxStars !== undefined) f.maxStars = maxStars;
  if (freshDays !== undefined) f.freshDays = freshDays;
  if (staleDays !== undefined) f.staleDays = staleDays;
  if (args.includes("--has-mcp")) f.hasMcp = true;
  if (args.includes("--has-skill-md")) f.hasSkillMd = true;
  if (args.includes("--has-claude-dir")) f.hasClaudeDir = true;
  const language = flagValue(args, "--language");
  if (language) f.language = language;
  const topic = flagValue(args, "--topic");
  if (topic) f.topic = topic;
  const owner = flagValue(args, "--owner");
  if (owner) f.owner = owner;
  const excludeOwner = flagValue(args, "--exclude-owner");
  if (excludeOwner) f.excludeOwner = excludeOwner;
  const tier = flagValue(args, "--tier");
  if (tier) f.tier = new Set(tier.split(",").map(t => t.trim()) as any);
  if (args.includes("--installed")) f.installed = true;
  if (args.includes("--not-installed")) f.notInstalled = true;
  return Object.keys(f).length ? f : undefined;
}

function parseRenderMode(args: string[]): "rich" | "compact" | "grouped" | "tiered" {
  if (args.includes("--compact")) return "compact";
  if (args.includes("--group") || args.includes("--grouped")) return "grouped";
  if (args.includes("--rich")) return "rich";
  if (args.includes("--flat")) return "rich";
  return "tiered";
}

export async function run(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const exportFlag = args.includes("--export");
  const limit = intFlag(args, "--limit", 50)!;
  const minScore = intFlag(args, "--min-score", 3)!;
  const profile = flagValue(args, "--profile");
  const exportPathIdx = args.indexOf("--export");
  const exportPath = exportPathIdx >= 0 && args[exportPathIdx + 1] && !args[exportPathIdx + 1]!.startsWith("-")
    ? args[exportPathIdx + 1]!
    : DEFAULT_EXPORT;
  const siteMode = args.includes("--site");
  const htmlMode = args.includes("--html");
  const verbose = args.includes("--verbose") || args.includes("--explain-score");
  const showTail = args.includes("--all");
  const filter = parseFilter(args);
  const render = parseRenderMode(args);

  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue discover — find hidden gem skill repos on GitHub

Usage:
  cue discover mcps                        Search GitHub for MCP server repos
  cue discover mcps --install              Install found MCPs into profile.yaml
  cue discover mcps --profile <name>       Scope to a specific profile
  cue discover search [query]              Scan GitHub for undiscovered skill repos
  cue discover search --profile <name>     Find gems for a specific profile
  cue discover analyze                     Use Claude to determine best profile per gem
  cue discover install                     Install cached gems into their suggested profiles
  cue discover install --profile <name>    Install only gems for a profile
  cue discover suggest-profiles            Cluster unfit gems → propose new profiles
                                             --min-size <n>   skills per cluster (default: 3)
                                             --out <dir>      output dir (default: .cue-suggestions/)
                                             --no-claude      deterministic naming only
                                             --embeddings     semantic clustering via Voyage
                                                              (needs VOYAGE_API_KEY; falls back
                                                              to TF-IDF on any failure)
                                             --dry-run        preview without writing
  cue discover list                        Show cached gems from last search
  cue discover --export [path]             Generate docs/discovered.md from cache
  cue discover --json                      JSON output

Scope options:
  --profile <name>          Scope search / install / display to one profile
  --limit <n>               Max results (default: 50)
  --min-score <n>           Minimum gem score to include (default: 3)

Display modes (pick one):
  --tiered                  Group by tier 🏆/💎/✨/🔹 (default)
  --grouped, --group        Group by suggested profile (▶ marks your active profile)
  --compact                 One line per gem, dense
  --rich, --flat            Rich card per gem, flat ordering
  --all                     With --tiered: expand the long-tail section
  --verbose, --explain-score   Show per-factor score breakdown

Filters (any combination, no extra GitHub calls — read from cache):
  --min-stars <n>           Only gems with ≥ n stars
  --max-stars <n>           Only gems with ≤ n stars (find unknown picks)
  --fresh <days>            Pushed within last n days
  --stale <days>            Pushed more than n days ago (cleanup view)
  --has-mcp                 Only gems that ship/use an MCP server
  --has-skill-md            Only gems with a SKILL.md
  --has-claude-dir          Only gems with a .claude/ directory
  --language <lang>         Filter by primary language (Rust, Python, …)
  --topic <substr>          Filter by topic substring
  --owner <name>            Only gems from this owner
  --exclude-owner <name>    Drop gems from this owner
  --tier <t1,t2,…>          premium,strong,worth,tail
  --installed               Only gems already wired into some profile.yaml
  --not-installed           Skip gems already in any profile (find net-new)

Install options:
  --dry-run                 Preview installs without making changes
  --notify                  Open a one-time GitHub issue on each indexed repo
  --digest                  Post a daily GitHub Discussion summarizing new gems

Export options:
  --export [path]           Export to markdown (default: docs/discovered.md)
  --site                    With --export: per-profile pages + index.md (SEO)
  --html                    With --site: also emit .html with JSON-LD schema

Scoring (higher = stronger gem signal):
  +5      has SKILL.md (load-bearing evidence)
  +3      has .claude/ directory
  +2      uses MCP SDK
  +2      per relevant topic (capped at 3 hits)
  +0.5    topic diversity (hits across both claude-* and agent/mcp categories)
  +0-3    recency, exponential decay with ~60-day half-life
  +0-2.5  popularity, log-scaled
  +3      proven gem: stars ≥50 AND description mentions skill/mcp/claude/agent
  +2      highly proven: stars ≥500
  +1-2    fork-to-star ratio ≥0.1 / ≥0.3 (genuine reuse)
  +1      description 40-200 chars (specific, human-length)
  +1.5    mature AND actively maintained (>90d old, pushed <30d)
  +0-1    earned attention (stars × age, log-scaled)
  -0.5    year-stamped description (e.g. "2026:") and no SKILL.md
  -1      owner with high-entropy numeric tail (bot/dump signal)
  -1      year-stamped repo name (e.g. *-2026) and no SKILL.md
  -3      no commits in 1yr
  =0      obvious AI dump

Run with --verbose to see the per-factor breakdown for each gem.

Examples:
  cue discover search --profile rust                 # rust gems only
  cue discover search --has-mcp --min-stars 10       # known MCP servers
  cue discover --tier premium,strong --not-installed # high-quality new picks
  cue discover --group                               # cluster by profile
  cue discover --verbose                             # show score math
  cue discover --compact --all                       # full long list, one line each
  cue discover install --profile marketing           # install marketing gems
  cue discover install --digest --notify             # daily run
  cue discover --export                              # generate docs/discovered.md
`);
    return 0;
  }

  if (exportFlag) return cmdExport(exportPath, { site: siteMode, html: htmlMode });

  // Strip flag values from positional args.
  const skipValues = new Set<number>();
  const flagsWithValues = ["--limit", "--min-score", "--min-quality", "--profile", "--min-stars", "--max-stars",
    "--fresh", "--stale", "--language", "--topic", "--owner", "--exclude-owner", "--tier"];
  for (const f of flagsWithValues) {
    const i = args.indexOf(f);
    if (i >= 0) skipValues.add(i + 1);
  }
  const rest = args.filter((a, i) => !a.startsWith("-") && !skipValues.has(i));

  if (rest[0] === "mcps") return cmdDiscoverMcps({ limit, minScore, json, profile, install: args.includes("--install"), dryRun: args.includes("--dry-run") });

  if (rest[0] === "search") {
    const query = rest.slice(1).join(" ") || undefined;
    return cmdSearch(query, { limit, minScore, json, profile, filter, render, verbose, showTail });
  }

  if (rest[0] === "analyze") {
    return cmdAnalyze({ profile, minScore, limit });
  }

  if (rest[0] === "install") {
    const dryRun = args.includes("--dry-run");
    const all = args.includes("--all");
    const notify = args.includes("--notify");
    const digest = args.includes("--digest");
    const minQuality = intFlag(args, "--min-quality", 7)!;
    return cmdInstall({ profile, minScore, minQuality, dryRun, all, notify, digest });
  }

  if (rest[0] === "notify") {
    const dryRun = args.includes("--dry-run");
    const force = args.includes("--force");
    return cmdNotify(rest[1], { profile, dryRun, force });
  }

  if (rest[0] === "suggest-profiles") {
    const minSizeIdx = args.indexOf("--min-size");
    const minSize = minSizeIdx >= 0 ? parseInt(args[minSizeIdx + 1] ?? "3", 10) : 3;
    const outIdx = args.indexOf("--out");
    const outDir = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1]!
      : join(REPO_ROOT, ".cue-suggestions");
    const dryRun = args.includes("--dry-run");
    const noClaude = args.includes("--no-claude");
    const embeddings = args.includes("--embeddings");
    return cmdSuggestProfiles({ minSize, outDir, dryRun, noClaude, embeddings });
  }

  if (rest[0] === "list" || rest.length === 0) {
    if (!existsSync(cacheFile())) {
      return cmdSearch(undefined, { limit, minScore, json, profile, filter, render, verbose, showTail });
    }
    return cmdList({ json, limit, filter, render, verbose, showTail });
  }

  // Treat unknown args as search query
  return cmdSearch(rest.join(" "), { limit, minScore, json, profile, filter, render, verbose, showTail });
}
