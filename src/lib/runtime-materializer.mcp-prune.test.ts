import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { materializeRuntime } from "./runtime-materializer";
import type { ResolvedProfile } from "../../profiles/_types";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cue-mcpprune-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const base = (mcps: { id: string }[]): ResolvedProfile => ({
  name: "p",
  description: "t",
  agents: ["claude-code"],
  skills: { local: [], npx: [] },
  mcps,
  plugins: [],
  env: {},
  inheritanceChain: ["p"],
});

const registry = {
  "claude-mem": { command: "claude-mem", args: [] },
  gbrain: { command: "gbrain", args: [] },
};

async function readClaudeJsonMcps(runtimeDir: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(join(runtimeDir, ".claude.json"), "utf8"));
  return (parsed.mcpServers as Record<string, unknown>) ?? {};
}

describe("lazy-MCP: disabledMcpIds evicts stale keys from .claude.json", () => {
  test("a disabled MCP is removed across a rebuild; user + kept MCPs survive", async () => {
    // A user-managed MCP lives in the credentials source .claude.json — it must
    // never be touched by cue's prune.
    const credSrc = join(root, "creds");
    await mkdir(credSrc, { recursive: true });
    await writeFile(
      join(credSrc, ".claude.json"),
      JSON.stringify({ oauthAccount: { accountUuid: "acc-1" }, mcpServers: { userMcp: { command: "u" } } }),
    );

    const common = {
      agent: "claude-code" as const,
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id: string) => `/fake/${id}`,
      mcpRegistry: registry,
      userClaudeMd: "",
      credentialsSource: credSrc,
    };

    // Build 1: full profile — claude-mem + gbrain both materialize.
    const first = await materializeRuntime({ ...common, profile: base([{ id: "claude-mem" }, { id: "gbrain" }]) });
    const before = await readClaudeJsonMcps(first.runtimeDir);
    expect(Object.keys(before).sort()).toEqual(["claude-mem", "gbrain", "userMcp"]);

    // Build 2: gbrain pruned from profile.mcps + named in disabledMcpIds.
    const second = await materializeRuntime({
      ...common,
      profile: base([{ id: "claude-mem" }]),
      disabledMcpIds: ["gbrain"],
    });
    expect(second.rebuilt).toBe(true); // mcps changed → hash changed → rebuild
    const after = await readClaudeJsonMcps(second.runtimeDir);

    expect(after.gbrain).toBeUndefined(); // the disabled MCP is gone
    expect(after["claude-mem"]).toBeDefined(); // the kept cue MCP survives
    expect(after.userMcp).toEqual({ command: "u" }); // user MCP untouched
  });

  test("all-mode: a GLOBAL server named in disabledMcpIds IS evicted", async () => {
    // The end-effect of CUE_PRUNE_MCPS=all: the launcher puts an unused global
    // server (here `userMcp`, not in profile.mcps) into disabledMcpIds, and the
    // sync must evict it — the opt-in override of the "globals are sacred"
    // default. A kept cue MCP still survives.
    const credSrc = join(root, "creds-all");
    await mkdir(credSrc, { recursive: true });
    await writeFile(
      join(credSrc, ".claude.json"),
      JSON.stringify({ oauthAccount: { accountUuid: "acc-2" }, mcpServers: { userMcp: { command: "u" } } }),
    );
    const common = {
      agent: "claude-code" as const,
      runtimeRoot: join(root, "runtime-all"),
      skillSourceLookup: async (id: string) => `/fake/${id}`,
      mcpRegistry: registry,
      userClaudeMd: "",
      credentialsSource: credSrc,
    };
    const out = await materializeRuntime({
      ...common,
      profile: base([{ id: "claude-mem" }]),
      disabledMcpIds: ["userMcp"], // global, not in profile.mcps
    });
    const mcps = await readClaudeJsonMcps(out.runtimeDir);
    expect(mcps.userMcp).toBeUndefined(); // global evicted under all-mode
    expect(mcps["claude-mem"]).toBeDefined(); // kept cue MCP survives
  });
});
