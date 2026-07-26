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

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { findRealClaudeBin } from "./claude-binary";
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

/**
 * CLI args for the classifier spawn. The call must be LIGHTWEIGHT:
 *   - `--strict-mcp-config` — without it the spawned claude boots every MCP
 *     server in the user's config (a dozen npm/python daemons) just to answer
 *     one KEEP: line. Observed to blow the 30s budget and freeze launches on
 *     configs with many global servers.
 *   - a fast model — the account default may be a heavyweight reasoning model;
 *     skill classification is a trivial pick-list task. Override with
 *     CUE_SMART_SUBSET_MODEL if the alias isn't available on the account.
 * NOT `--bare`: it skips credential/settings loading and comes back
 * "Not logged in".
 */
export function classifierSpawnArgs(prompt: string): string[] {
  const model = process.env.CUE_SMART_SUBSET_MODEL?.trim() || "haiku";
  return ["--print", "--strict-mcp-config", "--model", model, "-p", prompt];
}

// ---------------------------------------------------------------------------
// Classifier isolation — an ephemeral CLAUDE_CONFIG_DIR for the spawn
// ---------------------------------------------------------------------------

interface ClassifierHome {
  /** The ephemeral config dir to point CLAUDE_CONFIG_DIR at. */
  home: string;
  /** The real `.credentials.json` we copied from, for the rotation copy-back. */
  credSrc: string | null;
}

/** OAuth token expiry (epoch ms) from a `.credentials.json`, or 0 if unreadable. */
function credExpiresAt(p: string): number {
  try {
    const v = (JSON.parse(readFileSync(p, "utf8")) as { claudeAiOauth?: { expiresAt?: unknown } })
      ?.claudeAiOauth?.expiresAt;
    return typeof v === "number" ? v : 0;
  } catch {
    return 0;
  }
}

/**
 * Whether to carry the classifier home's credentials back to the source: only
 * when the home token is strictly newer (higher expiresAt). Anthropic rotates
 * the refresh token on every refresh, so a stale copy must never clobber a live
 * source token. Pure so it can be unit-tested. Mirrors the launch.ts rescue guard.
 */
export function shouldCopyBackCreds(homeExpiresAt: number, srcExpiresAt: number): boolean {
  return homeExpiresAt > srcExpiresAt;
}

/**
 * Build an ephemeral CLAUDE_CONFIG_DIR for the classifier spawn so it does NOT
 * load the user's plugins (claude-mem spawns a worker daemon per call), fire
 * their hooks, or append phantom sessions to their logs. Copies the live OAuth
 * credentials from the launch's real config dir in so the call still auths.
 * Returns null when there's nothing to isolate (no CLAUDE_CONFIG_DIR set) — the
 * caller then inherits the parent env, the pre-isolation behavior.
 */
function setupClassifierHome(): ClassifierHome | null {
  const src = process.env.CLAUDE_CONFIG_DIR;
  if (!src) return null;
  try {
    const base = join(cacheDir(), "classifier-home");
    mkdirSync(base, { recursive: true });
    const home = mkdtempSync(join(base, "run-"));
    // Minimal config: no enabledPlugins, no hooks, no mcpServers.
    writeFileSync(join(home, "settings.json"), "{}\n");
    writeFileSync(join(home, ".claude.json"), `${JSON.stringify({ hasCompletedOnboarding: true })}\n`);
    const credSrcFile = join(src, ".credentials.json");
    let credSrc: string | null = null;
    if (existsSync(credSrcFile)) {
      copyFileSync(credSrcFile, join(home, ".credentials.json"));
      credSrc = credSrcFile;
    }
    return { home, credSrc };
  } catch {
    return null;
  }
}

/** Copy back a rotated token if newer, then remove the ephemeral home. Best-effort. */
function teardownClassifierHome(h: ClassifierHome): void {
  try {
    if (h.credSrc) {
      const homeCred = join(h.home, ".credentials.json");
      // The source may be a SHARED account `.credentials.json` (authmux parallel
      // accounts point CLAUDE_CONFIG_DIR there), read live by other sessions. So
      // this must be atomic: copy into a sibling tmp, re-check freshness (a
      // concurrent launch may have rotated the source since we forked), then
      // rename — a same-dir rename is atomic, so a reader never sees a torn file.
      // Mirrors credentials-sync.ts's writer.
      if (existsSync(homeCred) && shouldCopyBackCreds(credExpiresAt(homeCred), credExpiresAt(h.credSrc))) {
        const tmp = `${h.credSrc}.cue-classifier.${process.pid}.tmp`;
        try {
          copyFileSync(homeCred, tmp);
          // Re-check under the freshest source state before committing the swap.
          if (shouldCopyBackCreds(credExpiresAt(homeCred), credExpiresAt(h.credSrc))) {
            renameSync(tmp, h.credSrc);
          } else {
            rmSync(tmp, { force: true });
          }
        } catch {
          try { rmSync(tmp, { force: true }); } catch { /* best-effort */ }
        }
      }
    }
  } catch {
    /* best-effort */
  }
  try {
    rmSync(h.home, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

/**
 * Spawn `claude --print` ASYNC and resolve with its trimmed stdout. Never
 * rejects: on spawn error, non-zero exit, or timeout it resolves
 * `{ status: non-zero }` so the caller fail-opens. The timeout kills the child
 * (SIGTERM, then SIGKILL backstop) and resolves immediately so the Promise
 * always settles even if the child ignores the signal. `configDirOverride`,
 * when set, points the child at an ephemeral CLAUDE_CONFIG_DIR (see setupClassifierHome).
 */
function spawnClaude(bin: string, prompt: string, timeoutMs: number, configDirOverride?: string): Promise<{ status: number; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const finish = (status: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout });
    };

    const env: NodeJS.ProcessEnv = { ...process.env, CUE_BYPASS: "1" };
    if (configDirOverride) env.CLAUDE_CONFIG_DIR = configDirOverride;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, classifierSpawnArgs(prompt), {
        env,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      resolve({ status: 1, stdout: "" });
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      const killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }, 500);
      killTimer.unref?.();
      finish(124); // timed out → fail-open
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.on("error", () => finish(1));
    child.on("close", (code) => finish(code ?? 1));
  });
}

async function callClaudeAsync(prompt: string, timeoutMs: number): Promise<{ ok: boolean; output: string }> {
  const startedAt = Date.now();
  const home = setupClassifierHome();
  const configDir = home?.home;
  try {
    let res = await spawnClaude("claude", prompt, timeoutMs, configDir);
    if (res.status !== 0 || !res.stdout.trim()) {
      const fallback = findRealClaudeBin();
      // Share the budget: the fallback gets what's left of timeoutMs (min 2s), so a
      // double-timeout can't stack to ~2x the stated tolerance and freeze the launch.
      if (fallback) {
        const remaining = Math.max(2_000, timeoutMs - (Date.now() - startedAt));
        res = await spawnClaude(fallback, prompt, remaining, configDir);
      }
    }
    if (res.status !== 0 || !res.stdout.trim()) return { ok: false, output: "" };
    return { ok: true, output: res.stdout.trim() };
  } finally {
    if (home) teardownClassifierHome(home);
  }
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
  const { ok, output } = await callClaudeAsync(claudePrompt, timeoutMs);
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
