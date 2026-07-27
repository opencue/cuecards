/**
 * Smart skill subsetting: given a profile's skill list and a user prompt,
 * ask Claude which skills are plausibly relevant. The intent is to cut context
 * bloat in `cue launch` for sessions that only need 3-4 of N skills.
 *
 * Design rules:
 *   1. **Fail open.** Any error path returns the original list unchanged.
 *      Smart-subset is an optimization, not a gate. Never make `cue launch`
 *      slower than today on the failure path.
 *   2. **Async, single Claude call.** All skills + prompt in one --print
 *      invocation, spawned ASYNC (not spawnSync) so the launch loader's
 *      animation can tick while we wait (~2s round-trip on a cold miss).
 *   3. **Warm launches skip the call.** A 7-day on-disk cache keyed by the
 *      skill set + their descriptions + the prompt returns the prior keep-set
 *      instantly — zero LLM calls on a repeat launch in the same cwd.
 *   4. **Always keep "core" essentials.** A handful of skills (caveman,
 *      analyze, cue-usage) are operational primitives — never prune them
 *      even if the classifier doesn't pick them. Applied at read time so a
 *      change to the list never serves a stale subset.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The classifier spawn, its ephemeral config dir and the credential copy-back
// live in claude-classifier now — the profile matcher needs the same call, and
// this machinery is far too subtle to keep two copies of.
import {
  classifierSpawnArgs,
  credExpiresAt,
  runClassifier,
  setupClassifierHome,
  shouldCopyBackCreds,
  teardownClassifierHome,
} from "./claude-classifier";
import { cacheDir } from "./config-paths";
import { resolveLocalSkill } from "./resolver-local";
import { parseMetadataFromContent } from "../commands/optimizer";

// Skills that survive every subset filter. They're operational, not domain-
// specific, and pruning them changes how the agent behaves more than it
// changes what it can do. Shared with project-loadout, which applies the
// same "never defer the operational primitives" rule.
export const ALWAYS_KEEP = new Set([
  "meta/analyze",
  "meta/cue-usage",
  "meta/acpx",
  "caveman/caveman",
  "caveman/caveman-commit",
]);

// Re-exported so callers and tests that reached for these here keep working.
export { classifierSpawnArgs, shouldCopyBackCreds };

/** Bump when buildPrompt / the parse contract changes, to invalidate old cache. */
const CACHE_VERSION = 1;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CACHE_SWEEP_CAP = 200; // never scan/rm more than this many files per sweep

export interface SubsetResult {
  /** Skill IDs the classifier picked (plus ALWAYS_KEEP). Same ordering as input. */
  selected: string[];
  /** True if classification ran (or was served from cache); false if fell back. */
  classified: boolean;
  /** One-line reason — useful for the user-facing message. */
  reason: string;
}

interface SkillDescriptor {
  id: string;
  description: string;
}

async function loadSkillDescriptor(id: string): Promise<SkillDescriptor> {
  try {
    const dir = await resolveLocalSkill(id);
    const md = join(dir, "SKILL.md");
    if (!existsSync(md)) return { id, description: "" };
    const meta = parseMetadataFromContent(readFileSync(md, "utf8"));
    return { id, description: meta.description };
  } catch {
    return { id, description: "" };
  }
}

function buildPrompt(prompt: string, descriptors: SkillDescriptor[]): string {
  const lines = descriptors.map((d, i) => `${i + 1}. ${d.id}${d.description ? ` — ${d.description}` : ""}`);
  return `You are choosing which skills to load for a Claude Code session. Each skill is a chunk of system-prompt context; loading every skill costs tokens. Pick only the ones plausibly relevant to the user's first prompt.

User prompt:
${prompt}

Available skills:
${lines.join("\n")}

Respond in EXACTLY this format (no other text):
KEEP: <comma-separated skill IDs from the list above, or "none">
REASON: <one short sentence>

Rules:
- Pick 3-8 skills, never more than half the list.
- If the prompt is generic ("help", "what can you do"), respond KEEP: none.
- If unsure, KEEP fewer skills. The user can always load more by retrying.`;
}

