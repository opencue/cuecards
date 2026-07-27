import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  findFreshestCredentials,
  listKnownAccountDirs,
  pullFreshestToRuntime,
  reconcileCredentials,
  rescueRuntimeCredentials,
  syncFreshestToSource,
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
