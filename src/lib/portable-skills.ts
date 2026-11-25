import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { NpxSkillRef } from "../../profiles/_types";
import { configDir } from "./config-paths";

export const MAX_PORTABLE_BYTES = 16 * 1024 * 1024;
const maxSkillBytes = 4 * 1024 * 1024;
const maxSkillFiles = 500;
const windowsModeFile = ".cue-portable-executable.json";
const slug = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const commit = /^[a-f0-9]{40}$/i;
const pinned = /^git@[a-f0-9]{40}$/i;
const repository = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const portableRef = /^portable-([a-f0-9]{64})\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})$/;

type SkillFile = { path: string; data: string; executable: boolean };
export type PortableSkill = { id: string; sha256: string; files: SkillFile[] };

export function importedProfilesDir(): string {
  return join(configDir(), "imported-profiles");
}

function segmentAllowed(part: string): boolean {
  return /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,159}$/.test(part) && !part.endsWith(".")
    && !/^(?:con|aux|nul|prn|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part);
}

export function portableResourcePath(path: string): boolean {
  return path.length <= 512 && path.split("/").every(segmentAllowed);
}

function isShareablePath(path: string): boolean {
  return portableResourcePath(path) && path.split("/").every(part =>
    !/^(?:node_modules|__pycache__|(?:auth|tokens)\.json$|credentials?(?:[._-]|$)|secrets?(?:[._-]|$)|id_(?:rsa|ed25519)(?:[._-]|$))/i.test(part)
    && !/\.(?:pem|key|p12|pfx|keystore)$/i.test(part));
}

function hash(files: SkillFile[]): string {
  return createHash("sha256").update(JSON.stringify(files.map(({ path, data, executable }) =>
    [path, data, executable]))).digest("hex");
}

// Windows has no portable POSIX executable bit. Keep those bits as private,
// checksum-covered snapshot metadata there, rather than discarding them.
function readWindowsModes(root: string): Set<string> {
  const file = join(root, windowsModeFile);
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return new Set();
  if (!stat.isFile() || stat.size > maxSkillFiles * 520) throw new Error("Invalid portable skill mode list");
  const paths: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(paths) || paths.length > maxSkillFiles
    || !paths.every(path => typeof path === "string" && isShareablePath(path))) {
    throw new Error("Invalid portable skill mode list");
  }
  return new Set(paths);
}

function readFiles(root: string, managed: boolean): SkillFile[] {
  if (!lstatSync(root).isDirectory()) throw new Error("Skill is not a regular directory");
  const modes = managed && process.platform === "win32" ? readWindowsModes(root) : undefined;
  let bytes = 0;
  const files: SkillFile[] = [];
  function walk(prefix: string): void {
    for (const entry of readdirSync(join(root, prefix))) {
      const path = prefix ? `${prefix}/${entry}` : entry;
      if (modes && path === windowsModeFile) continue;
      if (!isShareablePath(path)) {
        if (!managed) continue;
        throw new Error("Unexpected file in portable skill snapshot");
      }
      const file = join(root, path);
      const stat = lstatSync(file);
      if (stat.isDirectory()) walk(path);
      else {
        bytes += stat.size;
        if (!stat.isFile() || files.length >= maxSkillFiles || bytes > maxSkillBytes) {
          throw new Error(`Skill file must be regular and within the bundle size limit: ${path}`);
        }
        files.push({
          path, data: readFileSync(file).toString("base64"),
          executable: modes ? modes.has(path) : !!(stat.mode & 0o111),
        });
      }
    }
  }
  walk("");
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (!files.some(file => file.path === "SKILL.md")) throw new Error("Portable skill is missing SKILL.md");
  return files;
}

export function snapshotPortableSkill(id: string, root: string): PortableSkill {
  const files = readFiles(root, isPortableSkillRef(id));
  return { id, sha256: hash(files), files };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function validatePortableSkill(value: unknown): PortableSkill {
  const entry = asRecord(value);
  if (!entry || typeof entry.id !== "string" || !portableResourcePath(entry.id)
    || !slug.test(entry.id.split("/").at(-1)!)
    || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)
    || !Array.isArray(entry.files) || entry.files.length > maxSkillFiles) {
    throw new Error("Invalid portable skill manifest");
  }
  const paths = new Set<string>();
  let bytes = 0;
  const files = entry.files.map((raw: unknown): SkillFile => {
    const file = asRecord(raw);
    if (!file || typeof file.path !== "string" || !isShareablePath(file.path)
      || typeof file.data !== "string" || typeof file.executable !== "boolean") {
      throw new Error("Invalid portable skill file");
    }
    const data = Buffer.from(file.data, "base64");
    bytes += data.length;
    const key = file.path.toLowerCase();
    if (bytes > maxSkillBytes || data.toString("base64") !== file.data || paths.has(key)) {
      throw new Error("Portable skill data exceeds limits or contains duplicate/invalid files");
    }
    paths.add(key);
    return { path: file.path, data: file.data, executable: file.executable };
  });
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const dirs = new Map<string, string>();
  for (const { path } of files) {
    const parts = path.split("/");
    while (parts.length > 1) {
      parts.pop();
      const dir = parts.join("/");
      const lower = dir.toLowerCase();
      if (paths.has(lower) || (dirs.has(lower) && dirs.get(lower) !== dir)) {
        throw new Error("Portable skill contains a file/directory or case collision");
      }
      dirs.set(lower, dir);
    }
  }
  if (!files.some(file => file.path === "SKILL.md") || hash(files) !== entry.sha256) {
    throw new Error("Portable skill checksum does not match its files");
  }
  return { id: entry.id, sha256: entry.sha256, files };
}

