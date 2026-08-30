import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  findFreshestCredentials,
  listKnownAccountDirs,
  nextReconcileDelayMs,
  pullFreshestToRuntime,
  readExpiresAt,
  reconcileCredentials,
  RECONCILE_IDLE_MS,
  RECONCILE_ROTATION_MS,
  rescueRuntimeCredentials,
  staggerOffsetFor,
  syncFreshestToSource,
  syncSourceToRuntimes,
  writeStaggeredCopy,
  MAX_STAGGER_MS,
} from "./credentials-sync";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "cue-credsync-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const UUID_A = "aaaaaaaa-1111-2222-3333-444444444444";
const UUID_B = "bbbbbbbb-5555-6666-7777-888888888888";

interface Creds {
  accessToken?: string;
  refreshToken: string;
  expiresAt: number;
}

async function writeAccountDir(dir: string, uuid: string | undefined, creds: Creds | undefined): Promise<void> {
  await mkdir(dir, { recursive: true });
  if (uuid) {
    await writeFile(
      join(dir, ".claude.json"),
      JSON.stringify({ oauthAccount: { accountUuid: uuid, emailAddress: "u@example.com" } }),
    );
  }
  if (creds) {
    await writeFile(
      join(dir, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: "at-" + creds.refreshToken, ...creds } }),
    );
  }
}

/**
 * Claude Code's real layout when no CLAUDE_CONFIG_DIR is set: `oauthAccount`
 * lives in the home-root `~/.claude.json`, while `~/.claude/.claude.json` is a
 * settings-only stub. Returns the `.claude` dir to pass as source/account dir.
 */
async function writeDefaultAccountDir(home: string, uuid: string, creds: Creds): Promise<string> {
  const dir = join(home, ".claude");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".claude.json"), JSON.stringify({ firstStartTime: "t", userID: "u" }));
  await writeFile(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: uuid } }));
  await writeFile(
    join(dir, ".credentials.json"),
    JSON.stringify({ claudeAiOauth: { accessToken: "at-" + creds.refreshToken, ...creds } }),
  );
  return dir;
}

describe("home-root .claude.json fallback", () => {
  test("finds a fresher runtime for a default ~/.claude source", async () => {
    // Regression: reading identity only from `<dir>/.claude.json` reported the
    // DEFAULT account as unknown, so every heal here silently no-op'd for it and
    // the runtimes each drifted onto their own dead rotated token.
    const sourceDir = await writeDefaultAccountDir(join(root, "home"), UUID_A, {
      refreshToken: "rt-stale",
      expiresAt: 1000,
    });
    const runtimeRoot = join(root, "runtime");
    await writeAccountDir(join(runtimeRoot, "live", "claude"), UUID_A, {
      refreshToken: "rt-live",
      expiresAt: 9999,
    });

    const out = await findFreshestCredentials(sourceDir, runtimeRoot);
    expect(out?.refreshToken).toBe("rt-live");
  });

  test("adopts into a runtime from a default ~/.claude account dir", async () => {
    const accountDir = await writeDefaultAccountDir(join(root, "home"), UUID_A, {
      refreshToken: "rt-new",
      expiresAt: 9999,
    });
    const runtimeDir = join(root, "runtime", "p", "claude");
    await writeAccountDir(runtimeDir, UUID_A, { refreshToken: "rt-old", expiresAt: 1000 });

    expect((await pullFreshestToRuntime(runtimeDir, [accountDir])).pulled).toBe(true);
    const after = JSON.parse(await readFile(join(runtimeDir, ".credentials.json"), "utf8"));
    expect(after.claudeAiOauth.refreshToken).toBe("rt-new");
  });

  test("publishes a runtime's rotation back to a default ~/.claude account dir", async () => {
    const accountDir = await writeDefaultAccountDir(join(root, "home"), UUID_A, {
      refreshToken: "rt-old",
      expiresAt: 1000,
    });
    const runtimeDir = join(root, "runtime", "p", "claude");
    await writeAccountDir(runtimeDir, UUID_A, { refreshToken: "rt-rotated", expiresAt: 9999 });

    expect((await rescueRuntimeCredentials(runtimeDir, [accountDir])).rescued).toBe(true);
    const after = JSON.parse(await readFile(join(accountDir, ".credentials.json"), "utf8"));
    expect(after.claudeAiOauth.refreshToken).toBe("rt-rotated");
  });

  test("does not apply the fallback to a dir that is not named .claude", async () => {
    // authmux account dirs carry identity in-dir; a stray sibling `.claude.json`
    // must never be read as their identity, or accounts could swap tokens.
    const parent = join(root, "accounts");
    const accountDir = join(parent, "account1");
    await mkdir(accountDir, { recursive: true });
    await writeFile(join(parent, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: UUID_A } }));
    await writeFile(
      join(accountDir, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { refreshToken: "rt-other", expiresAt: 9999 } }),
    );
    const runtimeDir = join(root, "runtime", "p", "claude");
    await writeAccountDir(runtimeDir, UUID_A, { refreshToken: "rt-mine", expiresAt: 1000 });

    expect((await pullFreshestToRuntime(runtimeDir, [accountDir])).pulled).toBe(false);
  });

  test("an in-dir identity still wins over the home-root file", async () => {
    const home = join(root, "home");
    const dir = join(home, ".claude");
    await mkdir(dir, { recursive: true });
    await writeFile(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: UUID_B } }));
    await writeAccountDir(dir, UUID_A, { refreshToken: "rt-a", expiresAt: 1000 });

    const runtimeRoot = join(root, "runtime");
    await writeAccountDir(join(runtimeRoot, "live", "claude"), UUID_A, {
      refreshToken: "rt-live-a",
      expiresAt: 9999,
    });

    const out = await findFreshestCredentials(dir, runtimeRoot);
    expect(out?.refreshToken).toBe("rt-live-a");
  });
});

