import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findFreshestCredentials, syncFreshestToSource } from "./credentials-sync";

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
