import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withContextMode } from "./context-mode";
import { materializeRuntime, type MaterializeInput } from "./runtime-materializer";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "cue-context-mode-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function input(agent: "codex" | "claude-code" = "codex"): MaterializeInput {
  return {
    agent, runtimeRoot: join(root, "runtime"), mcpRegistry: {}, userClaudeMd: "Keep user rules.",
    skillSourceLookup: async () => { throw new Error("Unexpected skill lookup"); },
    profile: {
      name: "example", kind: "role", description: "test", agents: [agent],
      skills: { local: [], npx: [] }, mcps: [], plugins: [], env: {},
      codexConfig: {}, rules: [], commands: [], hooks: [], subagents: [],
      inheritanceChain: ["example"],
    } as MaterializeInput["profile"],
    disabledMcpIds: ["context-mode", "other"],
  };
}

async function config() {
  const hooks = { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "context-mode hook codex sessionstart" }] }] } };
  const codexHooks = join(root, "codex-hooks.json");
  const claudeHooks = join(root, "claude-hooks.json");
  await writeFile(codexHooks, JSON.stringify(hooks));
  await writeFile(claudeHooks, JSON.stringify(hooks));
  const path = join(root, "context-mode.json");
  const value = { enabled: true, command: "/usr/bin/node", args: ["/opt/context-mode/start.mjs"], codexHooks, claudeHooks };
  await writeFile(path, JSON.stringify(value));
  return { path, value };
}

test("absent and disabled installations leave input untouched", async () => {
  const original = input();
  const path = join(root, "context-mode.json");
  expect(await withContextMode(original, path)).toBe(original);
  await writeFile(path, JSON.stringify({ enabled: false }));
  expect(await withContextMode(original, path)).toBe(original);
});

test("invalid enabled config fails clearly instead of silently losing routing", async () => {
  const { path, value } = await config();
  for (const invalid of [{ ...value, command: "relative" }, { ...value, args: [42] }, { ...value, codexHooks: "../hooks.json" }, null]) {
    await writeFile(path, JSON.stringify(invalid));
    await expect(withContextMode(input(), path)).rejects.toThrow("context-mode");
  }
});

test("Codex opt-in pins the MCP, merges hooks, and is idempotent without mutating callers", async () => {
  const { path } = await config();
  const original = input();
  original.profile.codexConfig = { hooks: { Stop: [{ hooks: [{ type: "command", command: "existing-hook" }] }] } };
  const result = await withContextMode(original, path);
  expect(result.profile.mcps).toEqual([{ id: "context-mode", pin: true }]);
  expect(result.disabledMcpIds).toEqual(["other"]);
  expect(result.mcpRegistry["context-mode"].env).toEqual({ CONTEXT_MODE_PLATFORM: "codex" });
  expect(result.profile.codexConfig.hooks).toHaveProperty("Stop");
  expect(result.profile.codexConfig.hooks).toHaveProperty("SessionStart");
  expect(result.userClaudeMd).toContain("Keep user rules.");
  expect(original.profile.mcps).toEqual([]);
  expect(await withContextMode(result, path)).toEqual(result);
});

test("Claude opt-in retains existing hook files and adds the installed native hook file", async () => {
  const { path, value } = await config();
  const original = input("claude-code");
  original.profile.hooks = ["existing.json"];
  const result = await withContextMode(original, path);
  expect(result.profile.hooks).toEqual(["existing.json", value.claudeHooks]);
  expect(result.mcpRegistry["context-mode"].env).toEqual({ CONTEXT_MODE_PLATFORM: "claude-code" });
  expect(await withContextMode(result, path)).toEqual(result);
});

test("opt-in survives actual Codex materialization and a second rebuild", async () => {
  const { path } = await config();
  const prepared = await withContextMode(input(), path);
  const first = await materializeRuntime(prepared);
  expect(await readFile(join(first.runtimeDir, "config.toml"), "utf8")).toContain("[mcp_servers.context-mode]");
  expect(await readFile(join(first.runtimeDir, "hooks.json"), "utf8")).toContain("context-mode hook");
  const second = await materializeRuntime({ ...prepared, profile: { ...prepared.profile, description: "Changed" } });
  expect(second.rebuilt).toBe(true);
  expect(await readFile(join(second.runtimeDir, "config.toml"), "utf8")).toContain("[mcp_servers.context-mode]");
  const hooks = JSON.parse(await readFile(join(second.runtimeDir, "hooks.json"), "utf8"));
  expect(hooks.hooks.SessionStart).toHaveLength(1);
});