describe("nextReconcileDelayMs", () => {
  const EXPIRES = 8_000_000_000_000;
  const MIN = 60_000;

  test("idles at a minute far from expiry", () => {
    expect(nextReconcileDelayMs(EXPIRES, EXPIRES - 240 * MIN)).toBe(RECONCILE_IDLE_MS);
  });

  test("tightens as the shared expiry approaches", () => {
    // Every copy carries the same expiresAt, so all live sessions rotate here.
    expect(nextReconcileDelayMs(EXPIRES, EXPIRES - 5 * MIN)).toBe(RECONCILE_ROTATION_MS);
    expect(nextReconcileDelayMs(EXPIRES, EXPIRES)).toBe(RECONCILE_ROTATION_MS);
    expect(nextReconcileDelayMs(EXPIRES, EXPIRES + 5 * MIN)).toBe(RECONCILE_ROTATION_MS);
  });

  test("drops back once the window has passed", () => {
    expect(nextReconcileDelayMs(EXPIRES, EXPIRES + 120 * MIN)).toBe(RECONCILE_IDLE_MS);
  });

  test("idles when the expiry is unknown", () => {
    expect(nextReconcileDelayMs(0, EXPIRES)).toBe(RECONCILE_IDLE_MS);
  });
});

describe("readExpiresAt", () => {
  test("reads the expiry, and reports 0 when there are no credentials", async () => {
    const dir = join(root, "rt", "claude");
    await writeAccountDir(dir, UUID_A, { refreshToken: "rt", expiresAt: 4242 });
    expect(await readExpiresAt(dir)).toBe(4242);
    expect(await readExpiresAt(join(root, "nope"))).toBe(0);
  });
});