function parseClaudeKeep(output: string, allSkillIds: string[]): string[] | null {
  const m = output.match(/KEEP:\s*(.+)/i);
  if (!m) return null;
  const raw = m[1]!.trim();
  if (/^none$/i.test(raw)) return [];
  const known = new Set(allSkillIds);

  // Accept BOTH forms the classifier actually produces: skill ids, and the
  // 1-based list positions from the numbered prompt. `buildPrompt` renders
  // "1. <id> — <desc>", which reliably invites "KEEP: 1, 3, 10" — observed
  // live. Rejecting that answer made the whole classification fail open to
  // "kept all skills", silently, which looks identical to the classifier
  // being unavailable.
  const picked: string[] = [];
  for (const token of raw.split(",")) {
    const t = token.trim();
    if (!t) continue;
    if (known.has(t)) {
      picked.push(t);
      continue;
    }
    if (/^\d+$/.test(t)) {
      const id = allSkillIds[Number(t) - 1];
      if (id !== undefined) picked.push(id);
    }
  }

  // Sanity check: if Claude returned nothing usable, signal a parse failure
  // rather than an empty selection.
  if (picked.length === 0) return null;
  return [...new Set(picked)];
}

// ---------------------------------------------------------------------------
// Keep-set cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  v: number;
  ts: number; // epoch ms at write
  /** Raw classifier picks (intersected with the skill set). May be empty ("none"). */
  picked: string[];
  /** Short reason text from the classifier. */
  why: string;
}

function subsetCacheDir(): string {
  return join(cacheDir(), "skill-subsets");
}

/**
 * Cache key = SHA1 over: cache version + sorted skill ids + each skill's
 * description + the normalized prompt. Including descriptions means editing a
 * SKILL.md's frontmatter invalidates the cached subset (the classifier's input
 * changed). Bumping CACHE_VERSION invalidates everything.
 */
function subsetCacheKey(skillIds: string[], prompt: string, descriptors: SkillDescriptor[]): string {
  const sortedIds = [...skillIds].sort();
  const descMap = new Map(descriptors.map(d => [d.id, d.description]));
  const descBlob = sortedIds.map(id => `${id}:${descMap.get(id) ?? ""}`).join("\n");
  const norm = prompt.trim().toLowerCase().replace(/\s+/g, " ");
  const h = createHash("sha1");
  h.update(`v${CACHE_VERSION}\x00`);
  h.update(`${sortedIds.join(",")}\x00`);
  h.update(`${descBlob}\x00`);
  h.update(norm);
  return h.digest("hex").slice(0, 24);
}

/** Read a cached entry. Returns null on miss, expiry, or any error (fail-open). */
function readSubsetCache(key: string): CacheEntry | null {
  try {
    const file = join(subsetCacheDir(), `${key}.json`);
    if (!existsSync(file)) return null;
    const entry = JSON.parse(readFileSync(file, "utf8")) as CacheEntry;
    if (entry.v !== CACHE_VERSION) return null;
    if (typeof entry.ts !== "number" || Date.now() - entry.ts >= CACHE_TTL_MS) return null;
    if (!Array.isArray(entry.picked)) return null;
    return entry;
  } catch {
    return null;
  }
}

/**
 * Write a cache entry atomically (.tmp in the SAME dir → rename, no cross-device
 * EXDEV). Best-effort: swallows all errors. Sweeps expired entries fire-and-forget.
 */
