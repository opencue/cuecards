/**
 * LLM reranking for the profile matcher.
 *
 * The lexical matcher in `profile-match` scores term overlap. That works, but
 * every failure it has is the same shape: a word means one thing in a manifest
 * and another in a profile description, and the fix is another stopword. The
 * list of such words is unbounded — `CLAUDE.md`, `@clack/core`, `requires-python`,
 * `base-template` each cost a round of tuning.
 *
 * A model reads the same evidence and simply doesn't make that class of
 * mistake, because it knows `requires-python` is a metadata key and `robot.urdf`
 * is a robot. So this tier reranks: lexical proposes, the model judges.
 *
 * **Why this fits here when it didn't fit the skill matcher.** The skill hook
 * runs on every prompt, and the prompt is different every time — an LLM call
 * there is a per-message tax with a near-zero cache hit rate, which is why it
 * ended up as an opt-in `--deep` escalation. A repo's shape is stable for
 * weeks. Keyed on the evidence rather than the clock, the cache hits ~always,
 * and the model is consulted roughly once per project.
 *
 * The launch path is still never allowed to wait for it. See
 * `warmDeepMatchCache`: a cold miss serves the lexical answer immediately and
 * populates the cache in the background for next time.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runClassifier } from "./claude-classifier";
import { cacheDir } from "./config-paths";
import type { ProfileDoc, ProfileMatch, RepoEvidence } from "./profile-match";

/** Bump when the prompt or parse contract changes, to invalidate old entries. */
const CACHE_VERSION = 1;

/**
 * Repo shape changes on the scale of weeks, and the evidence hash already
 * invalidates on any real change, so this only bounds unbounded growth of
 * entries for directories that no longer exist.
 */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Never scan or remove more than this many files in one sweep. */
const CACHE_SWEEP_CAP = 200;

/** Model picks to ask for. More than this and the card stops reading as an answer. */
const MAX_PICKS = 6;

/** Evidence terms shown to the model, strongest first. */
const MAX_EVIDENCE_LINES = 24;

export interface DeepMatchInput {
  evidence: RepoEvidence;
  docs: ProfileDoc[];
  /** What the lexical pass produced, shown to the model as a starting point. */
  lexical: ProfileMatch[];
  timeoutMs?: number;
  /** Skip the cache read (the write still happens). */
  noCache?: boolean;
}

export interface DeepMatchResult {
  matches: ProfileMatch[];
  /** True when the model actually ran or a cached model answer was used. */
  classified: boolean;
  /** Why it fell back, when it did — surfaced by `cue profile match --deep`. */
  reason: string;
  /** True when served from disk rather than a fresh call. */
  cached: boolean;
}

/** Disabled entirely by env, mirroring the other LLM paths' opt-outs. */
export function deepMatchDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.CUE_PROFILE_MATCH_DEEP?.trim().toLowerCase();
  return v === "0" || v === "off" || v === "false";
}

function deepCacheDir(): string {
  return join(cacheDir(), "profile-match");
}

/**
 * Cache key: the evidence and the profile library, NOT the path.
 *
 * Keying on cwd would miss the common case — two checkouts of the same project,
 * or a repo that moved — and would gain nothing, since identical evidence
 * deserves an identical answer.
 */