describe("findFreshestCredentials", () => {
  test("returns undefined when no credentials exist anywhere", async () => {
    const sourceDir = join(root, "source");
    await mkdir(sourceDir, { recursive: true });
    const out = await findFreshestCredentials(sourceDir, join(root, "runtime"));
    expect(out).toBeUndefined();
  });

  test("returns source when source has the highest expiresAt", async () => {
    const sourceDir = join(root, "source");
    await writeAccountDir(sourceDir, UUID_A, { refreshToken: "rt-source", expiresAt: 9999 });

    await writeAccountDir(
      join(root, "runtime", "old", "claude"),
      UUID_A,
      { refreshToken: "rt-old", expiresAt: 1000 },
    );

    const out = await findFreshestCredentials(sourceDir, join(root, "runtime"));
    expect(out).toBeDefined();
    expect(out!.path).toBe(join(sourceDir, ".credentials.json"));
    expect(out!.expiresAt).toBe(9999);
  });

  test("returns sibling runtime when it has a higher expiresAt than source", async () => {
    const sourceDir = join(root, "source");
    await writeAccountDir(sourceDir, UUID_A, { refreshToken: "rt-stale", expiresAt: 1000 });

    const freshRuntime = join(root, "runtime", "core", "claude");
    await writeAccountDir(freshRuntime, UUID_A, { refreshToken: "rt-fresh", expiresAt: 5000 });

    const out = await findFreshestCredentials(sourceDir, join(root, "runtime"));
    expect(out).toBeDefined();
    expect(out!.path).toBe(join(freshRuntime, ".credentials.json"));
    expect(out!.refreshToken).toBe("rt-fresh");
  });

  test("ignores runtime profiles with a different accountUuid", async () => {
    const sourceDir = join(root, "source");
    await writeAccountDir(sourceDir, UUID_A, { refreshToken: "rt-source", expiresAt: 1000 });

    // Different account — must NOT be picked even though it has a higher expiresAt.
    await writeAccountDir(
      join(root, "runtime", "other-acct", "claude"),
      UUID_B,
      { refreshToken: "rt-other-account", expiresAt: 9999 },
    );

    // Same account — should be picked.
    await writeAccountDir(
      join(root, "runtime", "same-acct", "claude"),
      UUID_A,
      { refreshToken: "rt-same-account", expiresAt: 5000 },
    );

    const out = await findFreshestCredentials(sourceDir, join(root, "runtime"));
    expect(out).toBeDefined();
    expect(out!.refreshToken).toBe("rt-same-account");
  });

  test("skips runtime files with empty refresh tokens", async () => {
    const sourceDir = join(root, "source");
    await writeAccountDir(sourceDir, UUID_A, { refreshToken: "rt-source", expiresAt: 1000 });

    // Higher expiresAt but empty refreshToken — must be skipped.
    await writeAccountDir(
      join(root, "runtime", "broken", "claude"),
      UUID_A,
      { refreshToken: "", expiresAt: 9999 },
    );

    const out = await findFreshestCredentials(sourceDir, join(root, "runtime"));
    expect(out!.path).toBe(join(sourceDir, ".credentials.json"));
  });

  // Regression: runtime dirs whose `.credentials.json` is a symlink into a
  // *different* account's source (cue used to symlink shared state) and which
  // therefore have no local `.claude.json` to identify the account. Without a
  // strict uuid match we'd cross-contaminate (account1's source got account2's
  // tokens during the v1 heal — this test pins the fix).
  test("skips candidates with no .claude.json even if they have credentials", async () => {
    const sourceDir = join(root, "source");
    await writeAccountDir(sourceDir, UUID_A, { refreshToken: "rt-A", expiresAt: 1000 });

    // Runtime dir without a .claude.json but with .credentials.json that
    // happens to belong to account B (e.g. a symlink into account B's storage).
    const dangerous = join(root, "runtime", "no-uuid", "claude");
    await writeAccountDir(dangerous, undefined, { refreshToken: "rt-B-stolen", expiresAt: 9999 });

    const out = await findFreshestCredentials(sourceDir, join(root, "runtime"));
    expect(out!.path).toBe(join(sourceDir, ".credentials.json"));
    expect(out!.refreshToken).toBe("rt-A");
  });

  test("returns source-only when source has no .claude.json (unknown target uuid)", async () => {
    const sourceDir = join(root, "source");
    // No .claude.json — uuid is unknown.
    await writeAccountDir(sourceDir, undefined, { refreshToken: "rt-source", expiresAt: 1000 });

    // Runtime has fresher creds for some account, but we shouldn't trust them
    // when we can't verify the source's identity.
    await writeAccountDir(
      join(root, "runtime", "any", "claude"),
      UUID_A,
      { refreshToken: "rt-runtime", expiresAt: 9999 },
    );

    const out = await findFreshestCredentials(sourceDir, join(root, "runtime"));
    expect(out!.path).toBe(join(sourceDir, ".credentials.json"));
    expect(out!.refreshToken).toBe("rt-source");
  });
});

describe("syncFreshestToSource", () => {
  test("copies freshest sibling into source when source is stale", async () => {
    const sourceDir = join(root, "source");
    await writeAccountDir(sourceDir, UUID_A, { refreshToken: "rt-stale", expiresAt: 1000 });

    await writeAccountDir(
      join(root, "runtime", "core", "claude"),
      UUID_A,
      { refreshToken: "rt-fresh", expiresAt: 5000 },
    );

    const result = await syncFreshestToSource(sourceDir, join(root, "runtime"));
    expect(result.synced).toBe(true);

    const after = JSON.parse(await readFile(join(sourceDir, ".credentials.json"), "utf8"));
    expect(after.claudeAiOauth.refreshToken).toBe("rt-fresh");
    expect(after.claudeAiOauth.expiresAt).toBe(5000);
  });

  test("does not write when source is already freshest", async () => {
    const sourceDir = join(root, "source");
    await writeAccountDir(sourceDir, UUID_A, { refreshToken: "rt-source", expiresAt: 9999 });
    await writeAccountDir(
      join(root, "runtime", "old", "claude"),
      UUID_A,
      { refreshToken: "rt-old", expiresAt: 1000 },
    );

    const result = await syncFreshestToSource(sourceDir, join(root, "runtime"));
    expect(result.synced).toBe(false);

    const after = JSON.parse(await readFile(join(sourceDir, ".credentials.json"), "utf8"));
    expect(after.claudeAiOauth.refreshToken).toBe("rt-source");
  });

  test("does nothing when no credentials exist at all", async () => {
    const sourceDir = join(root, "source");
    await mkdir(sourceDir, { recursive: true });
    const result = await syncFreshestToSource(sourceDir, join(root, "runtime"));
    expect(result.synced).toBe(false);
  });

  test("does not cross-contaminate across accountUuids", async () => {
    const sourceDir = join(root, "source");
    await writeAccountDir(sourceDir, UUID_A, { refreshToken: "rt-A", expiresAt: 1000 });
    // Different account, much fresher — must NOT overwrite source.
    await writeAccountDir(
      join(root, "runtime", "other", "claude"),
      UUID_B,
      { refreshToken: "rt-B", expiresAt: 9999 },
    );

    const result = await syncFreshestToSource(sourceDir, join(root, "runtime"));
    expect(result.synced).toBe(false);

    const after = JSON.parse(await readFile(join(sourceDir, ".credentials.json"), "utf8"));
    expect(after.claudeAiOauth.refreshToken).toBe("rt-A");
  });
});

