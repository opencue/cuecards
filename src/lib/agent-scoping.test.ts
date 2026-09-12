/**
 * The `agents:` contract, in one place.
 *
 * Four profile ref kinds carry `AgentScoped` (profiles/_types.ts): local
 * skills, npx skill sources, MCPs, and plugins. Each is filtered by a
 * DIFFERENT call site — three in runtime-materializer.ts, one in launch.ts —
 * and nothing states the shared rule, so a kind can silently stop honoring it.
 *
 * That already happened once: `agents:` on an npx entry was declared in the
 * type, merged by the profile loader, and read by withCodexPonytail, but
 * `resolveNpxSkillSources` never looked at it, so a codex-scoped source
 * resolved for Claude too. It went unnoticed because no bundled profile used
 * the field — the option looked like it worked right up until something
 * depended on it.
 *
 * So these tests are deliberately end-to-end per kind rather than unit tests
 * of `appliesToAgent`: that helper being correct is not the thing that broke.
 * Every assertion below was mutation-verified — deleting its filter fails it.
 *
 * A fifth scoped kind belongs here too.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentKind, ResolvedProfile } from "../../profiles/_types";
import { materializeRuntime } from "./runtime-materializer";
import { resolveNpxSkillSources } from "../commands/launch";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cue-agent-scoping-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const MCP_REGISTRY = {
  "claude-mcp": { command: "claude-mcp", args: [] },
  "codex-mcp": { command: "codex-mcp", args: [] },
  "both-mcp": { command: "both-mcp", args: [] },
};

/** Materialize one profile for one agent and return what landed on disk. */
async function materializeFor(
  agent: AgentKind,
  overrides: Partial<ResolvedProfile>,
): Promise<{ skills: string[]; mcps: string[]; plugins: string[] }> {
  const profile = {
    name: `scoping-${agent}`,
    description: "",
    agents: ["claude-code", "codex"],
    inheritanceChain: [`scoping-${agent}`],
    skills: { local: [], npx: [] },
    mcps: [],
    plugins: [],
    env: {},
    ...overrides,
  } as unknown as ResolvedProfile;

  const out = await materializeRuntime({
    profile,
    agent,
    runtimeRoot: join(root, agent),
    skillSourceLookup: async (id: string) => `/fake/skills/${id}`,
    mcpRegistry: MCP_REGISTRY,
    userClaudeMd: "",
  });

  const skills = await readdir(join(out.runtimeDir, "skills")).catch(() => [] as string[]);

  let mcps: string[] = [];
  let plugins: string[] = [];
  if (agent === "claude-code") {
    const settings = JSON.parse(
      await readFile(join(out.runtimeDir, "settings.json"), "utf8"),
    );
    mcps = Object.keys(settings.mcpServers ?? {});
    plugins = Object.keys(settings.enabledPlugins ?? {});
  } else {
    const toml = await readFile(join(out.runtimeDir, "config.toml"), "utf8");
    mcps = Object.keys(MCP_REGISTRY).filter((id) => toml.includes(`mcp_servers.${id}`));
  }
  return { skills, mcps, plugins };
}

describe("the agents: contract holds for every scoped ref kind", () => {
  test("local skills", async () => {
    const skills = {
      local: [
        { id: "a/claude-only", agents: ["claude-code"] },
        { id: "a/codex-only", agents: ["codex"] },
        { id: "a/unscoped" },
      ],
      npx: [],
    };

    const claude = await materializeFor("claude-code", { skills } as never);
    expect(claude.skills.sort()).toEqual(["claude-only", "unscoped"]);

    const codex = await materializeFor("codex", { skills } as never);
    expect(codex.skills.sort()).toEqual(["codex-only", "unscoped"]);
  });

  test("MCPs", async () => {
    const mcps = [
      { id: "claude-mcp", agents: ["claude-code"] },
      { id: "codex-mcp", agents: ["codex"] },
      { id: "both-mcp" },
    ];

    const claude = await materializeFor("claude-code", { mcps } as never);
    expect(claude.mcps.sort()).toEqual(["both-mcp", "claude-mcp"]);

    const codex = await materializeFor("codex", { mcps } as never);
    expect(codex.mcps.sort()).toEqual(["both-mcp", "codex-mcp"]);
  });

  test("plugins", async () => {
    // Claude-only by construction: the Codex branch never reads profile.plugins
    // at all, so the meaningful assertion is the one inside the Claude runtime.
    const plugins = [
      { id: "claude-only@mp", agents: ["claude-code"] },
      { id: "codex-only@mp", agents: ["codex"] },
      { id: "unscoped@mp" },
    ];

    const claude = await materializeFor("claude-code", { plugins } as never);
    expect(claude.plugins.sort()).toEqual(["claude-only@mp", "unscoped@mp"]);

    const codex = await materializeFor("codex", { plugins } as never);
    expect(codex.plugins).toEqual([]);
  });

  test("npx skill sources", async () => {
    // Filtered on the launch path, not in the materializer — this is the kind
    // that silently ignored `agents:` until 2026-09-12.
    const profile = {
      name: "scoping-npx",
      skills: {
        local: [],
        npx: [
          { repo: "o/claude-only", agents: ["claude-code"], skills: ["s1"] },
          { repo: "o/codex-only", agents: ["codex"], skills: ["s2"] },
          { repo: "o/unscoped", skills: ["s3"] },
        ],
      },
    } as unknown as ResolvedProfile;

    const reposFor = async (agent: AgentKind | undefined) => {
      let repos: string[] = [];
      await resolveNpxSkillSources(profile, {
        agent,
        resolveNpx: async (scoped) => {
          repos = scoped.skills.npx.map((e) => e.repo);
          return [];
        },
      });
      return repos.sort();
    };

    expect(await reposFor("claude-code")).toEqual(["o/claude-only", "o/unscoped"]);
    expect(await reposFor("codex")).toEqual(["o/codex-only", "o/unscoped"]);
    // Agent-agnostic callers (doctor, validate) deliberately see everything.
    expect(await reposFor(undefined)).toHaveLength(3);
  });
});
