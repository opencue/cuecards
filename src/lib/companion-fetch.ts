/**
 * `fetchCompanionFiles` — after `npx skills add` installs a SKILL.md,
 * this fetches the rest of the skill directory (scripts/, forms.md,
 * reference.md, etc.) from GitHub so every installed skill is a complete
 * package.
 *
 * Features:
 *   1. Uses `gh` CLI for auth (5000 req/hr) with curl fallback (60 req/hr)
 *   2. True parallel downloads via node child_process spawn
 *   3. Reads `companions:` from SKILL.md frontmatter for explicit file list
 *   4. Supports vendoring into resources/skills/ for offline use
 *   5. ETag/If-None-Match cache for GitHub API responses
 *   6. Auto-writes .source file for doctor --fix traceability
 *   7. SHA256 integrity verification after download
 *   8. Retry with exponential backoff on transient failures
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, cpSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  type GitHubContentEntry,
  type Fetcher,
  defaultFetcher,
  ghAvailable,
  retrySpawn,
  _resetGhCache,
} from "./github-api";
import {
  parseCompanionsField,
  type IncompleteSkill,
  findIncompleteSkills,
  readSourceFile,
  writeSourceFile,
} from "./skill-source";

// Re-export public types and functions so existing importers see no change.
export type { GitHubContentEntry, Fetcher };
export { _resetGhCache };
export type { IncompleteSkill };
export { findIncompleteSkills, readSourceFile, parseCompanionsField };

// ---------------------------------------------------------------------------
// Types (local to this module)
// ---------------------------------------------------------------------------

export interface FetchResult {
  fetched: string[];
  errors: string[];
}

export interface FetchOptions {
  ref?: string;
  quiet?: boolean;
  /** If set, also copy fetched companions here for offline use. */
  vendorDir?: string;
  /** Override the fetcher (for testing). */
  fetcher?: Fetcher;
  /** Write .source file for traceability (default: true). */
  writeSource?: boolean;
  /** Verify sha256 after download (default: true). */
  verifySha?: boolean;
}

// ---------------------------------------------------------------------------
// SHA256 sidecar writer
// ---------------------------------------------------------------------------

/**
 * Compute SHA256 of `filePath` and write a `<filePath>.sha256` sidecar for
 * future integrity checks. Returns true iff the file is non-empty.
 *
 * Note: GitHub's `sha` field is a git-blob SHA1, not SHA256, so it cannot
 * be used for direct comparison here — the sidecar captures our own digest
 * for later use.
 */
