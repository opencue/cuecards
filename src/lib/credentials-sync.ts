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

import { chmod, copyFile, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

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
 * Read the `accountUuid` recorded in `<dir>/.claude.json`, falling back to the
 * home-root `.claude.json` one level up when `dir` is a `.claude` config dir
 * whose own file carries no identity.
 *
 * The fallback is load-bearing, not a nicety. With no CLAUDE_CONFIG_DIR set,
 * Claude Code keeps `oauthAccount` in `~/.claude.json` and leaves
 * `~/.claude/.claude.json` as a settings-only stub (`firstStartTime`,
 * `userID`, …). Reading only in-dir therefore reports the DEFAULT account as
 * "unknown" — and every heal in this module is gated on a known uuid, so all
 * three directions silently no-op for it: `syncFreshestToSource` returns no
 * candidates, `rescueRuntimeCredentials` never publishes to `~/.claude`, and
 * `pullFreshestToRuntime` never adopts from it. The runtimes then diverge into
 * one dead rotated token each, which is the exact desync this module exists to
 * fix. authmux account dirs and runtime dirs all carry identity in-dir, so the
 * `basename` gate keeps the fallback off them.
 *
 * Mirrors the legacy home-root fallback in runtime-materializer's
 * `overlaySourceState`; keep the two in step.
 *
 * Returns undefined when neither file exists or has the OAuth metadata.
 */
async function readAccountUuid(dir: string): Promise<string | undefined> {
  const uuidAt = async (path: string): Promise<string | undefined> => {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as ClaudeJsonBlob;
      return parsed?.oauthAccount?.accountUuid;
    } catch {
      return undefined;
    }
  };

  const inDir = await uuidAt(join(dir, ".claude.json"));
  if (inDir) return inDir;
  if (basename(dir) === ".claude") return await uuidAt(join(dirname(dir), ".claude.json"));
  return undefined;
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
 * Expiry staggering — stop concurrent sessions from racing for one rotation.
 *
 * Every copy of a credential blob carries the same `expiresAt`, so N sessions
 * reach expiry in the same instant, all present the same refresh token, and
 * Anthropic honours exactly one. The rest hold a revoked token and land on a
 * login prompt. Polling faster narrows that window but cannot close it — cue
 * does not perform the refresh, so it has no point at which to serialize the
 * callers (see `nextReconcileDelayMs`).
 *
 * What cue *can* control is when each session believes its token expires. Every
 * copy cue writes into a runtime gets its expiry pulled forward by a
 * deterministic per-runtime offset, so the runtimes reach their apparent expiry
 * minutes apart instead of together. The earliest one refreshes alone and
 * publishes; `reconcileCredentials` hands the new blob to the others well
 * before their own (later) deadline, so they never attempt a rotation of their
 * own. A simultaneous collision becomes a sequenced handoff.
 *
 * Under-reporting is the safe direction: the access token is still valid, so an
 * early refresh is an ordinary rotation. Over-reporting would hand a session a
 * dead token and is never done.
 *
 * The offset is a pure function of the runtime path, so re-writing an unchanged
 * blob is byte-identical and the same runtime keeps its slot across launches.
 */
const STAGGER_STEP_MS = 2 * 60_000;
const STAGGER_BUCKETS = 8;

/** The widest an expiry is pulled forward. */
export const MAX_STAGGER_MS = (STAGGER_BUCKETS - 1) * STAGGER_STEP_MS;

/** Never write an expiry this close to now — staggering must not fabricate an
 *  already-expired token and send every runtime to refresh at once. */
const STAGGER_FLOOR_MS = 60_000;

/**
 * What a runtime's copy of `sourceExpiresAt` should read once staggered.
 *
 * Lets a writer tell "already holds this blob, correctly staggered" from
 * "holds this blob verbatim because an older cue wrote it" — the second still
 * needs rewriting, or a fleet that predates staggering keeps rotating in
 * lockstep until every token happens to turn over.
 */
export function expectedStaggeredExpiry(sourceExpiresAt: number, runtimeKey: string): number {
  return sourceExpiresAt - staggerOffsetFor(runtimeKey);
}

/** Deterministic bucket for a runtime, from its path. FNV-1a, 32-bit. */
export function staggerOffsetFor(runtimeKey: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < runtimeKey.length; i += 1) {
    hash ^= runtimeKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % STAGGER_BUCKETS) * STAGGER_STEP_MS;
}

