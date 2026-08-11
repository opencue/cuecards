import { chmod, copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";

async function authFreshness(path: string): Promise<number | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return undefined;
    if (!("tokens" in parsed) && !("OPENAI_API_KEY" in parsed) && !("auth_mode" in parsed)) return undefined;
    const refreshed = typeof parsed.last_refresh === "string" ? Date.parse(parsed.last_refresh) : Number.NaN;
    return Number.isFinite(refreshed) ? refreshed : (await stat(path)).mtimeMs;
  } catch {
    return undefined;
  }
}

/** Atomically copy Codex auth only when the source is valid and newer. */
export async function syncCodexAuth(source: string, destination: string): Promise<boolean> {
  try {
    const src = await authFreshness(source);
    if (src === undefined) return false;
    const dst = await authFreshness(destination);
    if (dst !== undefined && dst >= src) return false;

    await mkdir(dirname(destination), { recursive: true });
    const tmp = `${destination}.cue-auth.${process.pid}.${Date.now().toString(36)}`;
    try {
      await copyFile(source, tmp);
      await chmod(tmp, 0o600);
      await rename(tmp, destination);
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => {});
      throw error;
    }
    return true;
  } catch {
    return false;
  }
}

export async function codexAuthFreshness(path: string): Promise<number | undefined> {
  return authFreshness(path);
}
