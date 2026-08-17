/**
 * Skill versioning + lockfile.
 *
 * Tracks installed skill versions (git SHA) and detects outdated installs
 * by comparing against remote HEAD.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { configDir } from "./config-paths";

export interface SkillLockEntry {
  id: string;
  repo: string;
  sha: string;
  fetchedAt: string;
}

export interface SkillsLockFile {
  version: 1;
  skills: SkillLockEntry[];
}

export function lockfilePath(): string {
  return process.env.CUE_SKILLS_LOCK_PATH || join(configDir(), "skills-lock.json");
}

export function readLockfile(): SkillsLockFile {
  const p = lockfilePath();
  if (!existsSync(p)) return { version: 1, skills: [] };
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return { version: 1, skills: [] };
  }
}

export function writeLockfile(lock: SkillsLockFile): void {
  const p = lockfilePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(lock, null, 2) + "\n");
}

export function recordInstall(id: string, repo: string, sha: string): void {
  const lock = readLockfile();
  const idx = lock.skills.findIndex(s => s.id === id);
  const entry: SkillLockEntry = { id, repo, sha, fetchedAt: new Date().toISOString() };
  if (idx >= 0) lock.skills[idx] = entry;
  else lock.skills.push(entry);
  writeLockfile(lock);
}

export function getRemoteHead(repo: string): string | null {
  // Try gh CLI first
  const gh = spawnSync("gh", ["api", `repos/${repo}/commits/HEAD`, "--jq", ".sha"], {
    encoding: "utf8",
    timeout: 10000,
  });
  if (gh.status === 0 && gh.stdout.trim().length >= 7) {
    return gh.stdout.trim();
  }
  // Fallback to curl
  const curl = spawnSync("curl", ["-sf", `https://api.github.com/repos/${repo}/commits/HEAD`], {
    encoding: "utf8",
    timeout: 10000,
  });
  if (curl.status === 0) {
    try {
      const data = JSON.parse(curl.stdout);
      if (data.sha) return data.sha;
    } catch { /* ignore */ }
  }
  return null;
}

export function findOutdated(): { id: string; current: string; latest: string; repo: string }[] {
  const lock = readLockfile();
  const results: { id: string; current: string; latest: string; repo: string }[] = [];
  for (const entry of lock.skills) {
    const latest = getRemoteHead(entry.repo);
    if (latest && latest !== entry.sha) {
      results.push({ id: entry.id, current: entry.sha, latest, repo: entry.repo });
    }
  }
  return results;
}
