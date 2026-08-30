/** Best-effort AI profile advice for the interactive launch picker. */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { DetectionResultV2 } from "./auto-detect";
import { cacheDir } from "./config-paths";
import {
  repoEvidence as collectRepoEvidence,
  type EvidenceSource,
} from "./profile-match";

export const ADVISOR_CACHE_VERSION = 3;
export const ADVISOR_TIMEOUT_MS = 12_000;
export const ADVISOR_REFRESH_LOCK_TTL_MS = 30_000;

export interface ProfileAdvice {
  suggestions: DetectionResultV2[];
  summary: string;
}

export interface CachedProfileAdvice {
  advice: ProfileAdvice;
  freshness: "fresh" | "stale";
}

export type AdvisorRunner = (
  agent: "claude" | "codex",
  prompt: string,
) => string | null | Promise<string | null>;

export interface ProfileAdvisorOptions {
  cwd: string;
  knownProfiles: string[];
  currentProfile?: string;
  preferredAgent?: "claude" | "codex";
  cacheRoot?: string;
  runner?: AdvisorRunner;
}

/** One stable cache file per repository so changed evidence can reuse stale advice. */
export function advisorCacheKey(cwd: string): string {
  return createHash("sha256").update(resolve(cwd)).digest("hex");
}

/**
 * Render only bounded, typed repository signals for the advisor.
 *
 * Agent instruction files and README prose are deliberately excluded: they
 * describe how an agent should behave, not the repository's primary stack,
 * and previously made the model echo the active profile back as a suggestion.
 */
export function buildAdvisorEvidence(cwd: string): string {
  const evidence = collectRepoEvidence(cwd);
  const sourceRank: Record<EvidenceSource, number> = {
    dependency: 0,
    environment: 1,
    marker: 2,
    language: 3,
    entry: 4,
  };
  const rows = [...evidence.terms]
    .map(([term, weight]) => ({
      term,
      weight,
      source: evidence.sources.get(term) ?? "entry",
      reason: evidence.reasons.get(term) ?? term,
    }))
    .sort(
      (a, b) =>
        sourceRank[a.source] - sourceRank[b.source] ||
        b.weight - a.weight ||
        a.term.localeCompare(b.term),
    )
    .slice(0, 120)
    .map(
      ({ term, source, reason }) =>
        `- ${source}: ${term}${reason === term ? "" : ` — ${reason}`}`,
    );
  return `repository: ${basename(resolve(cwd))}\nstructured signals:\n${rows.join("\n")}`.slice(
    0,
    16_000,
  );
}

export function advisorEvidenceFingerprint(
  evidence: string,
  knownProfiles: readonly string[],
): string {
  const h = createHash("sha256");
  h.update(`v${ADVISOR_CACHE_VERSION}\0`);
  h.update(evidence);
  h.update("\0profiles\0");
  h.update([...knownProfiles].sort().join("\n"));
  return h.digest("hex");
}

function promptFor(
  evidence: string,
  knownProfiles: string[],
  currentProfile?: string,
): string {
  return `You select Cue profiles for a repository. Analyze its PRIMARY work domain, not merely deployment files.
Advertising/domain signals (google-ads, claude-ads, marketing, ads-manager) outrank generic Docker/Coolify signals unless infrastructure is the repository's primary product.
Return JSON only, with this exact shape:
{"summary":"one short sentence","suggestions":[{"profile":"existing-name","confidence":0.0,"reasons":["short evidence"]}]}
Return at most 3 suggestions. Profiles MUST be selected only from this list:
${JSON.stringify(knownProfiles)}
Current profile (context only; never assume it is correct): ${currentProfile ?? "none"}
Repository evidence:
${evidence}`;
}

async function defaultRunner(
  agent: "claude" | "codex",
  prompt: string,
): Promise<string | null> {
  // Reuse cue's isolated, bounded classifier instead of spawning the bare
  // agent name (which may be cue's own shim and recurse into launch).
  if (agent === "claude") {
    const { runClassifier } = await import("./claude-classifier");
    const result = await runClassifier(prompt, ADVISOR_TIMEOUT_MS);
    return result.ok ? result.output : null;
  }
  const { findRealAgentBin } = await import("./claude-binary");
  const bin = findRealAgentBin("codex");
  if (!bin) return null;
  return new Promise((resolveResult) => {
    const child = execFile(
      bin,
      ["exec", "--skip-git-repo-check", prompt],
      {
        encoding: "utf8",
        timeout: ADVISOR_TIMEOUT_MS,
        maxBuffer: 256 * 1024,
        env: { ...process.env, CUE_BYPASS: "1" },
      },
      (error, stdout) => {
        resolveResult(error ? null : stdout);
      },
    );
    child.stdin?.end();
  });
}