function writeSubsetCache(key: string, picked: string[], why: string): void {
  try {
    const dir = subsetCacheDir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${key}.json`);
    const tmp = join(dir, `${key}.json.tmp`);
    const entry: CacheEntry = { v: CACHE_VERSION, ts: Date.now(), picked, why };
    writeFileSync(tmp, JSON.stringify(entry));
    renameSync(tmp, file);
  } catch {
    /* cache write is best-effort */
  }
  // Fire-and-forget sweep of expired entries — never on the critical path.
  setImmediate(() => sweepExpiredCache());
}

function sweepExpiredCache(): void {
  try {
    const dir = subsetCacheDir();
    const files = readdirSync(dir).filter(f => f.endsWith(".json")).slice(0, CACHE_SWEEP_CAP);
    for (const f of files) {
      try {
        const entry = JSON.parse(readFileSync(join(dir, f), "utf8")) as CacheEntry;
        if (typeof entry.ts !== "number" || Date.now() - entry.ts >= CACHE_TTL_MS || entry.v !== CACHE_VERSION) {
          rmSync(join(dir, f), { force: true });
        }
      } catch {
        rmSync(join(dir, f), { force: true }); // corrupt → drop
      }
    }
  } catch {
    /* sweep is best-effort */
  }
}

/**
 * Turn a raw classifier pick-list into a final SubsetResult, applying
 * ALWAYS_KEEP and the minKeep floor. Returns null when the result would keep
 * fewer than `minKeep` skills (caller falls back to the full list).
 */
function finalizeSelection(
  picked: string[],
  skillIds: string[],
  minKeep: number,
  why: string,
): SubsetResult | null {
  const keepSet = new Set(picked.filter(id => skillIds.includes(id)));
  for (const id of skillIds) if (ALWAYS_KEEP.has(id)) keepSet.add(id);
  if (keepSet.size < minKeep) return null;
  const selected = skillIds.filter(id => keepSet.has(id));
  return {
    selected,
    classified: true,
    reason: `${selected.length}/${skillIds.length} skills kept — ${why}`,
  };
}

/**
 * Returns the subset of `skillIds` relevant to `prompt`. ALWAYS_KEEP skills
 * are always included. If anything goes wrong (no claude binary, timeout,
 * unparseable response), returns the original list unchanged with classified=false.
 *
 * A successful classification is cached for 7 days keyed by the skill set +
 * their descriptions + the prompt; a warm launch returns instantly with no LLM
 * call. Pass `noCache: true` (explicit `--subset`) to bypass the cache.
 */
export async function selectRelevantSkills(
  skillIds: string[],
  prompt: string,
  opts: { timeoutMs?: number; minKeep?: number; noCache?: boolean } = {},
): Promise<SubsetResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const minKeep = opts.minKeep ?? 3;
  const trimmed = prompt.trim();

  if (!trimmed) {
    return { selected: skillIds, classified: false, reason: "empty prompt — kept all skills" };
  }
  // Very short prompts don't have enough signal to classify well.
  if (trimmed.length < 8) {
    return { selected: skillIds, classified: false, reason: `prompt too short (${trimmed.length} chars) — kept all skills` };
  }
  if (skillIds.length <= 4) {
    return { selected: skillIds, classified: false, reason: `only ${skillIds.length} skills — nothing to subset` };
  }

  const descriptors = await Promise.all(skillIds.map(loadSkillDescriptor));

  // Warm path: a prior identical (skills + descriptions + prompt) classification.
  const cacheKey = opts.noCache ? null : subsetCacheKey(skillIds, trimmed, descriptors);
  if (cacheKey) {
    const cached = readSubsetCache(cacheKey);
    if (cached) {
      const hit = finalizeSelection(cached.picked, skillIds, minKeep, `${cached.why} (cached)`);
      if (hit) return hit;
      return { selected: skillIds, classified: false, reason: "cached classifier picked < minKeep — kept all" };
    }
  }

  const claudePrompt = buildPrompt(trimmed, descriptors);
  const { ok, output } = await runClassifier(claudePrompt, timeoutMs);
  if (!ok) {
    return { selected: skillIds, classified: false, reason: "claude --print unavailable — kept all skills" };
  }

  const picked = parseClaudeKeep(output, skillIds);
  if (picked === null) {
    return { selected: skillIds, classified: false, reason: "could not parse classifier output — kept all skills" };
  }

  const reasonMatch = output.match(/REASON:\s*(.+)/i);
  const why = reasonMatch?.[1]?.trim().slice(0, 100) ?? "relevance ranking";

  // Cache the raw classifier picks (ALWAYS_KEEP is applied at read time).
  if (cacheKey) writeSubsetCache(cacheKey, picked, why);

  const result = finalizeSelection(picked, skillIds, minKeep, why);
  if (result) return result;
  return { selected: skillIds, classified: false, reason: `classifier picked < ${minKeep} skills — kept all` };
}

// Exported for tests.
export const __test = {
  parseClaudeKeep,
  buildPrompt,
  ALWAYS_KEEP,
  subsetCacheKey,
  subsetCacheDir,
  readSubsetCache,
  writeSubsetCache,
  finalizeSelection,
  CACHE_VERSION,
  CACHE_TTL_MS,
  setupClassifierHome,
  teardownClassifierHome,
  credExpiresAt,
};
