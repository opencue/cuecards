/**
 * skill-source.ts — skill traceability and completeness helpers.
 *
 * Provides:
 *   - parseCompanionsField              — SKILL.md frontmatter parser (pure, no network)
 *   - writeSourceFile / readSourceFile  — .source traceability for doctor --fix
 *   - findIncompleteSkills              — doctor D7 check (consumed by doctor.ts and skills.ts)
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// SKILL.md companions field parser
// ---------------------------------------------------------------------------

export function parseCompanionsField(skillMdPath: string): string[] | null {
  if (!existsSync(skillMdPath)) return null;
  try {
    const content = readFileSync(skillMdPath, "utf8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;
    const fm = fmMatch[1]!;

    const arrayMatch = fm.match(/^companions:\s*\[([^\]]*)\]/m);
    if (arrayMatch) {
      return arrayMatch[1]!.split(",").map(s => s.trim().replace(/['"]/g, "")).filter(Boolean);
    }

    const listMatch = fm.match(/^companions:\s*\n((?:\s+-\s+.+\n?)*)/m);
    if (listMatch) {
      return listMatch[1]!
        .split("\n")
        .map(l => l.replace(/^\s+-\s+/, "").trim().replace(/['"]/g, ""))
        .filter(Boolean);
    }
  } catch {}
  return null;
}

// ---------------------------------------------------------------------------
// .source file — traceability for doctor --fix
// ---------------------------------------------------------------------------

const githubRepo = /^[\w-]+\/[\w.-]+$/;
const commitSha = /^[a-f0-9]{40}$/;
const contentSha = /^[a-f0-9]{64}$/;

type SkillSource = { repo: string; skillPath: string; ref?: string; sha256?: string };
export type SkillSourceRequest = (endpoint: string) => unknown;

export function isGitHubSkillRepo(repo: string): boolean {
  return githubRepo.test(repo) && !repo.endsWith("/.") && !repo.endsWith("/..");
}

function validSkillPath(path: string): boolean {
  return path === "." || path.split("/").every(part => part && part !== "." && part !== ".." && !/[\x00-\x1f\x7f\\]/.test(part));
}

export function writeSourceFile(localDir: string, repo: string, skillPath: string, ref?: string, sha256?: string): boolean {
  try {
    const sourceFile = join(localDir, ".source");
    const stat = lstatSync(sourceFile, { throwIfNoEntry: false });
    if (stat && !stat.isFile()) return false;
    const content = sha256 ? JSON.stringify({ repo, skillPath, ref, sha256 }) + "\n"
      : `${repo}::${skillPath}${ref && ref !== "HEAD" ? `@${ref}` : ""}`;
    writeFileSync(sourceFile, content);
    return true;
  } catch { return false; }
}

export function readSourceFile(skillDir: string): SkillSource | null {
  const sourceFile = join(skillDir, ".source");
  try {
    const stat = lstatSync(sourceFile);
    if (!stat.isFile() || stat.size > 8192) return null;
    const raw = readFileSync(sourceFile, "utf8").trim();
    if (raw.startsWith("{")) {
      const { repo, skillPath, ref, sha256 } = JSON.parse(raw) as SkillSource;
      if (typeof repo === "string" && isGitHubSkillRepo(repo) &&
          typeof skillPath === "string" && validSkillPath(skillPath) &&
          typeof ref === "string" && commitSha.test(ref) &&
          typeof sha256 === "string" && contentSha.test(sha256)) return { repo, skillPath, ref, sha256 };
      return null;
    }
    const [repoAndPath, ...rest] = raw.split("@");
    const ref = rest.length > 0 ? rest.join("@") : undefined;
    const [repo, skillPath] = repoAndPath!.split("::");
    if (repo && skillPath) return { repo, skillPath, ref };
  } catch {}
  return null;
}

/** Stable fingerprint of installed paths, bytes, link targets, and executable bits. */
export function skillContentDigest(root: string): string {
  const hash = createHash("sha256");
  let files = 0;
  let bytes = 0;
  function walk(prefix: string) {
    for (const name of readdirSync(join(root, prefix)).sort()) {
      if ((!prefix && name === ".source") || name === ".git") continue;
      const path = prefix ? `${prefix}/${name}` : name;
      const file = join(root, path);
      const stat = lstatSync(file);
      if (++files > 10_000 || (bytes += stat.size) > 64 * 1024 * 1024) throw new Error("Skill exceeds fingerprint limits");
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile() || stat.isSymbolicLink()) {
        const data = stat.isFile() ? readFileSync(file) : readlinkSync(file, { encoding: "buffer" });
        hash.update(JSON.stringify([path, stat.isFile() ? stat.mode & 0o111 : "symlink", data.length]) + "\n");
        hash.update(data);
      } else throw new Error("Unsupported file type in skill");
    }
  }
  walk("");
  return hash.digest("hex");
}