export function parseProfileAdvice(
  raw: string,
  knownProfiles: ReadonlySet<string>,
): ProfileAdvice | null {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end < start) return null;
    const value = JSON.parse(raw.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    if (
      typeof value.summary !== "string" ||
      !Array.isArray(value.suggestions)
    )
      return null;
    const suggestions: DetectionResultV2[] = [];
    const seen = new Set<string>();
    for (const item of value.suggestions.slice(0, 3)) {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      if (
        typeof row.profile !== "string" ||
        !knownProfiles.has(row.profile) ||
        seen.has(row.profile)
      )
        return null;
      if (
        typeof row.confidence !== "number" ||
        row.confidence < 0 ||
        row.confidence > 1
      )
        return null;
      if (
        !Array.isArray(row.reasons) ||
        row.reasons.length === 0 ||
        !row.reasons.every((reason) => typeof reason === "string")
      )
        return null;
      seen.add(row.profile);
      suggestions.push({
        profile: row.profile,
        confidence: row.confidence,
        reasons: row.reasons.slice(0, 3) as string[],
      });
    }
    if (suggestions.length === 0) return null;
    return { summary: value.summary.slice(0, 240), suggestions };
  } catch {
    return null;
  }
}

function cacheContext(
  opts: Pick<ProfileAdvisorOptions, "cwd" | "knownProfiles" | "cacheRoot">,
): {
  dir: string;
  evidence: string;
  fingerprint: string;
  known: Set<string>;
  knownProfiles: string[];
  path: string;
} {
  const dir = join(opts.cacheRoot ?? cacheDir(), "profile-advisor");
  const path = join(dir, `${advisorCacheKey(opts.cwd)}.json`);
  const evidence = buildAdvisorEvidence(opts.cwd);
  const knownProfiles = [...opts.knownProfiles].sort();
  const fingerprint = advisorEvidenceFingerprint(evidence, knownProfiles);
  return {
    dir,
    evidence,
    fingerprint,
    known: new Set(knownProfiles),
    knownProfiles,
    path,
  };
}

function readCachedAdvice(
  path: string,
  known: ReadonlySet<string>,
  fingerprint: string,
): CachedProfileAdvice | null {
  try {
    const cached = JSON.parse(readFileSync(path, "utf8")) as {
      advice?: unknown;
      fingerprint?: string;
      version?: number;
    };
    if (cached.version !== ADVISOR_CACHE_VERSION) return null;
    const advice = parseProfileAdvice(JSON.stringify(cached.advice), known);
    if (!advice) return null;
    return {
      advice,
      freshness: cached.fingerprint === fingerprint ? "fresh" : "stale",
    };
  } catch {
    return null;
  }
}

/**
 * Return the latest valid advice immediately. Evidence changes mark it stale
 * instead of hiding it; launch can display it while refreshing in background.
 */
export function getCachedProfileAdvice(
  opts: Pick<ProfileAdvisorOptions, "cwd" | "knownProfiles" | "cacheRoot">,
): CachedProfileAdvice | null {
  const { fingerprint, known, path } = cacheContext(opts);
  return readCachedAdvice(path, known, fingerprint);
}

interface RefreshLock {
  path: string;
  token: string;
}

/**
 * Atomically claim one repository refresh across concurrent cue launches.
 * `null` means another process owns a live lock; `undefined` means locking is
 * unavailable, in which case advice still runs best-effort rather than failing.
 */
function acquireRefreshLock(path: string): RefreshLock | null | undefined {
  const lockPath = `${path}.refresh.lock`;
  try {
    mkdirSync(dirname(lockPath), { recursive: true });
  } catch {
    return undefined;
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = `${process.pid}:${Date.now()}:${randomUUID()}`;
    try {
      const fd = openSync(lockPath, "wx");
      try {
        try {
          writeFileSync(fd, token);
        } catch (error) {
          try {
            unlinkSync(lockPath);
          } catch {
            /* the write error remains the useful failure */
          }
          throw error;
        }
      } finally {
        closeSync(fd);
      }
      return { path: lockPath, token };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return undefined;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs <= ADVISOR_REFRESH_LOCK_TTL_MS) {
          return null;
        }
        unlinkSync(lockPath);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function releaseRefreshLock(lock: RefreshLock): void {
  try {
    if (readFileSync(lock.path, "utf8") === lock.token) unlinkSync(lock.path);
  } catch {
    /* best-effort lock cleanup */
  }
}

export async function adviseProfiles(
  opts: ProfileAdvisorOptions,
): Promise<ProfileAdvice | null> {
  const { dir, evidence, fingerprint, known, knownProfiles, path } =
    cacheContext(opts);
  const cached = readCachedAdvice(path, known, fingerprint);
  if (cached?.freshness === "fresh") return cached.advice;

  const lock = acquireRefreshLock(path);
  if (lock === null) return cached?.advice ?? null;

  try {
    const runner = opts.runner ?? defaultRunner;
    const order: Array<"claude" | "codex"> =
      opts.preferredAgent === "codex"
        ? ["codex", "claude"]
        : ["claude", "codex"];
    const prompt = promptFor(evidence, knownProfiles, opts.currentProfile);
    let advice: ProfileAdvice | null = null;
    for (const agent of order) {
      const raw = await runner(agent, prompt);
      if (raw && (advice = parseProfileAdvice(raw, known))) break;
    }
    if (!advice) return cached?.advice ?? null;
    try {
      mkdirSync(dir, { recursive: true });
      const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
      writeFileSync(
        tmp,
        `${JSON.stringify({
          version: ADVISOR_CACHE_VERSION,
          cwd: resolve(opts.cwd),
          fingerprint,
          updatedAt: new Date().toISOString(),
          advice,
        })}\n`,
      );
      renameSync(tmp, path);
    } catch {
      /* cache failure must not block launch */
    }
    return advice;
  } finally {
    if (lock) releaseRefreshLock(lock);
  }
}
