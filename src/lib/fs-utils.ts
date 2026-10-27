/**
 * Shared filesystem utility helpers.
 *
 * These tiny async helpers appeared identically in profile-generator.ts,
 * resolver-plugins.ts, and profile-loader.ts. Centralised here so all
 * three can import from one place and the implementations stay in sync.
 */
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function isFile(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve the real path of `p`, falling back to `p` unchanged if the path
 * cannot be resolved (e.g. a broken symlink or a permissions error).
 */
export async function safeRealpath(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return p;
  }
}

/**
 * Expand a leading `~` or `~/` to the user's home directory.
 * A bare `~` expands to `homedir()`; `~/foo` expands to `<home>/foo`.
 * Any other path is returned unchanged.
 */
export function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}
