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

import { spawnSync, execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(_execFile);
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { listProfiles } from "../lib/profile-loader";
import { addMcpToProfileSync } from "../lib/discover-market-profile-yaml";
import { clusterByKeywords, clusterByEmbeddings, unclustered, type Cluster, type ClusterItem } from "../lib/cluster-skills";
import { findRealClaudeBin } from "../lib/claude-binary";
import { fetchCompanionFiles, detectSkillPath } from "../lib/companion-fetch";
import { gateFreshSkill } from "./security";
import { unavailableNote, formatVerdict } from "../lib/skillspector";
import { repoRoot } from "../lib/repo-root";
import {
  PROFILE_KEYWORDS as _PROFILE_KEYWORDS,
  STACK_PROFILES as _STACK_PROFILES,
} from "../lib/stack-profiles";
import {
  ANSI,
  colorize as wrap,
  colorStars,
  freshnessColor,
  freshnessLabel,
  tierColorFor,
  tierName,
  wrapText,
} from "../lib/discover-format";

export { colorStars, freshnessColor, freshnessLabel, tierColorFor, tierName, wrapText } from "../lib/discover-format";
import { cmdDiscoverMcps } from "./discover-mcps";
export { cmdDiscoverMcps };
import { cmdExport } from "./discover-site";
export { cmdExport };
import { buildGemHeroBadges, cmdNotify, loadNotifyLog, notifyOwner, postDailyDigest } from "./discover-notify";
export { buildGemHeroBadges };

// Cache path resolved lazily so tests can redirect via XDG_CONFIG_HOME without
// re-importing the module. (Bun shares module state across test files; const
// values captured at import time wouldn't see runtime env changes.)
// Note: uses XDG_CONFIG_HOME (not XDG_CACHE_HOME) for historical reasons;
// the existing tests set XDG_CONFIG_HOME to redirect the cache path.
function discoverCacheDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg && xdg.length > 0 ? xdg : join(homedir(), ".config"), "cue", "discover");
}
/**
 * Exported so tests seeding a fake gems cache (e.g. to prove a caller skips
 * gem discovery even when a qualifying gem exists) derive the SAME path this
 * module reads, instead of hand-deriving a parallel path string that can
 * silently drift out of sync with this one.
 */
export function cacheFile(): string { return join(discoverCacheDir(), "gems.json"); }
const DEFAULT_EXPORT = join(repoRoot(), "docs", "discovered.md");

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

export interface GemCache {
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
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      process.stderr.write(`warn: discover cache parse error: ${e}\n`);
    }
    return [];
  }
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

/** Strip marketing-slop openers from a description so the real feature shows first. */
export function stripSlopOpener(desc: string): string {
  let s = desc.trim();
  for (const re of SLOP_OPENERS) s = s.replace(re, "").trim();
  s = s.replace(/^[—:·\-,]\s*/, "").trim();           // dangling punctuation after strip
  s = s.replace(/^\d{4}\s*(:|—|-)\s*/, "").trim();    // "2026 - actual feature" → "actual feature"
  s = s.replace(/^Best\s+(?:AI\s+)?[A-Z][a-z]+\s+\d{4}:?\s*/i, "").trim();  // "Best AI Code Architect 2026:"
  return s;
}

/**
 * Scan all profile.yaml files for a skill ref matching the gem's name or
 * `owner/name` slug. Returns the list of profiles that already include it.
 * Cheap enough to call per-gem (cached once per session via the closure pattern
 * in renderers).
 */
export function getInstalledIn(gem: GemRepo, profilesDir = join(repoRoot(), "profiles")): string[] {
  if (!existsSync(profilesDir)) return [];
  const hits: string[] = [];
  const slugs = [gem.name.toLowerCase(), gem.full_name.toLowerCase()];
  try {
    const profiles = readdirSync(profilesDir);
    for (const p of profiles) {
      if (p.startsWith("_") || p.startsWith(".")) continue;
      const yaml = join(profilesDir, p, "profile.yaml");
      if (!existsSync(yaml)) continue;
      const content = readFileSync(yaml, "utf8").toLowerCase();
      if (slugs.some(s => content.includes(s))) hits.push(p);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      process.stderr.write(`warn: getInstalledIn profiles scan error: ${e}\n`);
    }
  }
  return hits;
}

