/**
 * `cue clean` — prune stale runtimes, old cache entries, orphaned symlinks.
 */

import { existsSync, readdirSync, rmSync, statSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { listProfiles } from "../lib/profile-loader";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNTIME_ROOT = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cue", "runtime");
const CACHE_ROOT = join(REPO_ROOT, "profiles", "_cache", "npx");

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue clean — prune stale runtimes and cache

Usage:
  cue clean              Show what would be cleaned (dry run)
  cue clean --force      Actually delete stale entries
`);
    return 0;
  }

  const force = args.includes("--force");
  const profiles = new Set(await listProfiles());
  let totalBytes = 0;
  let totalEntries = 0;

  // 1. Stale runtimes (profiles that no longer exist)
  if (existsSync(RUNTIME_ROOT)) {
    for (const dir of readdirSync(RUNTIME_ROOT)) {
      if (!profiles.has(dir)) {
        const path = join(RUNTIME_ROOT, dir);
        const size = getDirSize(path);
        totalBytes += size;
        totalEntries++;
        process.stdout.write(`  ${force ? "🗑️" : "⚠️"}  stale runtime: ${dir} (${formatSize(size)})\n`);
        if (force) rmSync(path, { recursive: true, force: true });
      }
    }
  }

  // 2. Old cache entries (beyond LRU limit)
  if (existsSync(CACHE_ROOT)) {
    const entries = readdirSync(CACHE_ROOT)
      .map(name => ({ name, mtime: statSync(join(CACHE_ROOT, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    const stale = entries.slice(20); // keep 20 most recent
    for (const entry of stale) {
      const path = join(CACHE_ROOT, entry.name);
      const size = getDirSize(path);
      totalBytes += size;
      totalEntries++;
      process.stdout.write(`  ${force ? "🗑️" : "⚠️"}  old cache: ${entry.name.slice(0, 12)}… (${formatSize(size)})\n`);
      if (force) rmSync(path, { recursive: true, force: true });
    }
  }

  // 3. Analytics file size check
  const analyticsPath = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cue", "analytics.jsonl");
  if (existsSync(analyticsPath)) {
    const size = statSync(analyticsPath).size;
    if (size > 5_000_000) { // > 5MB
      totalBytes += size - 1_000_000;
      totalEntries++;
      process.stdout.write(`  ${force ? "🗑️" : "⚠️"}  large analytics: ${formatSize(size)} (will trim to 1MB)\n`);
      if (force) {
        const content = readFileSync(analyticsPath, "utf8");
        const lines = content.split("\n");
        const trimmed = lines.slice(-10000).join("\n"); // keep last 10k events
        require("node:fs").writeFileSync(analyticsPath, trimmed);
      }
    }
  }

  if (totalEntries === 0) {
    process.stdout.write("  ✅ Nothing to clean. All good.\n");
  } else if (!force) {
    process.stdout.write(`\n  ${totalEntries} entries, ~${formatSize(totalBytes)} reclaimable.\n`);
    process.stdout.write(`  Run: cue clean --force\n`);
  } else {
    process.stdout.write(`\n  ✅ Cleaned ${totalEntries} entries, freed ~${formatSize(totalBytes)}.\n`);
  }

  return 0;
}

function getDirSize(path: string): number {
  try {
    let size = 0;
    const entries = readdirSync(path, { withFileTypes: true });
    for (const e of entries) {
      const p = join(path, e.name);
      if (e.isDirectory()) size += getDirSize(p);
      else try { size += statSync(p).size; } catch {}
    }
    return size;
  } catch { return 0; }
}

function formatSize(bytes: number): string {
  if (bytes > 1_000_000) return (bytes / 1_000_000).toFixed(1) + " MB";
  if (bytes > 1_000) return (bytes / 1_000).toFixed(0) + " KB";
  return bytes + " B";
}
