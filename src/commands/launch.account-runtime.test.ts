import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { authmuxAccountTag } from "./launch";
import { materializeRuntime } from "../lib/runtime-materializer";
import type { ResolvedProfile } from "../../profiles/_types";

// Regression lock for the authmux↔cue parallel-account collapse: two authmux
// accounts sharing one cue profile MUST get isolated runtime dirs, or they
// share a single `.credentials.json` and collapse into one Anthropic login.

describe("authmuxAccountTag", () => {
  const home = "/home/u";

  test("derives the account name from an authmux per-run session dir", () => {
    expect(
      authmuxAccountTag(join(home, ".claude-accounts-sessions", "account1", "20260701T201447843Z-730751"), home),
    ).toBe("account1");
  });

  test("derives the account name from an authmux account dir", () => {
    expect(authmuxAccountTag(join(home, ".claude-accounts", "account2"), home)).toBe("account2");
  });

  test("returns undefined for the default ~/.claude (plain per-profile runtime)", () => {
    expect(authmuxAccountTag(join(home, ".claude"), home)).toBeUndefined();
  });

  test("returns undefined for an unset config dir", () => {
    expect(authmuxAccountTag(undefined, home)).toBeUndefined();
  });

  test("returns undefined for a non-authmux custom config dir", () => {
    expect(authmuxAccountTag(join(home, "work-claude"), home)).toBeUndefined();
  });

  test("sanitizes names so they can't escape the runtime tree or inject the @ separator", () => {
    // A path separator inside the segment is impossible (split on sep already),
    // but a stray '@' or space must not survive into the runtime dir name.
    expect(authmuxAccountTag(join(home, ".claude-accounts", "a@b c"), home)).toBe("a_b_c");
  });
});

describe("per-account runtime isolation (materializeRuntime runtimeKey)", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "cue-acct-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  const profile: ResolvedProfile = {
    name: "core",
    description: "test",
    agents: ["claude-code"],
    skills: { local: [], npx: [] },
    mcps: [],
    plugins: [],
    env: {},
    inheritanceChain: ["core"],
  };

  async function seedAccount(name: string, uuid: string, token: string): Promise<string> {
    const dir = join(root, "accounts", name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: token, refreshToken: `r-${token}`, expiresAt: 1, scopes: [] } }),
    );
    await writeFile(join(dir, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: uuid } }));
    return dir;
  }

  const opts = {
    agent: "claude-code" as const,
    runtimeRoot: () => join(root, "runtime"),
    skillSourceLookup: async (id: string) => `/fake/skills/${id}`,
    mcpRegistry: {},
    userClaudeMd: "# u\n",
  };

  test("two accounts on the SAME profile get separate runtime dirs and don't share credentials", async () => {
    const src1 = await seedAccount("account1", "uuid-nagy", "tok-nagy");
    const src2 = await seedAccount("account2", "uuid-webu", "tok-webu");

    const rt1 = await materializeRuntime({
      profile, agent: opts.agent, runtimeRoot: opts.runtimeRoot(),
      runtimeKey: "core@account1", credentialsSource: src1,
      skillSourceLookup: opts.skillSourceLookup, mcpRegistry: opts.mcpRegistry, userClaudeMd: opts.userClaudeMd,
    });
    const rt2 = await materializeRuntime({
      profile, agent: opts.agent, runtimeRoot: opts.runtimeRoot(),
      runtimeKey: "core@account2", credentialsSource: src2,
      skillSourceLookup: opts.skillSourceLookup, mcpRegistry: opts.mcpRegistry, userClaudeMd: opts.userClaudeMd,
    });

    // Distinct runtime dirs — the core of the fix.
    expect(rt1.runtimeDir).toBe(join(root, "runtime", "core@account1", "claude"));
    expect(rt2.runtimeDir).toBe(join(root, "runtime", "core@account2", "claude"));
    expect(rt1.runtimeDir).not.toBe(rt2.runtimeDir);

    // Materializing account2 must NOT overwrite account1's runtime credentials.
    const cred1 = JSON.parse(await readFile(join(rt1.runtimeDir, ".credentials.json"), "utf8"));
    const cred2 = JSON.parse(await readFile(join(rt2.runtimeDir, ".credentials.json"), "utf8"));
    expect(cred1.claudeAiOauth.accessToken).toBe("tok-nagy");
    expect(cred2.claudeAiOauth.accessToken).toBe("tok-webu");
  });

  test("no runtimeKey falls back to profile.name (unchanged default behavior)", async () => {
    const src = await seedAccount("solo", "uuid-solo", "tok-solo");
    const rt = await materializeRuntime({
      profile, agent: opts.agent, runtimeRoot: opts.runtimeRoot(),
      credentialsSource: src,
      skillSourceLookup: opts.skillSourceLookup, mcpRegistry: opts.mcpRegistry, userClaudeMd: opts.userClaudeMd,
    });
    expect(rt.runtimeDir).toBe(join(root, "runtime", "core", "claude"));
  });
});