/** Uncached, read-only GitHub requests. No companion cache or files are written. */
export const requestSkillSource: SkillSourceRequest = endpoint => {
  if ((process.env.CUE_OFFLINE ?? process.env.SOUL_OFFLINE) === "1") return undefined;
  const opts = { encoding: "utf8", timeout: 8_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true } as const;
  const gh = spawnSync("gh", ["api", "--hostname", "github.com", endpoint], opts);
  const result = gh.status === 0 ? gh : spawnSync("curl", ["-q", "-fsS", `https://api.github.com/${endpoint}`], opts);
  if (result.status === 0) return JSON.parse(result.stdout) as unknown;
  return undefined;
};

function readSkillCommit(repo: string, ref: string, request: SkillSourceRequest) {
  if (!isGitHubSkillRepo(repo)) return undefined;
  const data = request(`repos/${repo}/commits/${encodeURIComponent(ref)}`) as {
    sha?: unknown; commit?: { tree?: { sha?: unknown } };
  } | undefined;
  if (typeof data?.sha !== "string" || !commitSha.test(data.sha) ||
      (commitSha.test(ref) && ref !== data.sha)) return undefined;
  const tree = data.commit?.tree?.sha;
  return { sha: data.sha, tree: typeof tree === "string" && commitSha.test(tree) ? tree : undefined };
}

export function resolveSkillCommit(repo: string, ref: string, request: SkillSourceRequest = requestSkillSource): string | undefined {
  try { return readSkillCommit(repo, ref, request)?.sha; } catch { return undefined; }
}

function installedSkillBlob(dir: string): string | undefined {
  try {
    const file = join(dir, "SKILL.md");
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) return undefined;
    const bytes = readFileSync(file);
    return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  } catch { return undefined; }
}

/** Only attribute the install to a revision when its SKILL.md matches the Git blob. */
export function recordSkillSource(dir: string, repo: string, path: string, ref: string, blob: string): boolean {
  if (!isGitHubSkillRepo(repo) || !validSkillPath(path) || !commitSha.test(ref) ||
      !commitSha.test(blob) || installedSkillBlob(dir) !== blob) return false;
  try {
    return writeSourceFile(dir, repo, path, ref, skillContentDigest(dir));
  } catch {
    return false;
  }
}

type GitTreeEntry = { path: string; mode: string; sha: string };

function readSkillTree(repo: string, tree: string, request: SkillSourceRequest, recursive = false): GitTreeEntry[] {
  const data = request(`repos/${repo}/git/trees/${tree}${recursive ? "?recursive=1" : ""}`) as {
    tree?: GitTreeEntry[]; truncated?: boolean;
  } | undefined;
  if (!Array.isArray(data?.tree) || data.truncated !== false ||
      !data.tree.every(row => typeof row?.path === "string" && row.path !== "." && validSkillPath(row.path) &&
        typeof row.mode === "string" && /^(040000|100644|100755|120000|160000)$/.test(row.mode) &&
        typeof row.sha === "string" && commitSha.test(row.sha))) {
    throw new Error("Could not read a complete upstream Git tree");
  }
  return data.tree;
}