describe("syncSourceToRuntimes", () => {
  test("updates stale and missing same-account runtimes from the source", async () => {
    const sourceDir = join(root, "source");
    await writeAccountDir(sourceDir, UUID_A, { refreshToken: "rt-source", expiresAt: 9999 });

    const stale = join(root, "runtime", "stale", "claude");
    await writeAccountDir(stale, UUID_A, { refreshToken: "rt-stale", expiresAt: 1000 });

    const missing = join(root, "runtime", "missing", "claude");
    await writeAccountDir(missing, UUID_A, undefined);

    const result = await syncSourceToRuntimes(sourceDir, join(root, "runtime"));
    expect(result.failed).toEqual([]);
    expect(result.updated.sort()).toEqual([
      join(missing, ".credentials.json"),
      join(stale, ".credentials.json"),
    ].sort());

    const staleAfter = JSON.parse(await readFile(join(stale, ".credentials.json"), "utf8"));
    const missingAfter = JSON.parse(await readFile(join(missing, ".credentials.json"), "utf8"));
    expect(staleAfter.claudeAiOauth.refreshToken).toBe("rt-source");
    expect(missingAfter.claudeAiOauth.refreshToken).toBe("rt-source");
  });

  test("does not overwrite fresher or different-account runtimes", async () => {
    const sourceDir = join(root, "source");
    await writeAccountDir(sourceDir, UUID_A, { refreshToken: "rt-source", expiresAt: 5000 });

    const fresher = join(root, "runtime", "fresher", "claude");
    await writeAccountDir(fresher, UUID_A, { refreshToken: "rt-fresher", expiresAt: 9999 });

    const other = join(root, "runtime", "other", "claude");
    await writeAccountDir(other, UUID_B, { refreshToken: "rt-other", expiresAt: 1000 });

    const result = await syncSourceToRuntimes(sourceDir, join(root, "runtime"));
    expect(result).toEqual({ updated: [], failed: [] });

    const fresherAfter = JSON.parse(await readFile(join(fresher, ".credentials.json"), "utf8"));
    const otherAfter = JSON.parse(await readFile(join(other, ".credentials.json"), "utf8"));
    expect(fresherAfter.claudeAiOauth.refreshToken).toBe("rt-fresher");
    expect(otherAfter.claudeAiOauth.refreshToken).toBe("rt-other");
  });
});