export function deepCacheKey(evidence: RepoEvidence, docs: ProfileDoc[]): string {
  const h = createHash("sha256");
  h.update(`v${CACHE_VERSION}\n`);
  for (const [term, weight] of [...evidence.terms.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    h.update(`${term}=${weight}\n`);
  }
  h.update("--profiles--\n");
  for (const d of [...docs].sort((a, b) => a.name.localeCompare(b.name))) {
    h.update(`${d.name}:${d.description}\n`);
  }
  return h.digest("hex").slice(0, 32);
}

interface CacheEntry {
  v: number;
  ts: number;
  picks: Array<{ name: string; reason: string }>;
}

function readCache(key: string): CacheEntry | null {
  try {
    const file = join(deepCacheDir(), `${key}.json`);
    if (!existsSync(file)) return null;
    const entry = JSON.parse(readFileSync(file, "utf8")) as CacheEntry;
    if (entry.v !== CACHE_VERSION) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
    if (!Array.isArray(entry.picks)) return null;
    return entry;
  } catch {
    return null;
  }
}

function writeCache(key: string, picks: Array<{ name: string; reason: string }>): void {
  try {
    const dir = deepCacheDir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${key}.json`);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ v: CACHE_VERSION, ts: Date.now(), picks } satisfies CacheEntry));
    renameSync(tmp, file);
    sweepExpired();
  } catch {
    /* a cache we can't write is a cache we do without */
  }
}

/** Drop expired entries. Bounded so a large cache can't stall a launch. */
function sweepExpired(): void {
  try {
    const dir = deepCacheDir();
    const now = Date.now();
    for (const name of readdirSync(dir).slice(0, CACHE_SWEEP_CAP)) {
      if (!name.endsWith(".json")) continue;
      const file = join(dir, name);
      try {
        if (now - statSync(file).mtimeMs > CACHE_TTL_MS) rmSync(file, { force: true });
      } catch {
        /* skip */
      }
    }
  } catch {
    /* skip */
  }
}

/**
 * Describe the directory to the model in its own terms.
 *
 * Deliberately the evidence, not a file listing: the evidence is what the
 * lexical pass saw, so when the model disagrees, the disagreement is about
 * judgement rather than about two different views of the repo.
 */
export function buildMatchPrompt(evidence: RepoEvidence, docs: ProfileDoc[], lexical: ProfileMatch[]): string {
  const bySource = new Map<string, string[]>();
  for (const [term] of evidence.terms) {
    const src = evidence.sources.get(term) ?? "entry";
    const reason = evidence.reasons.get(term) ?? "";
    const list = bySource.get(src) ?? [];
    list.push(reason ? `${term} (${reason})` : term);
    bySource.set(src, list);
  }

  const evidenceLines: string[] = [];
  for (const src of ["dependency", "language", "marker", "entry"]) {
    const list = bySource.get(src);
    if (!list?.length) continue;
    evidenceLines.push(`${src}: ${list.slice(0, MAX_EVIDENCE_LINES).join(", ")}`);
  }

  const profileLines = [...docs]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => `- ${d.name}: ${d.description || "(no description)"}`);

  const lexicalLine = lexical.length
    ? lexical.slice(0, 5).map((m) => `${m.name} (${m.strength.toFixed(2)})`).join(", ")
    : "(none)";

  return `You are choosing which cue profiles fit a software project. A profile bundles skills and MCP servers for a kind of work.

What the project directory contains:
${evidenceLines.join("\n") || "(no strong signals)"}

A keyword matcher ranked these, which may be wrong: ${lexicalLine}

Available profiles:
${profileLines.join("\n")}

Pick the profiles a developer opening THIS project would actually want. Respond in EXACTLY this format, one line per pick, best first, no other text:
PICK: <profile name> | <max 8 words on why>

Rules:
- At most ${MAX_PICKS} picks. Fewer is better than padding.
- Only names from the list above, exactly as written.
- Judge by what the project IS. Ignore agent config files (CLAUDE.md, AGENTS.md) and manifest metadata keys — every project has those.
- Do NOT pick a profile just because a word coincidentally matched.
- If nothing genuinely fits, respond with the single line: PICK: none`;
}

/** Parse `PICK: <name> | <reason>` lines, keeping only known profile names. */
export function parsePicks(output: string, known: Set<string>): Array<{ name: string; reason: string }> | null {
  const lines = output.split("\n").map((l) => l.trim()).filter((l) => /^PICK:/i.test(l));
  if (lines.length === 0) return null;

  if (lines.length === 1 && /^PICK:\s*none\s*$/i.test(lines[0]!)) return [];

  const picks: Array<{ name: string; reason: string }> = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const body = line.replace(/^PICK:\s*/i, "");
    const [rawName, ...rest] = body.split("|");
    const name = (rawName ?? "").trim();
    if (!name || !known.has(name) || seen.has(name)) continue;
    seen.add(name);
    picks.push({ name, reason: rest.join("|").trim() || "model pick" });
  }
  // Every name unknown means the model answered about something else — signal a
  // parse failure so the caller keeps the lexical ranking rather than emptying it.
  return picks.length > 0 ? picks : null;
}

/**
 * Turn model picks into `ProfileMatch`es.
 *
 * Strength descends across the ranking rather than being invented per item: the
 * model gives an order, not a calibrated score, and dressing its output in
 * false precision would make it look more certain than it is. A lexical score
 * is reused when the model and the matcher agree on a profile.
 */
function picksToMatches(picks: Array<{ name: string; reason: string }>, lexical: ProfileMatch[]): ProfileMatch[] {
  const byName = new Map(lexical.map((m) => [m.name, m]));
  const n = Math.max(picks.length, 1);
  return picks.map((p, i) => {
    const prior = byName.get(p.name);
    const strength = 1 - (i / n) * 0.6; // 1.0 → 0.4 across the ranking
    return {
      name: p.name,
      strength,
      score: prior?.score ?? strength * 10,
      matchedTerms: prior?.matchedTerms ?? [],
      reason: p.reason,
    };
  });
}

/**
 * Rerank profiles with the model. Never throws; falls back to `lexical`.
 */
export async function deepMatchProfiles(input: DeepMatchInput): Promise<DeepMatchResult> {
  const fallback = (reason: string): DeepMatchResult => ({
    matches: input.lexical,
    classified: false,
    reason,
    cached: false,
  });

  if (deepMatchDisabled()) return fallback("deep matching disabled by CUE_PROFILE_MATCH_DEEP");
  if (input.docs.length === 0) return fallback("no profiles to choose from");
  if (input.evidence.terms.size === 0) return fallback("directory offers no evidence to judge");

  const known = new Set(input.docs.map((d) => d.name));
  const key = deepCacheKey(input.evidence, input.docs);

  if (!input.noCache) {
    const hit = readCache(key);
    if (hit) {
      const picks = hit.picks.filter((p) => known.has(p.name));
      return {
        matches: picks.length > 0 ? picksToMatches(picks, input.lexical) : input.lexical,
        classified: true,
        reason: picks.length > 0 ? `${picks.length} profiles picked by the model` : "model found nothing that fits",
        cached: true,
      };
    }
  }

  const prompt = buildMatchPrompt(input.evidence, input.docs, input.lexical);
  const { ok, output } = await runClassifier(prompt, input.timeoutMs ?? 30_000);
  if (!ok) return fallback("claude --print unavailable");

  const picks = parsePicks(output, known);
  if (picks === null) return fallback("could not parse the model's answer");

  writeCache(key, picks);
  if (picks.length === 0) {
    return { matches: [], classified: true, reason: "model found nothing that fits", cached: false };
  }
  return {
    matches: picksToMatches(picks, input.lexical),
    classified: true,
    reason: `${picks.length} profiles picked by the model`,
    cached: false,
  };
}

/** True when a cached model answer exists for this evidence. */
export function hasWarmDeepMatch(evidence: RepoEvidence, docs: ProfileDoc[]): boolean {
  if (deepMatchDisabled()) return false;
  return readCache(deepCacheKey(evidence, docs)) !== null;
}

/**
 * Populate the cache in the background, then return immediately.
 *
 * This is what keeps the launch path honest. `cue launch` must never be slower
 * than it is today because a model call is available, so a cold miss shows the
 * lexical answer now and the model's answer arrives for the NEXT launch in this
 * directory. Detached and fully ignored: nothing here can block, print, or fail
 * the parent.
 */
export function warmDeepMatchCache(cwd: string): void {
  if (deepMatchDisabled()) return;
  // The child re-enters this code path; without the guard it would spawn its
  // own warm-up, and so on.
  if (process.env.CUE_PROFILE_MATCH_WARM === "0") return;
  const entry = resolveCueEntry();
  if (!entry) return;
  try {
    const child = spawn(entry.cmd, [...entry.args, "profile", "match", cwd, "--deep", "--json"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, CUE_PROFILE_MATCH_WARM: "0" },
    });
    child.unref();
  } catch {
    /* a warm-up we can't start is a warm-up we do without */
  }
}

/**
 * How to invoke cue again as a child.
 *
 * `process.argv[1]` is NOT it: that is whatever script the current process was
 * started with, which is only cue's entry point when cue was invoked directly.
 * Called from a library it points at the caller, and the "warm-up" silently
 * re-runs that instead — a no-op that leaves the cache permanently cold and
 * looks like the model simply never being consulted.
 *
 * So: the packaged bin next to this source, else cue on PATH, else nothing.
 */
function resolveCueEntry(): { cmd: string; args: string[] } | null {
  if (process.env.CUE_BIN && existsSync(process.env.CUE_BIN)) {
    return { cmd: process.env.CUE_BIN, args: [] };
  }

  // Source first, packaged launcher second. `bin/cue.mjs` runs the prebuilt
  // `dist/cue.js`, which in a working checkout is whatever was last built — it
  // silently ran a cue with no `profile match` subcommand, so the warm-up
  // "succeeded" every time and never wrote a cache entry. In a published
  // package there is no `src/`, and the bundle there is current by construction.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const candidate of [
      join(here, "..", "index.ts"),
      join(here, "..", "..", "bin", "cue.mjs"),
    ]) {
      if (existsSync(candidate)) return { cmd: process.execPath, args: [candidate] };
    }
  } catch {
    /* fall through to PATH */
  }

  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, "cue");
    try {
      if (existsSync(p)) return { cmd: p, args: [] };
    } catch {
      /* skip */
    }
  }
  return null;
}