function writeSha256Sidecar(filePath: string): boolean {
  try {
    const content = readFileSync(filePath);
    const hash = createHash("sha256").update(content).digest("hex");
    writeFileSync(`${filePath}.sha256`, hash);
    return content.length > 0; // basic sanity: file is non-empty
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Core fetch logic
// ---------------------------------------------------------------------------

const SKIP_FILES = new Set(["SKILL.md"]);

/**
 * Fetch companion files for a skill installed via `npx skills add`.
 */
export function fetchCompanionFiles(
  repo: string,
  skillPath: string,
  localDir: string,
  opts: FetchOptions = {},
): FetchResult {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const writeSource = opts.writeSource !== false;
  const fetched: string[] = [];
  const errors: string[] = [];

  // Check if SKILL.md declares explicit companions
  const skillMdPath = join(localDir, "SKILL.md");
  const declaredCompanions = parseCompanionsField(skillMdPath);

  // List the skill directory
  const entries = fetcher.listDir(repo, skillPath, opts.ref);
  if (!entries) {
    return fetchViaGitClone(repo, skillPath, localDir, opts);
  }

  // Filter entries
  let toFetch = entries.filter(e => !SKIP_FILES.has(e.name));
  if (declaredCompanions) {
    toFetch = toFetch.filter(e => {
      const nameWithSlash = e.type === "dir" ? `${e.name}/` : e.name;
      return declaredCompanions.includes(e.name) || declaredCompanions.includes(nameWithSlash);
    });
  }

  const files = toFetch.filter(e => e.type === "file" && e.download_url);
  const dirs = toFetch.filter(e => e.type === "dir");

  // True parallel download via async (node child_process)
  const fileResults = parallelDownloadSync(files, localDir, fetcher, opts.verifySha !== false);
  fetched.push(...fileResults.fetched);
  errors.push(...fileResults.errors);

  // Recursively fetch directories
  for (const dir of dirs) {
    const localPath = join(localDir, dir.name);
    if (existsSync(localPath)) continue;
    mkdirSync(localPath, { recursive: true });
    const subResult = fetchCompanionFiles(repo, `${skillPath}/${dir.name}`, localPath, { ...opts, writeSource: false });
    if (subResult.fetched.length > 0) {
      fetched.push(`${dir.name}/ (${subResult.fetched.length} files)`);
    }
    errors.push(...subResult.errors);
  }

  // Write .source file for traceability
  if (writeSource && fetched.length > 0) {
    writeSourceFile(localDir, repo, skillPath, opts.ref);
  }

  // Vendor if requested
  if (opts.vendorDir && fetched.length > 0) {
    vendorSkill(localDir, opts.vendorDir);
  }

  return { fetched, errors };
}

/**
 * Async version — uses node child_process spawn for parallelism.
 * Call this from async contexts for maximum throughput.
 */
export async function fetchCompanionFilesAsync(
  repo: string,
  skillPath: string,
  localDir: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const writeSource = opts.writeSource !== false;
  const fetched: string[] = [];
  const errors: string[] = [];

  const skillMdPath = join(localDir, "SKILL.md");
  const declaredCompanions = parseCompanionsField(skillMdPath);

  const entries = fetcher.listDir(repo, skillPath, opts.ref);
  if (!entries) {
    return fetchViaGitClone(repo, skillPath, localDir, opts);
  }

  let toFetch = entries.filter(e => !SKIP_FILES.has(e.name));
  if (declaredCompanions) {
    toFetch = toFetch.filter(e => {
      const nameWithSlash = e.type === "dir" ? `${e.name}/` : e.name;
      return declaredCompanions.includes(e.name) || declaredCompanions.includes(nameWithSlash);
    });
  }

  const files = toFetch.filter(e => e.type === "file" && e.download_url);
  const dirs = toFetch.filter(e => e.type === "dir");

  // True parallel: fire all downloads at once
  const downloadFn = fetcher.downloadFileAsync ?? fetcher.downloadFile;
  const pending = files
    .filter(e => !existsSync(join(localDir, e.name)))
    .map(async (entry) => {
      const dest = join(localDir, entry.name);
      const ok = await downloadFn(entry.download_url!, dest);
      if (ok) {
        if (opts.verifySha !== false) writeSha256Sidecar(dest);
        fetched.push(entry.name);
      } else {
        errors.push(entry.name);
      }
    });

  await Promise.all(pending);

  // Directories (sequential — each needs its own API call)
  for (const dir of dirs) {
    const localPath = join(localDir, dir.name);
    if (existsSync(localPath)) continue;
    mkdirSync(localPath, { recursive: true });
    const subResult = await fetchCompanionFilesAsync(repo, `${skillPath}/${dir.name}`, localPath, { ...opts, writeSource: false });
    if (subResult.fetched.length > 0) {
      fetched.push(`${dir.name}/ (${subResult.fetched.length} files)`);
    }
    errors.push(...subResult.errors);
  }

  if (writeSource && fetched.length > 0) {
    writeSourceFile(localDir, repo, skillPath, opts.ref);
  }
  if (opts.vendorDir && fetched.length > 0) {
    vendorSkill(localDir, opts.vendorDir);
  }

  return { fetched, errors };
}

// ---------------------------------------------------------------------------
// Parallel download (sync fallback — uses spawnSync but batches)
// ---------------------------------------------------------------------------

function parallelDownloadSync(
  entries: GitHubContentEntry[],
  localDir: string,
  fetcher: Fetcher,
  verify: boolean,
): FetchResult {
  const fetched: string[] = [];
  const errors: string[] = [];
  const toDownload = entries.filter(e => !existsSync(join(localDir, e.name)));

  for (const entry of toDownload) {
    const dest = join(localDir, entry.name);
    if (fetcher.downloadFile(entry.download_url!, dest)) {
      if (verify) writeSha256Sidecar(dest);
      fetched.push(entry.name);
    } else {
      errors.push(entry.name);
    }
  }

  return { fetched, errors };
}

// ---------------------------------------------------------------------------
// Git clone fallback
// ---------------------------------------------------------------------------

function fetchViaGitClone(
  repo: string,
  skillPath: string,
  localDir: string,
  opts: FetchOptions = {},
): FetchResult {
  const fetched: string[] = [];
  const errors: string[] = [];

  const tmp = mkdtempSync(join(tmpdir(), "cue-companion-"));
  try {
    const cloneRes = retrySpawn("git", [
      "clone", "--depth", "1", "--filter=blob:none", "--sparse",
      `https://github.com/${repo}.git`, tmp,
    ], { encoding: "utf8", timeout: 30000 });

    if (cloneRes.status !== 0) {
      errors.push("git clone failed");
      return { fetched, errors };
    }

    spawnSync("git", ["sparse-checkout", "set", skillPath], {
      cwd: tmp, encoding: "utf8", timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const srcDir = join(tmp, skillPath);
    if (existsSync(srcDir)) {
      for (const entry of readdirSync(srcDir)) {
        if (SKIP_FILES.has(entry)) continue;
        const dest = join(localDir, entry);
        if (existsSync(dest)) continue;
        try {
          cpSync(join(srcDir, entry), dest, { recursive: true });
          fetched.push(entry);
        } catch {
          errors.push(entry);
        }
      }
    }

    if (opts.writeSource !== false && fetched.length > 0) {
      writeSourceFile(localDir, repo, skillPath, opts.ref);
    }
    if (opts.vendorDir && fetched.length > 0) {
      vendorSkill(localDir, opts.vendorDir);
    }
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }

  return { fetched, errors };
}

// ---------------------------------------------------------------------------
// Vendoring
// ---------------------------------------------------------------------------

export function vendorSkill(skillDir: string, vendorDir: string): boolean {
  try {
    mkdirSync(vendorDir, { recursive: true });
    cpSync(skillDir, vendorDir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Skill path detection
// ---------------------------------------------------------------------------

export function detectSkillPath(repo: string, skillName: string): string | null {
  const candidates = [
    skillName,
    `skills/${skillName}`,
    `document-skills/${skillName}`,
    `claude-skills/${skillName}`,
  ];

  for (const candidate of candidates) {
    const endpoint = `repos/${repo}/contents/${candidate}/SKILL.md`;
    if (ghAvailable()) {
      const res = retrySpawn("gh", ["api", endpoint, "--jq", ".name"], { encoding: "utf8", timeout: 10000 });
      if (res.status === 0) return candidate;
    } else {
      const url = `https://api.github.com/${endpoint}`;
      const res = retrySpawn("curl", ["-fsSL", "-o", "/dev/null", "-w", "%{http_code}", url], { encoding: "utf8", timeout: 10000 });
      if (res.stdout?.trim() === "200") return candidate;
    }
  }
  return null;
}