/** Resolve exact paths of newly installed skills by matching their SKILL.md blobs. */
export function trackInstalledSkills(
  repo: string, ref: string, installDirs: string[], request = requestSkillSource,
): void {
  if (!installDirs.length) return;
  try {
    const commit = readSkillCommit(repo, ref, request);
    if (!commit?.tree) return;
    const candidates = readSkillTree(repo, commit.tree, request, true).filter(row =>
      /^100/.test(row.mode) && (row.path === "SKILL.md" || row.path.endsWith("/SKILL.md")));
    for (const dir of installDirs) {
      const blob = installedSkillBlob(dir);
      const matches = candidates.filter(row => row.sha === blob);
      if (matches.length !== 1) continue;
      const row = matches[0]!;
      recordSkillSource(dir, repo, row.path === "SKILL.md" ? "." : row.path.slice(0, -"/SKILL.md".length), commit.sha, row.sha);
    }
  } catch { /* Provenance is unavailable; do not make a claim from an uncertain path. */ }
}

export function previewSkillUpdate(dir: string, request = requestSkillSource) {
  const source = readSourceFile(dir);
  if (!source?.sha256 || !source.ref) throw new Error("No exact provenance for this installed skill");
  const { repo, skillPath, ref: from, sha256 } = source;
  const localModified = skillContentDigest(dir) !== sha256;
  const latest = readSkillCommit(repo, "HEAD", request);
  if (!latest?.tree) throw new Error("Could not resolve the upstream default branch");
  const result = { repo, skillPath, from, to: latest.sha, localModified,
    added: [] as string[], modified: [] as string[], removed: [] as string[] };
  if (from === latest.sha) return result;
  const baseline = readSkillCommit(repo, from, request);
  if (!baseline?.tree) throw new Error("Could not resolve the recorded upstream revision");
  const filesAt = (rootTree: string) => {
    let tree = rootTree;
    for (const part of skillPath === "." ? [] : skillPath.split("/")) {
      const child = readSkillTree(repo, tree, request).find(row => row.mode === "040000" && row.path === part);
      if (!child) return new Map<string, string>();
      tree = child.sha;
    }
    return new Map(readSkillTree(repo, tree, request, true).filter(row => row.mode !== "040000")
      .map(row => [row.path, `${row.mode}:${row.sha}`]));
  };
  const before = filesAt(baseline.tree);
  if (!before.has("SKILL.md")) throw new Error("The recorded upstream skill path does not contain SKILL.md");
  const after = filesAt(latest.tree);
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    if (!before.has(path)) result.added.push(path);
    else if (!after.has(path)) result.removed.push(path);
    else if (before.get(path) !== after.get(path)) result.modified.push(path);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Doctor integration
// ---------------------------------------------------------------------------

export interface IncompleteSkill {
  id: string;
  dir: string;
  declared: string[];
  missing: string[];
}

export function findIncompleteSkills(skillsRoot: string): IncompleteSkill[] {
  const incomplete: IncompleteSkill[] = [];
  if (!existsSync(skillsRoot)) return incomplete;

  const categories = readdirSync(skillsRoot, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith("."));

  for (const cat of categories) {
    const catDir = join(skillsRoot, cat.name);
    const skills = readdirSync(catDir, { withFileTypes: true }).filter(d => d.isDirectory());

    for (const skill of skills) {
      const skillDir = join(catDir, skill.name);
      const skillMd = join(skillDir, "SKILL.md");
      const companions = parseCompanionsField(skillMd);
      if (!companions || companions.length === 0) continue;

      const missing = companions.filter(c => {
        const name = c.replace(/\/$/, "");
        return !existsSync(join(skillDir, name));
      });

      if (missing.length > 0) {
        incomplete.push({ id: `${cat.name}/${skill.name}`, dir: skillDir, declared: companions, missing });
      }
    }
  }
  return incomplete;
}
