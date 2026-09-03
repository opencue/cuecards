/**
 * Resolver for `skills.npx` profile entries.
 *
 * Each entry { repo, pin?, skills } expands into one cache slot
 *   <xdgCache>/cue/npx/<sha256(repo + (pin || "HEAD"))>/  (XDG; tests pin via repoRoot)
 * containing one subdir per skill. The resolver returns a LinkPlan[] mapping
 * each cached skill dir into `.claude/skills/<skill>`.
 *
 * Fetching is delegated to injectable functions so tests never shell out to
 * the real `npx`. The production batch fetcher (`npxFetchMany`) executes one
 *   npx skills add <repo> --skill <name...> -a claude-code -y
 * per repo entry, then hands the populated directory to `cachePut`.
 *
 * Environment:
 *   SOUL_OFFLINE=1   →  cache miss is a hard failure (NpxFetchFailed).
 *   CUE_REPO_ROOT    →  override repo root (legacy: SOUL_REPO_ROOT).
 *
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LinkPlan, NpxSkillRef, Profile } from "../../profiles/_types";
import { ProfileError } from "../../profiles/_types";
import {
  cacheChildren,
  cacheHit,
  cachePut,
  cacheSkillPath,
  type CacheLayout,
} from "./cache";
import { fetchCompanionFiles, detectSkillPath } from "./companion-fetch";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** `npx skills add ...` failed, or `--offline` blocked a needed fetch. */
export class NpxFetchFailed extends ProfileError {
  constructor(
    public repo: string,
    public reason: string,
    public details?: unknown,
  ) {
    super("NPX_FETCH_FAILED", `npx fetch failed for ${repo}: ${reason}`);
  }
}

/** Pin given but the fetched payload doesn't contain the expected skill dir. */
export class PinNotFound extends ProfileError {
  constructor(
    public repo: string,
    public pin: string,
    public skill: string,
  ) {
    super(
      "PIN_NOT_FOUND",
      `skill "${skill}" missing in ${repo}@${pin} after fetch`,
    );
  }
}

