import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { materializeRuntime } from "./runtime-materializer";
import type { ResolvedProfile } from "../../profiles/_types";

// Claude Code 2.1.x keeps its user config in `<configDir>/.config.json` and,
// when that file exists, ignores `.claude.json` — mcpServers included. cue used
// to sync profile MCPs into `.claude.json` only, so on a migrated runtime every
// profile MCP (codegraph, context7, ego-browser, …) silently never started.

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cue-configjson-"));
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

const readJson = async (path: string) =>
  JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

describe("profile MCPs are synced into Claude Code's 2.1.x `.config.json`", () => {
  test("an existing .config.json gets the profile MCPs merged in; foreign keys, user MCPs and the read-only mode survive", async () => {
    const common = {
      agent: "claude-code" as const,
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id: string) => `/fake/${id}`,
      mcpRegistry: registry,
      userClaudeMd: "",
    };

    // Build 1 establishes the runtime dir; then Claude "migrates" its config.
    const first = await materializeRuntime({ ...common, profile: base([{ id: "claude-mem" }]) });
    const configJson = join(first.runtimeDir, ".config.json");
    await writeFile(
      configJson,
      JSON.stringify({
        oauthAccount: { accountUuid: "acc-1" },
        numStartups: 7,
        mcpServers: { userMcp: { command: "u" } },
      }),
      { mode: 0o444 },
    );

    // Build 2 is a REBUILD (profile hash changed): .config.json must survive
    // the swap like .claude.json does, and then receive the new MCP set.
    const second = await materializeRuntime({ ...common, profile: base([{ id: "claude-mem" }, { id: "gbrain" }]) });
    expect(second.runtimeDir).toBe(first.runtimeDir);
    const after = await readJson(configJson);
    expect(Object.keys(after.mcpServers as object).sort()).toEqual(["claude-mem", "gbrain", "userMcp"]);
    expect(after.oauthAccount).toEqual({ accountUuid: "acc-1" });
    expect(after.numStartups).toBe(7);
    expect((await stat(configJson)).mode & 0o777).toBe(0o444);
    // The legacy file is still written for older clients.
    const legacy = await readJson(join(first.runtimeDir, ".claude.json"));
    expect(Object.keys(legacy.mcpServers as object).sort()).toEqual(["claude-mem", "gbrain"]);

    // Build 3 is a CACHE HIT (same profile): the sync still runs every launch,
    // so a server Claude dropped from its own file comes back.
    const trimmed = { ...after, mcpServers: { userMcp: { command: "u" } } };
    await rm(configJson, { force: true });
    await writeFile(configJson, JSON.stringify(trimmed), { mode: 0o444 });
    await materializeRuntime({ ...common, profile: base([{ id: "claude-mem" }, { id: "gbrain" }]) });
    const again = await readJson(configJson);
    expect(Object.keys(again.mcpServers as object).sort()).toEqual(["claude-mem", "gbrain", "userMcp"]);
    expect((await stat(configJson)).mode & 0o777).toBe(0o444);
  });

  test("a disabled MCP is evicted from .config.json too; the user's own MCP is never touched", async () => {
    const common = {
      agent: "claude-code" as const,
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id: string) => `/fake/${id}`,
      mcpRegistry: registry,
      userClaudeMd: "",
    };
    const first = await materializeRuntime({ ...common, profile: base([{ id: "claude-mem" }, { id: "gbrain" }]) });
    const configJson = join(first.runtimeDir, ".config.json");
    await writeFile(
      configJson,
      JSON.stringify({ mcpServers: { userMcp: { command: "u" }, gbrain: { command: "gbrain", args: [] } } }),
    );

    await materializeRuntime({
      ...common,
      profile: base([{ id: "claude-mem" }]),
      disabledMcpIds: ["gbrain"],
    });
    const after = await readJson(configJson);
    expect(Object.keys(after.mcpServers as object).sort()).toEqual(["claude-mem", "userMcp"]);
  });

  test("no .config.json → none is created (a pre-2.1 client would otherwise start ignoring .claude.json)", async () => {
    const out = await materializeRuntime({
      agent: "claude-code" as const,
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id: string) => `/fake/${id}`,
      mcpRegistry: registry,
      userClaudeMd: "",
      profile: base([{ id: "claude-mem" }]),
    });
    await expect(stat(join(out.runtimeDir, ".config.json"))).rejects.toThrow();
  });
});