describe("rescueRuntimeCredentials", () => {
  test("rescues fresher runtime creds to the account dir owning the uuid", async () => {
    // The user's bug in miniature: account2 logged in inside the shared
    // runtime (fresh token lives ONLY there), account2's own dir holds the
    // dead rotated token. Rescue must return the fresh token home before the
    // identity guard wipes the runtime for the other account.
    const account1 = join(root, "accounts", "account1");
    const account2 = join(root, "accounts", "account2");
    await writeAccountDir(account1, UUID_A, { refreshToken: "rt-a1", expiresAt: 5000 });
    await writeAccountDir(account2, UUID_B, { refreshToken: "rt-a2-dead", expiresAt: 1000 });

    const runtimeDir = join(root, "runtime", "core", "claude");
    await writeAccountDir(runtimeDir, UUID_B, { refreshToken: "rt-a2-fresh", expiresAt: 9999 });

    const result = await rescueRuntimeCredentials(runtimeDir, [account1, account2]);
    expect(result.rescued).toBe(true);
    if (result.rescued) expect(result.to).toBe(join(account2, ".credentials.json"));

    const after = JSON.parse(await readFile(join(account2, ".credentials.json"), "utf8"));
    expect(after.claudeAiOauth.refreshToken).toBe("rt-a2-fresh");
    // The other account's dir is untouched.
    const other = JSON.parse(await readFile(join(account1, ".credentials.json"), "utf8"));
    expect(other.claudeAiOauth.refreshToken).toBe("rt-a1");
  });

  test("skips when the owner already holds creds as fresh or fresher", async () => {
    const account = join(root, "accounts", "account2");
    await writeAccountDir(account, UUID_B, { refreshToken: "rt-owner", expiresAt: 9999 });

    const runtimeDir = join(root, "runtime", "core", "claude");
    await writeAccountDir(runtimeDir, UUID_B, { refreshToken: "rt-runtime", expiresAt: 9999 });

    const result = await rescueRuntimeCredentials(runtimeDir, [account]);
    expect(result.rescued).toBe(false);
    const after = JSON.parse(await readFile(join(account, ".credentials.json"), "utf8"));
    expect(after.claudeAiOauth.refreshToken).toBe("rt-owner");
    // The runtime copy must be left untouched too.
    const runtimeAfter = JSON.parse(await readFile(join(runtimeDir, ".credentials.json"), "utf8"));
    expect(runtimeAfter.claudeAiOauth.refreshToken).toBe("rt-runtime");
  });

  test("heals EVERY dir claiming the uuid, not just the first match", async () => {
    // ~/.claude and an authmux account dir can both hold the same account.
    const homeClaude = join(root, ".claude");
    const accountDir = join(root, "accounts", "account2");
    await writeAccountDir(homeClaude, UUID_B, { refreshToken: "rt-home-dead", expiresAt: 1000 });
    await writeAccountDir(accountDir, UUID_B, { refreshToken: "rt-acct-dead", expiresAt: 2000 });

    const runtimeDir = join(root, "runtime", "core", "claude");
    await writeAccountDir(runtimeDir, UUID_B, { refreshToken: "rt-fresh", expiresAt: 9999 });

    const result = await rescueRuntimeCredentials(runtimeDir, [homeClaude, accountDir]);
    expect(result.rescued).toBe(true);

    for (const dir of [homeClaude, accountDir]) {
      const after = JSON.parse(await readFile(join(dir, ".credentials.json"), "utf8"));
      expect(after.claudeAiOauth.refreshToken).toBe("rt-fresh");
    }
  });

  test("skips when no account dir matches the runtime's uuid", async () => {
    const account = join(root, "accounts", "account1");
    await writeAccountDir(account, UUID_A, { refreshToken: "rt-a1", expiresAt: 1000 });

    const runtimeDir = join(root, "runtime", "core", "claude");
    await writeAccountDir(runtimeDir, UUID_B, { refreshToken: "rt-b", expiresAt: 9999 });

    const result = await rescueRuntimeCredentials(runtimeDir, [account]);
    expect(result.rescued).toBe(false);
    const after = JSON.parse(await readFile(join(account, ".credentials.json"), "utf8"));
    expect(after.claudeAiOauth.refreshToken).toBe("rt-a1");
  });

  test("skips when the runtime has no readable accountUuid", async () => {
    const account = join(root, "accounts", "account1");
    await writeAccountDir(account, UUID_A, { refreshToken: "rt-a1", expiresAt: 1000 });

    // Credentials without a .claude.json — owner unknowable, must not guess.
    const runtimeDir = join(root, "runtime", "core", "claude");
    await writeAccountDir(runtimeDir, undefined, { refreshToken: "rt-mystery", expiresAt: 9999 });

    const result = await rescueRuntimeCredentials(runtimeDir, [account]);
    expect(result.rescued).toBe(false);
  });

  test("writes to an owner dir that has identity but no credentials yet", async () => {
    const account = join(root, "accounts", "account2");
    await writeAccountDir(account, UUID_B, undefined);

    const runtimeDir = join(root, "runtime", "core", "claude");
    await writeAccountDir(runtimeDir, UUID_B, { refreshToken: "rt-fresh", expiresAt: 9999 });

    const result = await rescueRuntimeCredentials(runtimeDir, [account]);
    expect(result.rescued).toBe(true);
    const after = JSON.parse(await readFile(join(account, ".credentials.json"), "utf8"));
    expect(after.claudeAiOauth.refreshToken).toBe("rt-fresh");
  });
});