/**
 * Copy a credentials blob into a runtime with its expiry staggered.
 *
 * Falls back to a verbatim copy whenever staggering cannot be applied safely —
 * unparseable JSON, no OAuth block, or a true expiry already so close that the
 * offset would land in the past. Authentication must never break because a
 * latency optimisation could not be applied.
 *
 * Writes tmp + atomic rename like every other writer here, so a concurrent
 * reader never observes a partial file.
 */
export async function writeStaggeredCopy(
  sourcePath: string,
  targetPath: string,
  runtimeKey: string,
  now: number = Date.now(),
): Promise<void> {
  const tmp = `${targetPath}.cue-stagger.${process.pid}`;
  try {
    const raw = await readFile(sourcePath, "utf8");
    let out = raw;
    try {
      const parsed = JSON.parse(raw) as CredentialsBlob;
      const trueExpiresAt = parsed?.claudeAiOauth?.expiresAt;
      if (typeof trueExpiresAt === "number" && trueExpiresAt > 0) {
        const staggered = trueExpiresAt - staggerOffsetFor(runtimeKey);
        if (staggered >= now + STAGGER_FLOOR_MS) {
          parsed.claudeAiOauth!.expiresAt = staggered;
          out = JSON.stringify(parsed);
        }
      }
    } catch { /* unparseable — ship the bytes through untouched */ }

    await writeFile(tmp, out, { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, targetPath);
  } catch (error) {
    try { await rm(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw error;
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
 * Copy the owning account's fresh credentials into every stale runtime for
 * that same account.
 *
 * This is intentionally stricter than launch-time materialization:
 *   - source must have a known accountUuid and a non-empty refresh token
 *   - runtime must have the same accountUuid in its `.claude.json`
 *   - copy only moves credentials forward by `expiresAt`
 *
 * `cue auth repair` uses this to fix dormant profile runtimes. Running
 * sessions still rely on `reconcileCredentials`, but updating stale on-disk
 * copies prevents a later direct/resumed launch from starting with a revoked
 * refresh token.
 */
export async function syncSourceToRuntimes(
  sourceDir: string,
  runtimeRoot: string,
): Promise<{ updated: string[]; failed: string[] }> {
  const source = await readCredentials(sourceDir);
  if (!source?.accountUuid || source.refreshToken.trim().length === 0) {
    return { updated: [], failed: [] };
  }

  let dirs: string[];
  try {
    dirs = await readdir(runtimeRoot);
  } catch {
    return { updated: [], failed: [] };
  }

  const updated: string[] = [];
  const failed: string[] = [];
  const sourcePath = join(sourceDir, ".credentials.json");

  for (const profile of dirs) {
    const claudeDir = join(runtimeRoot, profile, "claude");
    try {
      const st = await stat(claudeDir);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }

    try {
      if ((await readAccountUuid(claudeDir)) !== source.accountUuid) continue;
      // Two distinct reasons to leave a runtime alone, and expiry alone cannot
      // tell them apart once staggering is in play:
      //
      //   - it rotated on its own and holds a token this source has not seen —
      //     never clobber that;
      //   - it already holds this very token, sitting in its stagger slot.
      //
      // A runtime holding this token at the raw source expiry is neither: that
      // is a verbatim copy from a cue that predates staggering, and it must be
      // rewritten or the whole fleet keeps rotating in lockstep.
      const held = (c: { refreshToken: string; expiresAt: number } | undefined): "newer" | "settled" | "stale" => {
        if (!c) return "stale";
        if (c.refreshToken !== source.refreshToken) {
          return c.expiresAt >= source.expiresAt ? "newer" : "stale";
        }
        return c.expiresAt === expectedStaggeredExpiry(source.expiresAt, claudeDir) ? "settled" : "stale";
      };

      const current = await readCredentials(claudeDir);
      if (held(current) !== "stale") continue;

      const target = join(claudeDir, ".credentials.json");
      try {
        // Re-read: a session may have rotated in the gap above, and its token
        // must never be clobbered by the older source blob.
        if (held(await readCredentials(claudeDir)) !== "stale") continue;

        await writeStaggeredCopy(sourcePath, target, claudeDir);
        updated.push(target);
      } catch {
        // writeStaggeredCopy cleans up its own tmp file.
        failed.push(target);
      }
    } catch {
      failed.push(claudeDir);
    }
  }

  return { updated, failed };
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
    // Our copy reports a staggered expiry, so the account dir always looks
    // newer even when it holds the very token we already have. Adopting it
    // would undo our stagger slot on every poll.
    if (owner.refreshToken === mine.refreshToken) continue;
    if (!best || owner.expiresAt > best.expiresAt) {
      best = { path: owner.path, expiresAt: owner.expiresAt };
    }
  }
  if (!best) return { pulled: false };

  const target = join(runtimeClaudeDir, ".credentials.json");
  try {
    await writeStaggeredCopy(best.path, target, runtimeClaudeDir);
    return { pulled: true, from: best.path, expiresAt: best.expiresAt };
  } catch {
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

/** Reconcile cadence away from a rotation. Token lifetimes are ~8h, so a
 *  minute of lag costs nothing for almost the whole session. */
export const RECONCILE_IDLE_MS = 60_000;

/** Cadence across the rotation window. See `nextReconcileDelayMs`. */
export const RECONCILE_ROTATION_MS = 5_000;

/** Start polling fast this long before expiry… */
const ROTATION_LEAD_MS = 10 * 60_000;
/** …and drop back this long after it, by which point any session that was
 *  going to contend for the rotation already has. */
const ROTATION_TRAIL_MS = 30 * 60_000;

/**
 * How long to wait before the next reconcile, given this runtime's access-token
 * expiry.
 *
 * Every copy of a credential blob carries the SAME `expiresAt` — they are
 * copies — so concurrent sessions all reach expiry in the same instant and
 * refresh within moments of each other. Only the first rotation succeeds; the
 * rest present a refresh token Anthropic has already revoked and land on a
 * login prompt. A flat 60s poll cannot help there: the contended window is
 * seconds wide, so the winner's new token routinely arrives after the losers
 * have already tried.
 *
 * Polling fast across that window (and only there) shrinks the gap between the
 * winner publishing and the others adopting to ~5s, which is short enough that
 * a session which hasn't refreshed yet picks up the live token first and
 * rotates cleanly off it. Away from the window the cost of a fast poll buys
 * nothing, so it stays at a minute.
 *
 * This narrows the race; it cannot close it. cue does not perform the refresh —
 * Claude Code does, in-process — so there is no point at which cue can
 * serialize the two callers. A session that refreshes inside the same few
 * seconds as the winner still loses.
 */
export function nextReconcileDelayMs(expiresAt: number, now: number): number {
  if (expiresAt <= 0) return RECONCILE_IDLE_MS; // unknown expiry — no window to track
  const inWindow = now >= expiresAt - ROTATION_LEAD_MS && now <= expiresAt + ROTATION_TRAIL_MS;
  return inWindow ? RECONCILE_ROTATION_MS : RECONCILE_IDLE_MS;
}

/**
 * `claudeAiOauth.expiresAt` for the credentials in `dir`, or 0 when absent or
 * unreadable. Feeds `nextReconcileDelayMs`.
 */
export async function readExpiresAt(dir: string): Promise<number> {
  return (await readCredentials(dir))?.expiresAt ?? 0;
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
