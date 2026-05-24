/**
 * credentials-sync — heal OAuth refresh-token rotation desync between an
 * authmux account snapshot (`~/.claude-accounts/<name>/.credentials.json`)
 * and the per-profile cue runtimes (`~/.config/cue/runtime/<profile>/claude/`).
 *
 * The problem
 * -----------
 * Anthropic's OAuth rotates the refresh token on every refresh. cue
 * materializes a separate `.credentials.json` per profile (so concurrent
 * sessions don't clobber each other's session state). When profile A
 * refreshes mid-session, the previous refresh token is revoked — meaning
 * every other profile's copy (and the source snapshot) now holds a dead
 * refresh token. Spinning up a new profile from that stale source forces
 * the user to re-login.
 *
 * The fix
 * -------
 * Before materialization, scan the source dir + every existing runtime
 * `<profile>/claude/.credentials.json` belonging to the same `accountUuid`,
 * pick the one with the highest `expiresAt`, and copy it back to the source
 * so the materializer's overlay step sees fresh tokens.
 *
 * Pure surface — caller injects fs-rooted paths so this is testable without
 * touching `~/`.
 */

import { readFile, readdir, copyFile, stat } from "node:fs/promises";
import { join } from "node:path";

interface CredentialsBlob {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
  };
}

interface ClaudeJsonBlob {
  oauthAccount?: {
    accountUuid?: string;
    emailAddress?: string;
  };
}

export interface FreshestCandidate {
  path: string;
  expiresAt: number;
  refreshToken: string;
  accountUuid: string | undefined;
}

/**
 * Read the `accountUuid` recorded in `<dir>/.claude.json`. Returns undefined
 * if the file is missing or doesn't have the OAuth metadata.
 */
async function readAccountUuid(dir: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(dir, ".claude.json"), "utf8");
    const parsed = JSON.parse(raw) as ClaudeJsonBlob;
    return parsed?.oauthAccount?.accountUuid;
  } catch {
    return undefined;
  }
}

/**
 * Read `<dir>/.credentials.json` and return the fields we care about.
 * Returns undefined if the file is missing or unparseable.
 */
async function readCredentials(dir: string): Promise<FreshestCandidate | undefined> {
  const path = join(dir, ".credentials.json");
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as CredentialsBlob;
    const oauth = parsed?.claudeAiOauth;
    if (!oauth) return undefined;
    return {
      path,
      expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : 0,
      refreshToken: typeof oauth.refreshToken === "string" ? oauth.refreshToken : "",
      accountUuid: await readAccountUuid(dir),
    };
  } catch {
    return undefined;
  }
}

/**
 * Walk `<runtimeRoot>/<profile>/claude/` for every existing profile and
 * collect candidates whose `accountUuid` matches `targetUuid`.
 *
 * Strictness rules (keep these — they prevent cross-account contamination):
 *   1. If `targetUuid` is known, the candidate's accountUuid MUST match it.
 *      A candidate with no `.claude.json` (undefined accountUuid) is skipped:
 *      its `.credentials.json` could be a symlink pointing back into a
 *      different account's source dir, and we have no way to verify it
 *      belongs to the target account.
 *   2. If `targetUuid` is unknown (the source dir has no `.claude.json` —
 *      e.g. a fresh, empty profile), we conservatively return [] rather
 *      than mixing tokens from random accounts. Caller falls back to source.
 */
async function collectRuntimeCandidates(
  runtimeRoot: string,
  targetUuid: string | undefined,
): Promise<FreshestCandidate[]> {
  if (!targetUuid) return [];

  let dirs: string[];
  try {
    dirs = await readdir(runtimeRoot);
  } catch {
    return [];
  }

  const out: FreshestCandidate[] = [];
  for (const profile of dirs) {
    const claudeDir = join(runtimeRoot, profile, "claude");
    try {
      const st = await stat(claudeDir);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    const cand = await readCredentials(claudeDir);
    if (!cand) continue;
    // Strict uuid match — must equal the target. Undefined uuids are treated
    // as "unknown account" and skipped because the credentials file may be
    // a symlink pointing into a different account's storage.
    if (cand.accountUuid !== targetUuid) continue;
    if (cand.refreshToken.length === 0) continue;
    out.push(cand);
  }
  return out;
}

/**
 * Find the freshest `.credentials.json` for the account anchored at
 * `sourceDir`. Looks in:
 *   - sourceDir itself
 *   - every `<runtimeRoot>/<profile>/claude/` whose `.claude.json` reports
 *     the same accountUuid as sourceDir
 *
 * Returns the candidate with the highest `expiresAt`, or undefined if no
 * usable candidates exist (no creds anywhere — caller falls back to source
 * which the materializer already handles).
 */
export async function findFreshestCredentials(
  sourceDir: string,
  runtimeRoot: string,
): Promise<FreshestCandidate | undefined> {
  const targetUuid = await readAccountUuid(sourceDir);
  const candidates: FreshestCandidate[] = [];

  const sourceCand = await readCredentials(sourceDir);
  if (sourceCand) candidates.push(sourceCand);

  const runtimeCands = await collectRuntimeCandidates(runtimeRoot, targetUuid);
  candidates.push(...runtimeCands);

  if (candidates.length === 0) return undefined;

  candidates.sort((a, b) => b.expiresAt - a.expiresAt);
  return candidates[0];
}

/**
 * If the freshest credential blob lives somewhere other than `sourceDir`,
 * copy it back to source so the next materialize step picks up live tokens.
 *
 * Returns:
 *   - { synced: true,  from } when source was healed
 *   - { synced: false } when source was already freshest (or no candidates)
 *
 * Failures are swallowed and reported as `synced: false` — this is a
 * best-effort heal. Materialization will still proceed.
 */
export async function syncFreshestToSource(
  sourceDir: string,
  runtimeRoot: string,
): Promise<{ synced: false } | { synced: true; from: string; expiresAt: number }> {
  const freshest = await findFreshestCredentials(sourceDir, runtimeRoot);
  if (!freshest) return { synced: false };

  const sourcePath = join(sourceDir, ".credentials.json");
  if (freshest.path === sourcePath) return { synced: false };

  // Only copy if the freshest candidate is *strictly* newer than source.
  // Equal expiresAt → keep source untouched (no benefit, avoids needless writes).
  let sourceExpiresAt = 0;
  try {
    const raw = await readFile(sourcePath, "utf8");
    const parsed = JSON.parse(raw) as CredentialsBlob;
    sourceExpiresAt = parsed?.claudeAiOauth?.expiresAt ?? 0;
  } catch { /* missing — anything is better */ }

  if (freshest.expiresAt <= sourceExpiresAt) return { synced: false };

  try {
    await copyFile(freshest.path, sourcePath);
    return { synced: true, from: freshest.path, expiresAt: freshest.expiresAt };
  } catch {
    return { synced: false };
  }
}