describe("pullFreshestToRuntime", () => {
  test("adopts the owner's fresher token — a sibling session rotated ours away", async () => {
    // Two live sessions on different profiles share one refresh token. The
    // other one refreshed, rotating ours dead; its rescue already published
    // the new token to the account dir. This is how we find out.
    const account = join(root, "accounts", "account2");
    await writeAccountDir(account, UUID_B, { refreshToken: "rt-rotated-by-sibling", expiresAt: 9999 });

    const runtimeDir = join(root, "runtime", "core", "claude");
    await writeAccountDir(runtimeDir, UUID_B, { refreshToken: "rt-now-dead", expiresAt: 1000 });

    const result = await pullFreshestToRuntime(runtimeDir, [account]);
    expect(result.pulled).toBe(true);
    const after = JSON.parse(await readFile(join(runtimeDir, ".credentials.json"), "utf8"));
    expect(after.claudeAiOauth.refreshToken).toBe("rt-rotated-by-sibling");
  });

  test("never adopts a different account's token", async () => {
    const other = join(root, "accounts", "account1");
    await writeAccountDir(other, UUID_A, { refreshToken: "rt-other-account", expiresAt: 9999 });

    const runtimeDir = join(root, "runtime", "core", "claude");
    await writeAccountDir(runtimeDir, UUID_B, { refreshToken: "rt-ours", expiresAt: 1000 });

    expect((await pullFreshestToRuntime(runtimeDir, [other])).pulled).toBe(false);
    const after = JSON.parse(await readFile(join(runtimeDir, ".credentials.json"), "utf8"));
    expect(after.claudeAiOauth.refreshToken).toBe("rt-ours");
  });

  test("leaves the runtime alone when it is already the freshest", async () => {
    const account = join(root, "accounts", "account2");
    await writeAccountDir(account, UUID_B, { refreshToken: "rt-stale", expiresAt: 5000 });
    const runtimeDir = join(root, "runtime", "core", "claude");
    await writeAccountDir(runtimeDir, UUID_B, { refreshToken: "rt-ours", expiresAt: 9999 });

    expect((await pullFreshestToRuntime(runtimeDir, [account])).pulled).toBe(false);
  });

  test("a runtime with no credentials is not guessed at", async () => {
    const account = join(root, "accounts", "account2");
    await writeAccountDir(account, UUID_B, { refreshToken: "rt-owner", expiresAt: 9999 });
    const runtimeDir = join(root, "runtime", "empty", "claude");
    await mkdir(runtimeDir, { recursive: true });

    expect((await pullFreshestToRuntime(runtimeDir, [account])).pulled).toBe(false);
  });
});

describe("reconcileCredentials", () => {
  test("publishes our rotation, so the sibling session can adopt it", async () => {
    const account = join(root, "accounts", "account2");
    await writeAccountDir(account, UUID_B, { refreshToken: "rt-old", expiresAt: 1000 });
    const runtimeDir = join(root, "runtime", "core", "claude");
    await writeAccountDir(runtimeDir, UUID_B, { refreshToken: "rt-we-just-rotated", expiresAt: 9999 });

    const out = await reconcileCredentials(runtimeDir, [account]);
    expect(out.pushed).toContain(join(account, ".credentials.json"));
    const owner = JSON.parse(await readFile(join(account, ".credentials.json"), "utf8"));
    expect(owner.claudeAiOauth.refreshToken).toBe("rt-we-just-rotated");
  });

  test("adopts the sibling's rotation when we are the stale one", async () => {
    const account = join(root, "accounts", "account2");
    await writeAccountDir(account, UUID_B, { refreshToken: "rt-fresh", expiresAt: 9999 });
    const runtimeDir = join(root, "runtime", "core", "claude");
    await writeAccountDir(runtimeDir, UUID_B, { refreshToken: "rt-dead", expiresAt: 1000 });

    const out = await reconcileCredentials(runtimeDir, [account]);
    expect(out.pulled).toBe(join(account, ".credentials.json"));
    const mine = JSON.parse(await readFile(join(runtimeDir, ".credentials.json"), "utf8"));
    expect(mine.claudeAiOauth.refreshToken).toBe("rt-fresh");
  });

  test("settles — an already-agreed pair produces no writes in either direction", async () => {
    // Guards against a push/pull ping-pong between two reconcilers.
    const account = join(root, "accounts", "account2");
    await writeAccountDir(account, UUID_B, { refreshToken: "rt-same", expiresAt: 9999 });
    const runtimeDir = join(root, "runtime", "core", "claude");
    await writeAccountDir(runtimeDir, UUID_B, { refreshToken: "rt-same", expiresAt: 9999 });

    const out = await reconcileCredentials(runtimeDir, [account]);
    expect(out.pushed).toEqual([]);
    expect(out.pulled).toBeUndefined();
  });
});

