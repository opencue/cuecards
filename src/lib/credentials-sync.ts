/**
 * credentials-sync — heal OAuth refresh-token rotation desync between an
 * authmux account snapshot (`~/.claude-accounts/<name>/.credentials.json`)
 * and the cue runtimes (`~/.config/cue/runtime/<key>/claude/`, where `<key>` is
 * `<profile>` or, for an authmux account launch, `<profile>@<account>`).
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
 * `<key>/claude/.credentials.json` (`<key>` = `<profile>` or `<profile>@<account>`)
 * belonging to the same `accountUuid`, pick the one with the highest `expiresAt`,
 * and copy it back to the source so the materializer's overlay step sees fresh
 * tokens.
 *
 * Pure surface — caller injects fs-rooted paths so this is testable without
 * touching `~/`.
 */

import { readFile, readdir, copyFile, rename, rm, stat } from "node:fs/promises";
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
 * Walk `<runtimeRoot>/<key>/claude/` for every existing runtime entry (`<key>`
 * is `<profile>` or, for an authmux account launch, `<profile>@<account>`) and
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

  const results = await Promise.all(
    dirs.map(async (profile) => {
      const claudeDir = join(runtimeRoot, profile, "claude");
      try {
        const st = await stat(claudeDir);
        if (!st.isDirectory()) return null;
      } catch {
        return null;
      }
      const cand = await readCredentials(claudeDir);
      if (!cand) return null;
      if (cand.accountUuid !== targetUuid) return null;
      if (cand.refreshToken.length === 0) return null;
      return cand;
    }),
  );
  return results.filter((c): c is FreshestCandidate => c !== null);
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

  // Write atomically (tmp + rename, same dir → same filesystem) so a crash or a
  // concurrent reader never observes a half-written credentials file. Mirrors
  // the tmp+rename pattern used by rescueRuntimeCredentials.
  const tmp = `${sourcePath}.cue-sync.${process.pid}`;
  try {
    await copyFile(freshest.path, tmp);
    await rename(tmp, sourcePath);
    return { synced: true, from: freshest.path, expiresAt: freshest.expiresAt };
  } catch {
    try { await rm(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    return { synced: false };
  }
}

/**
 * Adopt the owning account's credentials when they are fresher than this
 * runtime's — the mirror image of `rescueRuntimeCredentials`.
 *
 * Why a *running* session needs this: two concurrent sessions on different
 * profiles hold separate copies of one refresh token, and Anthropic rotates
 * that token on every refresh. The moment one refreshes, the other's copy is
 * revoked, and its next refresh drops the user into a login prompt mid-session.
 * The refresher publishes its new token to the account dir (that is
 * `rescueRuntimeCredentials`); this is how the other session hears about it.
 *
 * Symlinking the runtimes at one shared file would be the obvious fix and does
 * not work: Claude Code rewrites `.credentials.json` atomically (tmp → rename),
 * which replaces a symlink with a regular file on the first refresh. Observable
 * in any authmux runtime, where cue symlinks `.claude.json` and every one has
 * since become a plain file while its neighbours (`projects/`, `agents/`) are
 * still links.
 *
 * Only ever adopts from a dir claiming the same `accountUuid`, so alternating
 * accounts can't hand each other tokens. Atomic tmp+rename write, mirroring the
 * other writers here, so a concurrent reader never sees a partial file.
 */
export async function pullFreshestToRuntime(
  runtimeClaudeDir: string,
  accountDirs: string[],
): Promise<{ pulled: false } | { pulled: true; from: string; expiresAt: number }> {
  const mine = await readCredentials(runtimeClaudeDir);
  // No credentials, or no identity to match on — never guess which account a
  // runtime belongs to; adopting the wrong one pairs tokens with an identity
  // that doesn't own them.
  if (!mine?.accountUuid) return { pulled: false };

  let best: { path: string; expiresAt: number } | undefined;
  for (const dir of accountDirs) {
    if ((await readAccountUuid(dir)) !== mine.accountUuid) continue;
    const owner = await readCredentials(dir);
    if (!owner || owner.refreshToken.trim().length === 0) continue;
    if (owner.expiresAt <= mine.expiresAt) continue;
    if (!best || owner.expiresAt > best.expiresAt) {
      best = { path: owner.path, expiresAt: owner.expiresAt };
    }
  }
  if (!best) return { pulled: false };

  const target = join(runtimeClaudeDir, ".credentials.json");
  const tmp = `${target}.cue-pull.${process.pid}`;
  try {
    await copyFile(best.path, tmp);
    await rename(tmp, target);
    return { pulled: true, from: best.path, expiresAt: best.expiresAt };
  } catch {
    try { await rm(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    return { pulled: false };
  }
}

/**
 * Bring a live session's tokens and its account dir back into agreement, in
 * whichever direction is stale.
 *
 * Push first: if we hold the newest token, publish it before adopting anything,
 * so a sibling reconciler running at the same moment can only ever move tokens
 * forward. Both directions are gated on *strictly* newer `expiresAt`, so once
 * the pair agrees neither writes again — two reconcilers polling each other
 * settle instead of trading the file back and forth.
 */
export async function reconcileCredentials(
  runtimeClaudeDir: string,
  accountDirs: string[],
): Promise<{ pushed: string[]; pulled?: string }> {
  const pushed: string[] = [];
  const push = await rescueRuntimeCredentials(runtimeClaudeDir, accountDirs);
  if (push.rescued) pushed.push(push.to);

  const pull = await pullFreshestToRuntime(runtimeClaudeDir, accountDirs);
  return pull.pulled ? { pushed, pulled: pull.from } : { pushed };
}

/**
 * Known Claude account dirs a runtime's credentials could belong to:
 * `~/.claude` plus every `~/.claude-accounts/<name>` (authmux's parallel
 * account convention — the CLAUDE_CONFIG_DIRs its claude-<name> aliases set).
 */
export async function listKnownAccountDirs(homeDir: string): Promise<string[]> {
  const dirs = [join(homeDir, ".claude")];
  const parallelRoot = join(homeDir, ".claude-accounts");
  try {
    for (const name of await readdir(parallelRoot)) {
      const p = join(parallelRoot, name);
      try {
        if ((await stat(p)).isDirectory()) dirs.push(p);
      } catch { /* unreadable entry — skip */ }
    }
  } catch { /* no parallel accounts */ }
  return dirs;
}

/**
 * Write a runtime's login-fresh credentials back to the account dir that
 * OWNS them (matched by accountUuid).
 *
 * Why this exists: `/login` inside a cue-launched session writes tokens into
 * the per-PROFILE runtime dir, not the account's CLAUDE_CONFIG_DIR. The heal
 * in `syncFreshestToSource` only runs at the next launch *of that same
 * account* — but runtimes are shared per profile, so when a DIFFERENT
 * account launches the profile first, the account-identity guard discards
 * the runtime's `.claude.json`/`.credentials.json`. Anthropic rotates the
 * refresh token on every refresh, so that discarded copy was the only live
 * token for the account: its source still holds a dead one → forced re-login
 * every time two accounts alternate on one profile. Calling this before
 * materialization (and after the session exits) returns the tokens home
 * before they can be destroyed.
 *
 * Strictness rules mirror `syncFreshestToSource`:
 *   - runtime must have a readable accountUuid and non-empty refreshToken
 *   - the owner dir's uuid must match exactly
 *   - copy only when the runtime's expiresAt is *strictly* newer
 *   - copy is tmp + atomic rename so a concurrent reader never sees a
 *     partial file
 */
export async function rescueRuntimeCredentials(
  runtimeClaudeDir: string,
  accountDirs: string[],
): Promise<{ rescued: false } | { rescued: true; to: string; expiresAt: number }> {
  const cand = await readCredentials(runtimeClaudeDir);
  if (!cand || !cand.accountUuid || cand.refreshToken.trim().length === 0) return { rescued: false };

  const readOwnerExpiresAt = async (dir: string): Promise<number> => {
    try {
      const raw = await readFile(join(dir, ".credentials.json"), "utf8");
      const parsed = JSON.parse(raw) as CredentialsBlob;
      return parsed?.claudeAiOauth?.expiresAt ?? 0;
    } catch {
      return 0; // missing/corrupt — anything is better
    }
  };

  // Heal EVERY dir claiming this uuid, not just the first match — `~/.claude`
  // and an authmux account dir can both hold the same account, and stopping
  // at the first would leave the other with a dead rotated token.
  const rescuedTo: string[] = [];
  for (const dir of accountDirs) {
    const ownerUuid = await readAccountUuid(dir);
    if (ownerUuid !== cand.accountUuid) continue;
    if (cand.expiresAt <= await readOwnerExpiresAt(dir)) continue;

    const dest = join(dir, ".credentials.json");
    try {
      // tmp lives next to dest so the rename is same-device atomic; the
      // cross-device step (runtime → account dir) is the copyFile into tmp,
      // which a concurrent reader never sees.
      const tmp = `${dest}.cue-rescue.${process.pid}`;
      await copyFile(cand.path, tmp);
      // Re-check freshness right before the swap: the owning account may have
      // a LIVE session rotating tokens concurrently. A fresher token landing
      // between the check above and this rename must win. (A write inside
      // this final window can still lose — Claude Code's own writes are
      // atomic renames too, so the loser is a whole consistent file, and the
      // next launch's heal repairs it.)
      if (cand.expiresAt <= await readOwnerExpiresAt(dir)) {
        await rm(tmp, { force: true });
        continue;
      }
      await rename(tmp, dest);
      rescuedTo.push(dest);
    } catch { /* best-effort per dir — keep trying the others */ }
  }

  if (rescuedTo.length === 0) return { rescued: false };
  return { rescued: true, to: rescuedTo.join(", "), expiresAt: cand.expiresAt };
}