export function portableSkillRef(skill: PortableSkill): string {
  return `portable-${skill.sha256}/${skill.id.split("/").at(-1)}`;
}

function skillPath(ref: string): string | undefined {
  const match = portableRef.exec(ref);
  return match ? join(configDir(), "portable-skills", match[1]!, match[2]!) : undefined;
}

export function isPortableSkillRef(ref: string): boolean {
  return portableRef.test(ref);
}

export function resolvePortableSkill(ref: string): string | undefined {
  const dir = skillPath(ref);
  if (!dir) return undefined;
  const expected = portableRef.exec(ref)![1];
  if (hash(readFiles(dir, true)) !== expected) throw new Error("Portable skill checksum mismatch; re-import the original bundle");
  return dir;
}

export function portableSkillState(skill: PortableSkill): "new" | "reuse" | "conflict" {
  const ref = portableSkillRef(skill);
  try {
    lstatSync(skillPath(ref)!);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? "new" : "conflict";
  }
  try {
    return resolvePortableSkill(ref) ? "reuse" : "conflict";
  } catch {
    return "conflict";
  }
}

export function installPortableSkill(skill: PortableSkill): void {
  const ref = portableSkillRef(skill);
  const dest = skillPath(ref)!;
  const state = portableSkillState(skill);
  if (state === "reuse") return;
  if (state === "conflict") throw new Error(`Will not replace a corrupt or unexpected snapshot: ${skill.id}`);
  mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
  const staged = mkdtempSync(join(dirname(dest), ".import-"));
  try {
    for (const { path, data, executable } of skill.files) {
      const file = join(staged, path);
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, Buffer.from(data, "base64"), { flag: "wx", mode: executable ? 0o700 : 0o600 });
    }
    if (process.platform === "win32") {
      const executables = skill.files.filter(file => file.executable).map(file => file.path);
      if (executables.length) {
        writeFileSync(join(staged, windowsModeFile), JSON.stringify(executables), { flag: "wx", mode: 0o600 });
      }
    }
    try { renameSync(staged, dest); }
    catch (error) { if (portableSkillState(skill) !== "reuse") throw error; }
  } finally {
    rmSync(staged, { force: true, recursive: true });
  }
}

export function isPinnedRemoteSkill(skill: NpxSkillRef): boolean {
  return repository.test(skill.repo) && pinned.test(skill.pin ?? "") && skill.skills.every(id => slug.test(id));
}

export async function pinRemoteSkill(skill: NpxSkillRef): Promise<NpxSkillRef> {
  if (!repository.test(skill.repo) || !skill.skills.every(id => slug.test(id))) {
    throw new Error("Portable remote skills require a GitHub owner/repository and valid skill names");
  }
  if (isPinnedRemoteSkill(skill)) return skill;
  if ((process.env.CUE_OFFLINE ?? process.env.SOUL_OFFLINE) === "1") {
    throw new Error(`Pin ${skill.repo} to a full Git commit before exporting offline`);
  }
  const ref = skill.pin?.replace(/^(git|tag)@/, "") ?? "HEAD";
  const matches = (value: unknown): value is string => typeof value === "string" && commit.test(value)
    && (!skill.pin?.startsWith("git@") || value.toLowerCase().startsWith(ref.toLowerCase()));
  const endpoint = `repos/${skill.repo}/commits/${encodeURIComponent(ref)}`;
  let sha: unknown;
  try {
    const response = await fetch(`https://api.github.com/${endpoint}`, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) sha = asRecord(await response.json())?.sha;
  } catch { /* gh can use a configured account or a different network proxy */ }
  if (!matches(sha)) {
    const result = spawnSync("gh", ["api", "--hostname", "github.com", endpoint, "--jq", ".sha"], {
      encoding: "utf8", timeout: 8_000, maxBuffer: 1024, windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status === 0) sha = result.stdout.trim();
  }
  if (!matches(sha)) {
    throw new Error(`Could not pin ${skill.repo}; set \`pin: git@<40-character commit>\` in the source profile`);
  }
  return { ...skill, pin: `git@${sha.toLowerCase()}` };
}