describe("listKnownAccountDirs", () => {
  test("returns ~/.claude plus every ~/.claude-accounts/<name> directory", async () => {
    await mkdir(join(root, ".claude"), { recursive: true });
    await mkdir(join(root, ".claude-accounts", "account1"), { recursive: true });
    await mkdir(join(root, ".claude-accounts", "account2"), { recursive: true });
    // A stray file must not be listed.
    await writeFile(join(root, ".claude-accounts", "notes.txt"), "x");

    const dirs = await listKnownAccountDirs(root);
    expect(dirs).toContain(join(root, ".claude"));
    expect(dirs).toContain(join(root, ".claude-accounts", "account1"));
    expect(dirs).toContain(join(root, ".claude-accounts", "account2"));
    expect(dirs).not.toContain(join(root, ".claude-accounts", "notes.txt"));
  });

  test("works when ~/.claude-accounts does not exist", async () => {
    const dirs = await listKnownAccountDirs(root);
    expect(dirs).toEqual([join(root, ".claude")]);
  });
});

describe("expiry staggering", () => {
  const HOUR = 3_600_000;

  async function readExpiry(path: string): Promise<number> {
    const blob = JSON.parse(await readFile(path, "utf8"));
    return blob.claudeAiOauth.expiresAt;
  }

  test("pulls the expiry forward by a per-runtime offset", async () => {
    const now = Date.now();
    const trueExpiry = now + 8 * HOUR;
    const src = join(root, "src.json");
    await writeFile(src, JSON.stringify({ claudeAiOauth: { refreshToken: "r", expiresAt: trueExpiry } }));

    const dst = join(root, "dst.json");
    await writeStaggeredCopy(src, dst, "/runtime/alpha/claude", now);

    const written = await readExpiry(dst);
    expect(written).toBe(trueExpiry - staggerOffsetFor("/runtime/alpha/claude"));
    expect(written).toBeLessThanOrEqual(trueExpiry);
    expect(written).toBeGreaterThanOrEqual(trueExpiry - MAX_STAGGER_MS);
  });

  test("gives different runtimes different slots, so they stop colliding", () => {
    const keys = Array.from({ length: 40 }, (_, i) => `/home/u/.config/cue/runtime/profile-${i}/claude`);
    const slots = new Set(keys.map(staggerOffsetFor));
    expect(slots.size).toBeGreaterThan(1);
  });

  test("is deterministic, so a runtime keeps its slot across launches", () => {
    const key = "/runtime/gstack+backend/claude";
    expect(staggerOffsetFor(key)).toBe(staggerOffsetFor(key));
  });

  test("never reports an expiry later than the truth", () => {
    const keys = Array.from({ length: 200 }, (_, i) => `/runtime/p${i}/claude`);
    for (const key of keys) expect(staggerOffsetFor(key)).toBeGreaterThanOrEqual(0);
  });

  test("leaves a near-expiry token alone rather than fabricating a dead one", async () => {
    const now = Date.now();
    const trueExpiry = now + 30_000; // inside the stagger window
    const src = join(root, "near.json");
    await writeFile(src, JSON.stringify({ claudeAiOauth: { refreshToken: "r", expiresAt: trueExpiry } }));

    const dst = join(root, "near-dst.json");
    await writeStaggeredCopy(src, dst, "/runtime/alpha/claude", now);

    expect(await readExpiry(dst)).toBe(trueExpiry);
  });

  test("ships unparseable credentials through untouched rather than failing auth", async () => {
    const src = join(root, "junk.json");
    await writeFile(src, "not json at all");
    const dst = join(root, "junk-dst.json");
    await writeStaggeredCopy(src, dst, "/runtime/alpha/claude");
    expect(await readFile(dst, "utf8")).toBe("not json at all");
  });

  test("preserves every field except the expiry", async () => {
    const now = Date.now();
    const src = join(root, "full.json");
    await writeFile(src, JSON.stringify({
      claudeAiOauth: { accessToken: "a", refreshToken: "r", expiresAt: now + 8 * HOUR, scopes: ["x"] },
      other: { keep: true },
    }));
    const dst = join(root, "full-dst.json");
    await writeStaggeredCopy(src, dst, "/runtime/alpha/claude", now);

    const blob = JSON.parse(await readFile(dst, "utf8"));
    expect(blob.claudeAiOauth.accessToken).toBe("a");
    expect(blob.claudeAiOauth.refreshToken).toBe("r");
    expect(blob.claudeAiOauth.scopes).toEqual(["x"]);
    expect(blob.other).toEqual({ keep: true });
  });

  test("writes 0600, never leaving tokens group-readable", async () => {
    const { stat } = await import("node:fs/promises");
    const now = Date.now();
    const src = join(root, "perm.json");
    await writeFile(src, JSON.stringify({ claudeAiOauth: { refreshToken: "r", expiresAt: now + 8 * HOUR } }));
    const dst = join(root, "perm-dst.json");
    await writeStaggeredCopy(src, dst, "/runtime/alpha/claude", now);
    expect((await stat(dst)).mode & 0o777).toBe(0o600);
  });
});

