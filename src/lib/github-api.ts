/**
 * GitHub API helpers used by companion-fetch and related modules.
 *
 * Provides:
 *   - ETag cache layer (persist + in-memory singleton)
 *   - Retry with exponential backoff (Atomics.wait — no child-process fork)
 *   - ghListDir / ghDownloadFile / ghDownloadFileAsync via `gh` CLI + curl fallback
 *   - defaultFetcher — production Fetcher implementation
 */

import { spawnSync, spawn as nodeSpawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir } from "./config-paths";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubContentEntry {
  name: string;
  path: string;
  sha: string;
  type: "file" | "dir";
  download_url: string | null;
}

/** Injectable fetcher interface for testing. */
export interface Fetcher {
  listDir(repo: string, path: string, ref?: string): GitHubContentEntry[] | null;
  downloadFile(url: string, dest: string): boolean;
  downloadFileAsync?(url: string, dest: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// ETag cache
// ---------------------------------------------------------------------------

interface ETagEntry {
  etag: string;
  data: GitHubContentEntry[];
  ts: number;
}

const ETAG_CACHE_PATH = join(cacheDir(), "companion-etags.json");

// In-memory singleton to avoid reading + JSON-parsing the cache file on every
// ghListDir call (which recurses per subdirectory during skill installs).
let _etagCache: Record<string, ETagEntry> | null = null;

function loadETagCache(): Record<string, ETagEntry> {
  if (_etagCache !== null) return _etagCache;
  try {
    if (existsSync(ETAG_CACHE_PATH)) {
      _etagCache = JSON.parse(readFileSync(ETAG_CACHE_PATH, "utf8"));
      return _etagCache!;
    }
  } catch {}
  _etagCache = {};
  return _etagCache;
}

function saveETagCache(cache: Record<string, ETagEntry>): void {
  _etagCache = cache; // keep in-memory copy in sync
  try {
    mkdirSync(join(ETAG_CACHE_PATH, ".."), { recursive: true });
    writeFileSync(ETAG_CACHE_PATH, JSON.stringify(cache));
  } catch {}
}

// ---------------------------------------------------------------------------
// Retry with exponential backoff
// ---------------------------------------------------------------------------

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

export function retrySpawn(
  cmd: string,
  args: string[],
  opts: { encoding: "utf8"; timeout: number },
): { status: number | null; stdout: string; stderr: string } {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = spawnSync(cmd, args, {
      ...opts,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Success or client error (4xx) — don't retry
    if (res.status === 0) return res;
    // Check if it's a transient failure (timeout, 5xx, network error)
    const isTransient = res.error || res.stderr?.includes("timed out") ||
      res.stderr?.includes("503") || res.stderr?.includes("502") ||
      res.stderr?.includes("429");
    if (!isTransient || attempt === MAX_RETRIES) return res;
    // Exponential backoff — use Atomics.wait instead of spawning a child
    // process to avoid the OS fork overhead and event-loop stalls from spawnSync.
    const delay = BASE_DELAY_MS * Math.pow(2, attempt);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
  }
  return { status: 1, stdout: "", stderr: "max retries exceeded" };
}

// ---------------------------------------------------------------------------
// GitHub CLI availability check (cached)
// ---------------------------------------------------------------------------

function hasGhCli(): boolean {
  const res = spawnSync("gh", ["auth", "status"], {
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return res.status === 0;
}

let _ghAvailable: boolean | null = null;

export function ghAvailable(): boolean {
  if (_ghAvailable === null) _ghAvailable = hasGhCli();
  return _ghAvailable;
}

/** Reset gh availability cache (for testing). */
export function _resetGhCache(): void {
  _ghAvailable = null;
}

// ---------------------------------------------------------------------------
// GitHub API helpers — prefer `gh` CLI (authenticated) over raw curl
// ---------------------------------------------------------------------------

/** List directory contents via GitHub API with ETag caching + retry. */
export function ghListDir(repo: string, path: string, ref?: string): GitHubContentEntry[] | null {
  const endpoint = `repos/${repo}/contents/${path}${ref && ref !== "HEAD" ? `?ref=${ref}` : ""}`;
  const cacheKey = `${repo}/${path}@${ref ?? "HEAD"}`;
  const cache = loadETagCache();
  const cached = cache[cacheKey];

  if (ghAvailable()) {
    // Use gh api with ETag if we have a cached response
    const args = ["api", endpoint];
    if (cached?.etag) {
      args.push("-H", `If-None-Match: ${cached.etag}`);
    }
    const res = retrySpawn("gh", args, { encoding: "utf8", timeout: 15000 });

    if (res.status === 0 && res.stdout) {
      try {
        const data = JSON.parse(res.stdout);
        if (Array.isArray(data)) {
          // Extract ETag from gh api response headers (gh includes them in stderr with -i)
          // For simplicity, store the data with a timestamp-based pseudo-etag
          cache[cacheKey] = { etag: String(Date.now()), data, ts: Date.now() };
          saveETagCache(cache);
          return data;
        }
      } catch {}
    }
    // 304 Not Modified — use cached data
    if (res.stderr?.includes("304") || res.stdout === "") {
      if (cached?.data) return cached.data;
    }
  }

  // Fallback to curl with proper ETag handling
  const url = `https://api.github.com/${endpoint}`;
  const curlArgs = ["-sSL", "-H", "Accept: application/vnd.github.v3+json"];
  if (cached?.etag) {
    curlArgs.push("-H", `If-None-Match: ${cached.etag}`);
  }
  // Include response headers to capture ETag
  curlArgs.push("-D", "/dev/stderr", url);

  const res = retrySpawn("curl", curlArgs, { encoding: "utf8", timeout: 15000 });

  // 304 Not Modified
  if (res.stderr?.includes("304")) {
    if (cached?.data) return cached.data;
  }

  if (res.status === 0 && res.stdout) {
    try {
      const data = JSON.parse(res.stdout);
      if (Array.isArray(data)) {
        // Extract ETag from response headers
        const etagMatch = res.stderr?.match(/etag:\s*"?([^"\r\n]+)"?/i);
        const etag = etagMatch?.[1] ?? String(Date.now());
        cache[cacheKey] = { etag, data, ts: Date.now() };
        saveETagCache(cache);
        return data;
      }
    } catch {}
  }

  // Use stale cache if available (offline-friendly)
  if (cached?.data) return cached.data;
  return null;
}

/** Download a single file with retry. Returns true on success. */
export function ghDownloadFile(url: string, dest: string): boolean {
  const res = retrySpawn("curl", ["-fsSL", "-o", dest, url], { encoding: "utf8", timeout: 30000 });
  return res.status === 0;
}

/** Async download via node child_process.spawn for true parallelism. */
export async function ghDownloadFileAsync(url: string, dest: string): Promise<boolean> {
  try {
    return await new Promise<boolean>((resolve) => {
      const proc = nodeSpawn("curl", ["-fsSL", "-o", dest, url], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      proc.on("error", () => resolve(ghDownloadFile(url, dest)));
      proc.on("close", (code) => resolve(code === 0));
    });
  } catch {
    // Fallback to sync
    return ghDownloadFile(url, dest);
  }
}

// ---------------------------------------------------------------------------
// Default fetcher (production)
// ---------------------------------------------------------------------------

export const defaultFetcher: Fetcher = {
  listDir: ghListDir,
  downloadFile: ghDownloadFile,
  downloadFileAsync: ghDownloadFileAsync,
};