/** Detect active profile from cwd (`.cue.profile` file). Returns undefined if none. */
export function getActiveProfile(cwd: string = process.cwd()): string | undefined {
  const f = join(cwd, ".cue.profile");
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
    if (f.tier && !f.tier.has(tierName(g.gem_score))) return false;
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

// Re-exported from lib/stack-profiles for backward compat; import from there directly.
export const PROFILE_KEYWORDS: Record<string, string[]> = _PROFILE_KEYWORDS;

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

// Re-exported from lib/stack-profiles for backward compat; import from there directly.
export const STACK_PROFILES: ReadonlySet<string> = _STACK_PROFILES;

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
    if (profile === "python" && lang === "python") hits += 2;
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

/** Shape of a single item returned by the GitHub search/repositories API. */
export interface GitHubRepoItem {
  full_name: string;
  owner: { login: string } | null;
  name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  created_at: string;
  pushed_at: string;
  topics: string[];
  language: string | null;
  html_url: string;
}

export async function ghSearch(query: string, limit: number): Promise<GitHubRepoItem[]> {
  const q = query.replace("{RECENT}", recentDate());
  const args = [
    "api", "search/repositories",
    "--method", "GET",
    "-f", `q=${q}`,
    "-f", `per_page=${Math.min(limit, 30)}`,
    "-f", "sort=updated",
    "--jq", ".items",
  ];
  try {
    const { stdout } = await execFile("gh", args, { timeout: 30000 });
    return (JSON.parse(stdout) as unknown[]).filter((x): x is GitHubRepoItem => x != null && typeof x === "object");
  } catch { return []; }
}

/**
 * Run search queries in bounded parallel batches, deduplicating by full_name.
 * Stops launching new batches once `limit` unique items have been collected,
 * keeping GitHub search API usage within the 30 req/min rate limit.
 *
 * Exported for tests — pass a mock `searchFn` to avoid real network calls.
 */
export async function runQueryBatches(
  queries: Array<{ q: string; label: string }>,
  limit: number,
  searchFn: (q: string, limit: number) => Promise<GitHubRepoItem[]>,
  batchSize = 4,
): Promise<GitHubRepoItem[]> {
  const seen = new Set<string>();
  const results: GitHubRepoItem[] = [];

  for (let i = 0; i < queries.length; i += batchSize) {
    if (results.length >= limit) break;
    const batch = queries.slice(i, i + batchSize);
    const batchItems = (await Promise.all(
      batch.map(({ q }) => searchFn(q, limit)),
    )).flat();

    for (const item of batchItems) {
      if (results.length >= limit) break;
      if (seen.has(item.full_name)) continue;
      seen.add(item.full_name);
      results.push(item);
    }
  }
  return results;
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
    "python": ["python fastapi skill", "django api", "flask sqlalchemy", "pytest automation"],
    rust: ["rust cargo skill", "rust cli tool", "tokio async", "rust wasm"],
    "go-api": ["golang api skill", "go gin echo", "golang microservice"],
    cybersecurity: ["security audit skill", "pentest tool", "vulnerability scanner", "red team blue team", "threat detection"],
    "creative-media": ["image generation skill", "video editing ai", "design asset brand", "figma automation"],
    "docs-writer": ["documentation generator", "markdown writing skill", "knowledge base wiki", "technical writing"],
    research: ["research paper skill", "literature review", "citation manager", "academic notebook", "arxiv"],
    threejs: ["three.js skill", "webgl shader", "3d scene interactive"],
    video: ["video processing skill", "ffmpeg automation", "transcription subtitle", "youtube tool"],
    marketing: ["seo optimization skill", "marketing automation", "copywriting ai", "conversion funnel", "growth hacking"],
    "medusa-dev": ["medusa ecommerce", "storefront skill", "shopping cart", "product catalog", "amazon seller"],
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

  const gems: GemRepo[] = [];

  let queries: { q: string; label: string }[];

  if (query) {
    queries = [{ q: `${query} pushed:>${recentDate()}`, label: `"${query}"` }];
  } else if (opts.profile) {
    queries = buildProfileQueries(opts.profile);
  } else {
    queries = SEARCH_QUERIES;
  }

  const labeledQueries = queries.slice(0, opts.limit > 0 ? queries.length : 0);
  if (labeledQueries.length > 0) {
    process.stderr.write(`  ⏳ Running up to ${labeledQueries.length} search quer${labeledQueries.length === 1 ? "y" : "ies"} in parallel batches...\n`);
  }
  const allItems = await runQueryBatches(labeledQueries, opts.limit, ghSearch);

  for (const item of allItems) {
    if (gems.length >= opts.limit) break;

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

  // Sort by score descending
  gems.sort((a, b) => b.gem_score - a.gem_score);

  // Cache results (BEFORE filtering — cache is the raw scan, filters are display-time)
  mkdirSync(discoverCacheDir(), { recursive: true });
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

    // Fetch README and SKILL.md in parallel — both are independent GitHub API calls.
    const [readmeOut, skillOut] = await Promise.all([
      execFile("gh", ["api", `repos/${gem.full_name}/readme`, "--jq", ".content"], { timeout: 15000 })
        .then(r => r.stdout)
        .catch(() => ""),
      gem.has_skill_md
        ? execFile("gh", ["api", `repos/${gem.full_name}/contents/SKILL.md`, "--jq", ".content"], { timeout: 10000 })
            .then(r => r.stdout)
            .catch(() => "")
        : Promise.resolve(""),
    ]);

    const readme = readmeOut.trim()
      ? Buffer.from(readmeOut.trim(), "base64").toString("utf8").slice(0, 3000)
      : "";
    const skillMd = skillOut.trim()
      ? Buffer.from(skillOut.trim(), "base64").toString("utf8").slice(0, 2000)
      : "";

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

    let output = "";
    try {
      const claudeOut = await execFile("claude", ["--print", "-p", prompt], {
        timeout: 30000,
        env: { ...process.env, CUE_BYPASS: "1" },
      });
      output = claudeOut.stdout.trim();
    } catch {
      // Fallback: use the real claude binary directly (cue's PATH shim recurses)
      const realClaude = findRealClaudeBin();
      if (realClaude) {
        try {
          const fallbackOut = await execFile(realClaude, ["--print", "-p", prompt], { timeout: 30000 });
          output = fallbackOut.stdout.trim();
        } catch { /* fall through */ }
      }
    }

    if (!output) {
      process.stdout.write(`     ⚠️  Claude analysis failed, keeping keyword suggestion\n`);
      continue;
    }
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
// Auto-install CLI dependencies from skill's SKILL.md
// ---------------------------------------------------------------------------

/**
 * Surface (and optionally install) the CLI prerequisites a skill declares in
 * its `## Prerequisites` block.
 *
 * SECURITY: the prerequisite lines come from a SKILL.md that was just fetched
 * from an arbitrary GitHub repo, so the commands are untrusted input. We never
 * run a package installer parsed out of them unless the caller explicitly opts
 * in with `{ yes: true }` (wired to the `--yes` flag). Without it we only print
 * the prerequisites as warnings and let the user install them deliberately —
 * otherwise a typosquatted skill repo with one crafted `## Prerequisites` line
 * could trigger arbitrary global package installs (npm/brew/cargo/pipx).
 */
export function autoInstallClis(skillName: string, opts: { yes?: boolean } = {}): void {
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

  // Consent gate: never auto-run installers parsed from an untrusted SKILL.md.
  // Default is warn-only; the caller must pass `{ yes: true }` (via `--yes`) to
  // actually install. Keeps `cue discover install` and the interactive wizard
  // from silently mutating the global toolchain.
  if (!opts.yes) {
    process.stdout.write(`     ⚠️  ${skillName} declares CLI prerequisites (not auto-installed):\n`);
    for (const { label } of installCmds) {
      process.stdout.write(`          ${label}\n`);
    }
    process.stdout.write(`     Review them, then install manually or re-run with --yes to auto-install.\n`);
    return;
  }

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

async function cmdInstall(opts: { profile?: string; minScore: number; minQuality: number; dryRun: boolean; all: boolean; notify: boolean; digest: boolean; yes: boolean; allowUnsafe: boolean }): Promise<number> {
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

    // Security gate: the skill files are now on disk but not yet registered to
    // a profile. Scan the just-fetched (untrusted) skill with NVIDIA
    // SkillSpector plus cue's own rules, and block on a DO_NOT_INSTALL verdict
    // or critical findings (secret/data exfiltration, prompt injection) unless
    // --allow-unsafe.
    const gate = gateFreshSkill(gem.name, { allowUnsafe: opts.allowUnsafe });
    const ssNote = unavailableNote(gate.skillspector);
    if (ssNote) process.stdout.write(`     ${ssNote}\n`);
    if (gate.ok && gate.skillspector.recommendation === "CAUTION") {
      process.stdout.write(`     🟡 ${formatVerdict(gate.skillspector)} — registered, review it.\n`);
    }
    if (!gate.ok) {
      process.stdout.write(`     🔴 BLOCKED: ${gem.full_name} has ${gate.critical.length} critical security finding(s):\n`);
      for (const c of gate.critical) {
        process.stdout.write(`        [${c.code}] ${c.message}${c.line ? ` (line ${c.line})` : ""}\n`);
      }
      process.stdout.write(`        Left on disk at ~/.claude/skills/${gem.name} but NOT registered to a profile.\n`);
      process.stdout.write(`        Review it, then re-run with --allow-unsafe to register anyway.\n`);
      skipped++;
      continue;
    }
    if (!gate.scanned) {
      process.stdout.write(`     ⚠️  ${gem.full_name}: no SKILL.md found at ~/.claude/skills/${gem.name} to scan — review manually.\n`);
    }

    // Surface CLI dependencies from the skill's SKILL.md Prerequisites.
    // Only auto-installs when the user passed --yes (see autoInstallClis).
    autoInstallClis(gem.name, { yes: opts.yes });

    // Add to profile.yaml
    const profileYaml = join(repoRoot(), "profiles", targetProfile, "profile.yaml");
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
        const added: string[] = [];
        for (const m of gem.suggested_mcps) {
          if (addMcpToProfileSync(profileYaml, m)) added.push(m);
        }
        if (added.length) {
          process.stdout.write(`     ✅ Added MCPs: ${added.join(", ")}\n`);
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

  // Daily digest discussion in opencue/cuecards — covers everything we just touched,
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
  if (tier) f.tier = new Set(tier.split(",").map(t => t.trim() as "premium" | "strong" | "worth" | "tail"));
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
  --yes, -y                 Auto-install CLI prerequisites from a skill's SKILL.md
  --allow-unsafe            Register a skill even if the security scan finds a
                            critical issue (default: block + leave it unregistered)
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
    const yes = args.includes("--yes") || args.includes("-y");
    const allowUnsafe = args.includes("--allow-unsafe");
    const minQuality = intFlag(args, "--min-quality", 7)!;
    return cmdInstall({ profile, minScore, minQuality, dryRun, all, notify, digest, yes, allowUnsafe });
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
      : join(repoRoot(), ".cue-suggestions");
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