describe("syncSourceToRuntimes staggering", () => {
  test("re-stagger a verbatim copy left by a pre-staggering cue", async () => {
    // The upgrade case: every runtime on disk holds the right token at the raw
    // source expiry, so they all still rotate in the same second. Repair has to
    // move them into their slots even though the token already matches.
    const sourceDir = join(root, "source");
    const runtimeRoot = join(root, "runtime");
    const EXP = Date.now() + 8 * 3_600_000;
    await writeAccountDir(sourceDir, UUID_A, { refreshToken: "rt", expiresAt: EXP });
    // Bucket 0 is a real slot whose staggered value IS the raw expiry, so a
    // verbatim copy there is already correct and rewriting it would be churn.
    // This case is about every other bucket.
    let rt = "";
    for (let i = 0; i < 64 && !rt; i += 1) {
      const candidate = join(runtimeRoot, `legacy${i}`, "claude");
      if (staggerOffsetFor(candidate) > 0) rt = candidate;
    }
    expect(staggerOffsetFor(rt)).toBeGreaterThan(0);
    await writeAccountDir(rt, UUID_A, { refreshToken: "rt", expiresAt: EXP });

    const out = await syncSourceToRuntimes(sourceDir, runtimeRoot);
    expect(out.failed).toEqual([]);
    expect(out.updated.length).toBe(1);

    const after = JSON.parse(await readFile(join(rt, ".credentials.json"), "utf8"));
    expect(after.claudeAiOauth.refreshToken).toBe("rt");
    expect(after.claudeAiOauth.expiresAt).toBe(EXP - staggerOffsetFor(rt));
  });

  test("is idempotent once every runtime sits in its slot", async () => {
    const sourceDir = join(root, "source");
    const runtimeRoot = join(root, "runtime");
    const EXP = Date.now() + 8 * 3_600_000;
    await writeAccountDir(sourceDir, UUID_A, { refreshToken: "rt", expiresAt: EXP });
    await writeAccountDir(join(runtimeRoot, "a", "claude"), UUID_A, { refreshToken: "rt", expiresAt: EXP });

    await syncSourceToRuntimes(sourceDir, runtimeRoot);
    const second = await syncSourceToRuntimes(sourceDir, runtimeRoot);
    expect(second.updated).toEqual([]);
  });

  test("still refuses to clobber a runtime that rotated on its own", async () => {
    const sourceDir = join(root, "source");
    const runtimeRoot = join(root, "runtime");
    const EXP = Date.now() + 8 * 3_600_000;
    await writeAccountDir(sourceDir, UUID_A, { refreshToken: "rt-old", expiresAt: EXP });
    const rt = join(runtimeRoot, "live", "claude");
    await writeAccountDir(rt, UUID_A, { refreshToken: "rt-newer", expiresAt: EXP + 3_600_000 });

    await syncSourceToRuntimes(sourceDir, runtimeRoot);
    const after = JSON.parse(await readFile(join(rt, ".credentials.json"), "utf8"));
    expect(after.claudeAiOauth.refreshToken).toBe("rt-newer");
  });

  test("spreads a fleet across distinct rotation moments", async () => {
    const sourceDir = join(root, "source");
    const runtimeRoot = join(root, "runtime");
    const EXP = Date.now() + 8 * 3_600_000;
    await writeAccountDir(sourceDir, UUID_A, { refreshToken: "rt", expiresAt: EXP });
    for (let i = 0; i < 12; i += 1) {
      await writeAccountDir(join(runtimeRoot, `p${i}`, "claude"), UUID_A, { refreshToken: "rt", expiresAt: EXP });
    }

    await syncSourceToRuntimes(sourceDir, runtimeRoot);

    const expiries = new Set<number>();
    for (let i = 0; i < 12; i += 1) {
      const blob = JSON.parse(await readFile(join(runtimeRoot, `p${i}`, "claude", ".credentials.json"), "utf8"));
      expiries.add(blob.claudeAiOauth.expiresAt);
    }
    // The whole point: they no longer all expire at the same instant.
    expect(expiries.size).toBeGreaterThan(1);
  });
});