/** Cache slot exists but is incoherent (missing requested skill subdir). */
export class CacheCorrupt extends ProfileError {
  constructor(
    public key: string,
    public missing: string[],
  ) {
    super(
      "CACHE_CORRUPT",
      `cache slot ${key} missing skill(s): ${missing.join(", ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Cache-key scheme
// ---------------------------------------------------------------------------

/**
 * Cache key = sha256(`<repo>` + `<pin || "HEAD">`).
 *
 * Hex digest, 64 chars. Stable across machines so cache hits work in CI.
 * Note: we deliberately do NOT hash the skill name — one (repo, pin) tuple
 * yields one cache slot containing every skill that's been pulled from it.
 */
export function cacheKey(repo: string, pin: string | undefined): string {
  const ref = pin ?? "HEAD";
  return createHash("sha256").update(repo + ref).digest("hex");
}

// ---------------------------------------------------------------------------
// Fetcher contract
// ---------------------------------------------------------------------------

/**
 * Fetch one skill from `repo` (optionally at `pin`) into `destDir`. The
 * resolver always passes an empty, freshly-created `destDir`; the fetcher
 * must leave a directory named `<skill>` under it.
 */
export type NpxFetchFn = (
  repo: string,
  pin: string | undefined,
  skill: string,
  destDir: string,
) => Promise<void>;

/** Fetch multiple skills from one repo checkout in a single CLI invocation. */
export type NpxBatchFetchFn = (
  repo: string,
  pin: string | undefined,
  skills: string[],
  destDir: string,
) => Promise<void>;

/**
 * Production batch fetcher: shells out to `npx skills add ...`.
 *
 * Exported so the default resolver can use it; tests inject a mock instead
 * and never reach this code path.
 */
export const npxFetchMany: NpxBatchFetchFn = async (
  repo,
  pin,
  skills,
  destDir,
) => {
  if (skills.length === 0) return;

  const args = [
    "-y",
    "skills@latest",
    "add",
    repo,
    "--skill",
    ...skills,
    "-a",
    "claude-code",
    "-y",
  ];
  if (pin) {
    // Pin format from schema: "git@<sha>" or "tag@<version>".
    // `npx skills add` accepts `--ref <ref>` for both shas and tags.
    const ref = pin.replace(/^git@/, "").replace(/^tag@/, "");
    args.push("--ref", ref);
  }
  // Defense-in-depth: a single wedged `npx skills add` must never hang the
  // whole run. On timeout spawnSync sets res.error (ETIMEDOUT), which maps to
  // NpxFetchFailed below. CUE_NPX_TIMEOUT_MS overrides; a non-positive or
  // non-numeric value (incl. "" → 0, which would DISABLE the timeout) falls
  // back to the 45s default rather than silently defeating the guard.
  const envTimeout = Number(process.env.CUE_NPX_TIMEOUT_MS);
  const npxTimeoutMs = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 45000;
  const res = spawnSync("npx", args, {
    cwd: destDir,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: npxTimeoutMs,
    killSignal: "SIGKILL",
    windowsHide: true,
  });
  if (res.error) {
    throw new NpxFetchFailed(repo, res.error.message, res.error);
  }
  if (res.status !== 0) {
    throw new NpxFetchFailed(repo, `exit ${res.status}`, {
      stdout: res.stdout,
      stderr: res.stderr,
    });
  }

  for (const skill of skills) {
    flattenNpxLayout(destDir, skill);
  }

  // Fetch companion files (scripts/, forms.md, reference.md, etc.) so the
  // installed skill is a complete package, not just SKILL.md.
  for (const skill of skills) {
    const skillDir = join(destDir, skill);
    if (existsSync(skillDir) && needsCompanionRecovery(skillDir)) {
      const skillPath = detectSkillPath(repo, skill);
      if (skillPath) {
        fetchCompanionFiles(repo, skillPath, skillDir, { quiet: true });
      }
    }
  }
};

export const npxFetch: NpxFetchFn = async (repo, pin, skill, destDir) => {
  await npxFetchMany(repo, pin, [skill], destDir);
};

/**
 * The `skills` CLI drops fetched skills at `<destDir>/.claude/skills/<skill>/`
 * (it follows Claude Code's runtime layout). Cue's resolver expects a flat
 * `<destDir>/<skill>/` layout — so relocate here. Exported for tests; callers
 * outside this module should not need this.
 */
export function flattenNpxLayout(destDir: string, skill: string): void {
  const fromClaudeLayout = join(destDir, ".claude", "skills", skill);
  const flatTarget = join(destDir, skill);
  if (!existsSync(fromClaudeLayout) || existsSync(flatTarget)) return;

  // Lazy import — avoids node:fs/promises overhead in the cached-fetch path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  fs.renameSync(fromClaudeLayout, flatTarget);

  // Clean up the now-empty .claude/skills/ scaffold so the staging dir
  // doesn't accumulate cruft when multiple skills are pulled in sequence.
  try {
    const claudeSkills = join(destDir, ".claude", "skills");
    if (existsSync(claudeSkills) && fs.readdirSync(claudeSkills).length === 0) {
      fs.rmSync(claudeSkills, { recursive: true, force: true });
    }
    const claudeDir = join(destDir, ".claude");
    if (existsSync(claudeDir) && fs.readdirSync(claudeDir).length === 0) {
      fs.rmSync(claudeDir, { recursive: true, force: true });
    }
  } catch { /* cleanup is best-effort */ }
}

/**
 * Modern versions of the `skills` CLI copy the complete skill directory.
 * Only fall back to GitHub companion discovery for legacy SKILL.md-only
 * payloads; probing every already-complete skill adds one network round trip
 * per skill to cold profile launches.
 */
export function needsCompanionRecovery(skillDir: string): boolean {
  try {
    return !readdirSync(skillDir).some((entry) => entry !== "SKILL.md");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public resolver
// ---------------------------------------------------------------------------

export interface ResolveNpxOptions {
  /** Legacy: pin the cache under `<repoRoot>/profiles/_cache`. Omit to use the XDG cache (~/.cache/cue). */
  repoRoot?: string;
  /** Fetcher; defaults to the real `npx skills add` shellout. */
  fetch?: NpxFetchFn;
  /** Batch fetcher used by production to resolve one repo in one shellout. */
  fetchMany?: NpxBatchFetchFn;
  /** Override offline flag (defaults to CUE_OFFLINE / SOUL_OFFLINE env). */
  offline?: boolean;
}

export interface ResolveNpxResult {
  plans: LinkPlan[];
  /** Per-entry cache key — useful for debugging / `cue doctor`. */
  keys: Record<string, string>;
}

/**
 * Resolve every `skills.npx` entry on `profile` into a LinkPlan[].
 *
 * Steps per entry:
 *   1. Compute cache key from (repo, pin).
 *   2. If cache hit AND every requested skill subdir exists  → reuse.
 *   3. Cache hit but some skill missing                       → CacheCorrupt
 *      (force a re-fetch into a fresh slot; if `--offline`, fail hard).
 *   4. Cache miss                                             → fetch into
 *      a tmp dir, then cachePut it as the new slot.
 *
 * Returns one LinkPlan per (entry, skill) tuple. Target is fixed at
 * `.claude/skills/<skill>` to match the materializer's expectations.
 */
export async function resolveNpx(
  profile: Profile,
  opts: ResolveNpxOptions = {},
): Promise<LinkPlan[]> {
  const { plans } = await resolveNpxDetailed(profile, opts);
  return plans;
}

/** Same as resolveNpx but also returns the cache keys (handy for doctor/list). */
export async function resolveNpxDetailed(
  profile: Profile,
  opts: ResolveNpxOptions = {},
): Promise<ResolveNpxResult> {
  const entries = profile.skills?.npx ?? [];
  const plans: LinkPlan[] = [];
  const keys: Record<string, string> = {};
  if (entries.length === 0) {
    return { plans, keys };
  }

  // Default cache lives in the XDG cache dir (~/.cache/cue), never inside the
  // install tree. Tests/legacy callers may still pin it via opts.repoRoot.
  const layout: CacheLayout = opts.repoRoot ? { repoRoot: opts.repoRoot } : {};
  const fetcher = opts.fetch ?? npxFetch;
  const batchFetcher = opts.fetchMany ?? (opts.fetch ? undefined : npxFetchMany);
  const offline = opts.offline ?? (process.env.CUE_OFFLINE ?? process.env.SOUL_OFFLINE) === "1";

  for (const entry of entries) {
    const key = cacheKey(entry.repo, entry.pin);
    keys[entryId(entry)] = key;

    await ensureCacheForEntry(
      layout,
      key,
      entry,
      fetcher,
      batchFetcher,
      offline,
    );

    for (const skill of entry.skills) {
      plans.push({
        source: cacheSkillPath(layout, key, skill),
        target: `.claude/skills/${skill}`,
        origin: "npx",
      });
    }
  }

  return { plans, keys };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function ensureCacheForEntry(
  layout: CacheLayout,
  key: string,
  entry: NpxSkillRef,
  fetcher: NpxFetchFn,
  batchFetcher: NpxBatchFetchFn | undefined,
  offline: boolean,
): Promise<void> {
  if (cacheHit(layout, key)) {
    const present = new Set(cacheChildren(layout, key));
    const missing = entry.skills.filter((s) => !present.has(s) || !isNonEmptyDir(cacheSkillPath(layout, key, s)));
    if (missing.length === 0) {
      return; // full hit
    }
    // Partial hit: detectable corruption. In offline mode this is fatal.
    if (offline) {
      throw new CacheCorrupt(key, missing);
    }
    // Otherwise, fall through to re-populate the missing skills.
    await fetchInto(layout, key, entry, missing, fetcher, batchFetcher);
    return;
  }

  // Total miss.
  if (offline) {
    throw new NpxFetchFailed(
      entry.repo,
      `cache miss for key ${key} and SOUL_OFFLINE=1`,
    );
  }
  await fetchInto(layout, key, entry, entry.skills, fetcher, batchFetcher);
}

async function fetchInto(
  layout: CacheLayout,
  key: string,
  entry: NpxSkillRef,
  skills: string[],
  fetcher: NpxFetchFn,
  batchFetcher?: NpxBatchFetchFn,
): Promise<void> {
  // Stage into a tmp dir, then publish via cachePut (atomic-ish rename).
  // If the slot already exists (partial-hit repair), we merge skill subdirs
  // into the existing slot rather than nuking it; this keeps already-good
  // skills warm.
  const staging = mkdtempSync(join(tmpdir(), "cue-npx-"));
  try {
    if (batchFetcher) {
      await batchFetcher(entry.repo, entry.pin, skills, staging);
    } else {
      for (const skill of skills) {
        await fetcher(entry.repo, entry.pin, skill, staging);
      }
    }
    for (const skill of skills) {
      const produced = join(staging, skill);
      if (!isNonEmptyDir(produced)) {
        throw new PinNotFound(entry.repo, entry.pin ?? "HEAD", skill);
      }
    }

    if (cacheHit(layout, key)) {
      // Partial-repair path: move skills one at a time into existing slot.
      for (const skill of skills) {
        const src = join(staging, skill);
        const dest = cacheSkillPath(layout, key, skill);
        if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
        // renameSync within tmp -> repo can fail across FS; fall back to copy.
        try {
          // We deliberately import only on demand to avoid a top-level cycle.
          const { renameSync } = await import("node:fs");
          renameSync(src, dest);
        } catch {
          const { cpSync } = await import("node:fs");
          cpSync(src, dest, { recursive: true });
          rmSync(src, { recursive: true, force: true });
        }
      }
    } else {
      cachePut(layout, key, staging);
      return; // staging was consumed by rename inside cachePut
    }
  } finally {
    // Best-effort cleanup; cachePut may have already renamed `staging` away.
    if (existsSync(staging)) {
      try {
        rmSync(staging, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

function isNonEmptyDir(p: string): boolean {
  try {
    if (!existsSync(p)) return false;
    const st = statSync(p);
    if (!st.isDirectory()) return false;
    return readdirSync(p).length > 0;
  } catch {
    return false;
  }
}

function entryId(e: NpxSkillRef): string {
  return `${e.repo}@${e.pin ?? "HEAD"}`;
}

// Re-export cachePath for callers that want to print the slot for debugging.
export { cachePath } from "./cache";
