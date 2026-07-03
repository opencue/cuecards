/**
 * Runtime garbage collection. Materialized per-profile (and per-account)
 * runtimes accumulate under `~/.config/cue/runtime/<key>/` — one dir per
 * profile/composite/account combination ever launched. They're disposable
 * (a launch re-materializes any missing runtime), so old ones are pure disk
 * cost. This module finds runtimes untouched past an age threshold and deletes
 * them, rescuing any login-fresh credentials back to their account first.
 *
 * Design rules:
 *   - **Fail-safe.** Never delete the runtime in use this launch (`keepKey`),
 *     and never delete on a zero/negative age threshold (the disable switch).
 *   - **Zero launch latency.** The auto-sweep runs AFTER the agent session ends
 *     (cue is still alive, the child has exited), throttled to ~once/day.
 *   - **Credential-safe.** Rescue a newer token to its account dir before rm,
 *     reusing the same helper the launch-exit path uses.
 */

import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { configDir } from "./config-paths";

/** Marker file written into a runtime on every launch, holding an epoch-ms stamp. */
export const LAST_USED_MARKER = ".cue-last-used";
/** Default age threshold; override with CUE_RUNTIME_GC_DAYS (0 disables GC entirely). */
export const DEFAULT_GC_DAYS = 30;
const DAY_MS = 86_400_000;

export interface RuntimeEntry {
  /** On-disk runtime dir name, e.g. `core@account1`. */
  key: string;
  /** Absolute path to the runtime dir. */
  path: string;
  /** Best-effort "last used" epoch ms; 0 when unknowable. */
  lastUsedMs: number;
}

/**
 * Resolve the GC age threshold in days from CUE_RUNTIME_GC_DAYS. Unset →
 * DEFAULT_GC_DAYS. A parseable `0` (or negative) disables GC. An unparseable
 * value falls back to the default rather than silently disabling.
 */
export function gcDaysFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CUE_RUNTIME_GC_DAYS;
  if (raw == null || raw.trim() === "") return DEFAULT_GC_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_GC_DAYS;
  return n;
}

/** Write the launch timestamp marker into a runtime so GC has an accurate signal. */
export function touchRuntime(runtimeDir: string, nowMs: number): void {
  try {
    writeFileSync(join(runtimeDir, LAST_USED_MARKER), `${nowMs}\n`);
  } catch {
    /* best-effort — a missing marker just falls back to mtime */
  }
}

/**
 * Best-effort "last used" epoch ms for a runtime dir: the marker if present and
 * valid, else the newest mtime among a few files a live session updates, else 0.
 */
export function runtimeLastUsedMs(runtimeDir: string): number {
  try {
    const n = Number(readFileSync(join(runtimeDir, LAST_USED_MARKER), "utf8").trim());
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    /* no marker — fall back to mtimes */
  }
  const candidates = [
    join(runtimeDir, "claude", "history.jsonl"),
    join(runtimeDir, "claude", ".credentials.json"),
    join(runtimeDir, "claude", ".cue-hash"),
    join(runtimeDir, "codex", ".cue-hash"),
    runtimeDir,
  ];
  let newest = 0;
  for (const p of candidates) {
    try {
      newest = Math.max(newest, statSync(p).mtimeMs);
    } catch {
      /* ignore missing */
    }
  }
  return newest;
}

/**
 * Pure victim selection. Returns entries older than `maxAgeDays`, never the
 * `keepKey` runtime, never an entry with an unknown (0) last-used. A
 * non-positive `maxAgeDays` disables GC (returns []).
 */
export function selectGcVictims(
  entries: RuntimeEntry[],
  opts: { nowMs: number; maxAgeDays: number; keepKey?: string },
): RuntimeEntry[] {
  if (opts.maxAgeDays <= 0) return [];
  const cutoff = opts.nowMs - opts.maxAgeDays * DAY_MS;
  return entries.filter(
    (e) => e.key !== opts.keepKey && e.lastUsedMs > 0 && e.lastUsedMs < cutoff,
  );
}

/** Scan the runtime root into entries (one per direct child dir). */
export function scanRuntimes(runtimeRoot: string = join(configDir(), "runtime")): RuntimeEntry[] {
  let names: string[];
  try {
    names = readdirSync(runtimeRoot);
  } catch {
    return [];
  }
  const out: RuntimeEntry[] = [];
  for (const key of names) {
    const path = join(runtimeRoot, key);
    try {
      if (!statSync(path).isDirectory()) continue;
    } catch {
      continue;
    }
    out.push({ key, path, lastUsedMs: runtimeLastUsedMs(path) });
  }
  return out;
}

/** Rescue login-fresh credentials to their account, then delete the runtime dir. */
async function deleteRuntime(entry: RuntimeEntry): Promise<void> {
  try {
    const { listKnownAccountDirs, rescueRuntimeCredentials } = await import("./credentials-sync");
    const claudeDir = join(entry.path, "claude");
    if (existsSync(claudeDir)) {
      await rescueRuntimeCredentials(claudeDir, await listKnownAccountDirs(homedir()));
    }
  } catch {
    /* best-effort — never block deletion on a rescue failure */
  }
  rmSync(entry.path, { recursive: true, force: true });
}

export interface GcOptions {
  maxAgeDays: number;
  keepKey?: string;
  dryRun?: boolean;
  nowMs?: number;
  runtimeRoot?: string;
}

export interface GcResult {
  scanned: number;
  victims: RuntimeEntry[];
  deleted: string[];
}

/** Scan, select, and (unless dryRun) delete stale runtimes. */
export async function runGc(opts: GcOptions): Promise<GcResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const entries = scanRuntimes(opts.runtimeRoot);
  const victims = selectGcVictims(entries, {
    nowMs,
    maxAgeDays: opts.maxAgeDays,
    keepKey: opts.keepKey,
  });
  const deleted: string[] = [];
  if (!opts.dryRun) {
    for (const v of victims) {
      try {
        await deleteRuntime(v);
        deleted.push(v.key);
      } catch {
        /* skip a runtime that won't delete; report the rest */
      }
    }
  }
  return { scanned: entries.length, victims, deleted };
}

const GC_STAMP = ".gc-stamp";
/** Auto-sweep runs at most once per this window regardless of launch frequency. */
const GC_THROTTLE_MS = 20 * 3_600_000; // 20h

/**
 * Throttled post-session auto-sweep. Called after the agent exits, so it costs
 * zero launch latency. No-ops when GC is disabled (days<=0) or when the last
 * sweep was under the throttle window. Never deletes the just-used runtime.
 */
export async function maybeAutoGc(keepKey: string, nowMs: number = Date.now()): Promise<GcResult | null> {
  const days = gcDaysFromEnv();
  if (days <= 0) return null;
  const stampPath = join(configDir(), GC_STAMP);
  try {
    const last = Number(readFileSync(stampPath, "utf8").trim());
    if (Number.isFinite(last) && nowMs - last < GC_THROTTLE_MS) return null;
  } catch {
    /* no stamp yet — first sweep */
  }
  try {
    writeFileSync(stampPath, `${nowMs}\n`);
  } catch {
    /* if we can't stamp, run anyway but don't loop-hammer: proceed once */
  }
  return runGc({ maxAgeDays: days, keepKey, nowMs });
}
