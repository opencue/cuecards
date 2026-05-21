/**
 * Tests for the MCP materializer (Agent A9).
 *
 * Run with `bun test bin/cli/lib/mcp-materializer.test.ts`.
 *
 * Fixtures live entirely under `tmpdir()` so the suite does not depend on
 * `mcps/configs/*.sanitized.json` evolving — the real registry can change
 * shape without breaking these tests.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ResolvedProfile } from "../../../profiles/_types";
import {
  McpNotFound,
  UnresolvedEnvPlaceholder,
  materializeMcp,
} from "./mcp-materializer";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let configsRoot: string;

const CLAUDE_FIXTURE = {
  server_key: "mcpServers",
  servers: {
    drawio: {
      command: "npx",
      args: ["-y", "@drawio/mcp"],
      env: {},
      type: "stdio",
    },
    gbrain: {
      command: "~/.local/bin/gbrain-mcp-wrapper.sh",
    },
    recodee: {
      command: "~/Documents/recodee/.venv/bin/recodee-mcp",
      env: {
        RECODEE_BASE_URL: "${RECODEE_BASE_URL}",
      },
    },
    "higgsfield-http": {
      type: "http",
      url: "${HIGGSFIELD_URL}",
    },
  },
  source: "claude",
  source_path: "~/.claude/settings.json",
};

const CODEX_FIXTURE = {
  server_key: "mcp_servers",
  servers: {
    colony: {
      command: "~/.nvm/versions/node/v22.22.0/bin/colony",
      args: ["mcp"],
      enabled: true,
      startup_timeout_sec: 60,
      env: {
        COLONY_HOME: "${COLONY_HOME}",
      },
    },
    recodee: {
      command: "~/Documents/recodee/.venv/bin/recodee-mcp",
      env: {
        RECODEE_BASE_URL: "${RECODEE_BASE_URL}",
      },
    },
  },
  source: "codex",
  source_path: "~/.codex/config.toml",
};

async function writeFixtures(root: string): Promise<void> {
  await writeFile(
    join(root, "claude.sanitized.json"),
    JSON.stringify(CLAUDE_FIXTURE, null, 2),
    "utf8",
  );
  await writeFile(
    join(root, "codex.sanitized.json"),
    JSON.stringify(CODEX_FIXTURE, null, 2),
    "utf8",
  );
}

function makeProfile(
  overrides: Partial<ResolvedProfile & { mcps: (string | { id: string })[] }> = {},
): ResolvedProfile {
  const { mcps: rawMcps, ...rest } = overrides;
  // Normalize string mcps to { id } objects for the new ResolvedProfile shape.
  const mcps = rawMcps
    ? rawMcps.map((ref) => (typeof ref === "string" ? { id: ref } : ref))
    : [];
  return {
    name: "test",
    description: "fixture",
    agents: ["claude-code", "codex"],
    skills: { local: [], npx: [] },
    mcps,
    plugins: [],
    env: {},
    inheritanceChain: ["test"],
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  configsRoot = await mkdtemp(join(tmpdir(), "soul-mcp-mat-"));
  await mkdir(configsRoot, { recursive: true });
  await writeFixtures(configsRoot);
});

afterEach(async () => {
  await rm(configsRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("materializeMcp — filtering", () => {
  test("returns only servers listed in profile.mcps for each agent", async () => {
    const profile = makeProfile({
      mcps: ["drawio", "colony"],
      env: { COLONY_HOME: "/tmp/colony" },
    });

    const out = await materializeMcp(profile, { configsRoot, processEnv: {} });

    // claude registry has drawio (and no colony), codex registry has colony
    // (and no drawio). Each side filters to what it knows.
    expect(out.claude).toEqual({
      mcpServers: {
        drawio: {
          command: "npx",
          args: ["-y", "@drawio/mcp"],
          env: {},
          type: "stdio",
        },
      },
    });
    expect(out.codex).toEqual({
      mcp_servers: {
        colony: {
          command: "~/.nvm/versions/node/v22.22.0/bin/colony",
          args: ["mcp"],
          enabled: true,
          startup_timeout_sec: 60,
          env: { COLONY_HOME: "/tmp/colony" },
        },
      },
    });
  });

  test("emits empty server blocks when profile.mcps is empty", async () => {
    const profile = makeProfile({ mcps: [] });
    const out = await materializeMcp(profile, { configsRoot, processEnv: {} });
    expect(out.claude).toEqual({ mcpServers: {} });
    expect(out.codex).toEqual({ mcp_servers: {} });
  });

  test("emits a server on BOTH sides when it appears in both registries", async () => {
    const profile = makeProfile({
      mcps: ["recodee"],
      env: { RECODEE_BASE_URL: "https://recodee.example" },
    });
    const out = await materializeMcp(profile, { configsRoot, processEnv: {} });
    expect((out.claude as { mcpServers: Record<string, unknown> }).mcpServers)
      .toHaveProperty("recodee");
    expect((out.codex as { mcp_servers: Record<string, unknown> }).mcp_servers)
      .toHaveProperty("recodee");
  });
});

describe("materializeMcp — McpNotFound", () => {
  test("throws when profile references an id missing from BOTH registries", async () => {
    const profile = makeProfile({ mcps: ["does-not-exist"] });
    try {
      await materializeMcp(profile, { configsRoot, processEnv: {} });
      throw new Error("expected materializeMcp to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(McpNotFound);
      expect((err as McpNotFound).id).toBe("does-not-exist");
      // Surface the known ids so the user can correct their profile.
      expect((err as McpNotFound).known).toContain("drawio");
      expect((err as McpNotFound).known).toContain("colony");
    }
  });

  test("does NOT throw when an id is only in one registry — that's normal", async () => {
    const profile = makeProfile({ mcps: ["drawio"] });
    const out = await materializeMcp(profile, { configsRoot, processEnv: {} });
    expect((out.claude as { mcpServers: Record<string, unknown> }).mcpServers)
      .toHaveProperty("drawio");
    expect((out.codex as { mcp_servers: Record<string, unknown> }).mcp_servers)
      .toEqual({});
  });
});

describe("materializeMcp — env substitution", () => {
  test("substitutes from profile.env first", async () => {
    const profile = makeProfile({
      mcps: ["recodee"],
      env: { RECODEE_BASE_URL: "https://from-profile" },
    });
    const out = await materializeMcp(profile, {
      configsRoot,
      processEnv: { RECODEE_BASE_URL: "https://from-process" },
    });
    const claudeRecodee = (out.claude as {
      mcpServers: { recodee: { env: { RECODEE_BASE_URL: string } } };
    }).mcpServers.recodee;
    expect(claudeRecodee.env.RECODEE_BASE_URL).toBe("https://from-profile");
  });

  test("falls back to process.env when profile.env is silent", async () => {
    const profile = makeProfile({ mcps: ["recodee"] });
    const out = await materializeMcp(profile, {
      configsRoot,
      processEnv: { RECODEE_BASE_URL: "https://from-process" },
    });
    const claudeRecodee = (out.claude as {
      mcpServers: { recodee: { env: { RECODEE_BASE_URL: string } } };
    }).mcpServers.recodee;
    expect(claudeRecodee.env.RECODEE_BASE_URL).toBe("https://from-process");
  });

  test("substitutes inside string values at any depth (url, args, env)", async () => {
    const profile = makeProfile({
      mcps: ["higgsfield-http", "colony"],
      env: {
        HIGGSFIELD_URL: "https://hf.example/mcp",
        COLONY_HOME: "/tmp/colony",
      },
    });
    const out = await materializeMcp(profile, { configsRoot, processEnv: {} });
    expect(
      (out.claude as {
        mcpServers: { "higgsfield-http": { url: string } };
      }).mcpServers["higgsfield-http"].url,
    ).toBe("https://hf.example/mcp");
    expect(
      (out.codex as {
        mcp_servers: { colony: { env: { COLONY_HOME: string } } };
      }).mcp_servers.colony.env.COLONY_HOME,
    ).toBe("/tmp/colony");
  });

  test("throws UnresolvedEnvPlaceholder when no source defines the var", async () => {
    const profile = makeProfile({ mcps: ["recodee"] });
    try {
      await materializeMcp(profile, { configsRoot, processEnv: {} });
      throw new Error("expected materializeMcp to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(UnresolvedEnvPlaceholder);
      expect((err as UnresolvedEnvPlaceholder).varName).toBe(
        "RECODEE_BASE_URL",
      );
      expect((err as UnresolvedEnvPlaceholder).serverId).toBe("recodee");
      expect((err as UnresolvedEnvPlaceholder).source).toBe("claude");
    }
  });

  test("UnresolvedEnvPlaceholder fires for codex-only servers too", async () => {
    const profile = makeProfile({ mcps: ["colony"] });
    try {
      await materializeMcp(profile, { configsRoot, processEnv: {} });
      throw new Error("expected materializeMcp to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(UnresolvedEnvPlaceholder);
      expect((err as UnresolvedEnvPlaceholder).varName).toBe("COLONY_HOME");
      expect((err as UnresolvedEnvPlaceholder).source).toBe("codex");
    }
  });

  test("never leaves a literal ${...} in the emitted config", async () => {
    const profile = makeProfile({
      mcps: ["recodee"],
      env: { RECODEE_BASE_URL: "https://ok" },
    });
    const out = await materializeMcp(profile, { configsRoot, processEnv: {} });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toMatch(/\$\{[A-Za-z_]/);
  });
});

describe("materializeMcp — round-trip / determinism", () => {
  test("two consecutive runs produce identical JSON output", async () => {
    const profile = makeProfile({
      mcps: ["drawio", "colony", "recodee"],
      env: {
        RECODEE_BASE_URL: "https://r.example",
        COLONY_HOME: "/tmp/colony",
      },
    });
    const a = await materializeMcp(profile, { configsRoot, processEnv: {} });
    const b = await materializeMcp(profile, { configsRoot, processEnv: {} });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("server order in output follows profile.mcps order", async () => {
    const profile = makeProfile({
      mcps: ["recodee", "drawio"],
      env: { RECODEE_BASE_URL: "https://r.example" },
    });
    const out = await materializeMcp(profile, { configsRoot, processEnv: {} });
    expect(
      Object.keys(
        (out.claude as { mcpServers: Record<string, unknown> }).mcpServers,
      ),
    ).toEqual(["recodee", "drawio"]);
  });

  test("duplicate ids in profile.mcps collapse to a single entry", async () => {
    const profile = makeProfile({ mcps: ["drawio", "drawio"] });
    const out = await materializeMcp(profile, { configsRoot, processEnv: {} });
    expect(
      Object.keys(
        (out.claude as { mcpServers: Record<string, unknown> }).mcpServers,
      ),
    ).toEqual(["drawio"]);
  });
});

describe("materializeMcp — configs root discovery", () => {
  test("honors the SOUL_MCPS_ROOT env var when no explicit option is given", async () => {
    const profile = makeProfile({ mcps: ["drawio"] });
    const out = await materializeMcp(profile, {
      // Don't pass configsRoot — force the env-var path.
      processEnv: { SOUL_MCPS_ROOT: configsRoot },
    });
    expect(
      (out.claude as { mcpServers: Record<string, unknown> }).mcpServers,
    ).toHaveProperty("drawio");
  });

  test("explicit configsRoot wins over SOUL_MCPS_ROOT", async () => {
    const profile = makeProfile({ mcps: ["drawio"] });
    // SOUL_MCPS_ROOT points somewhere bogus; configsRoot is the real one.
    const out = await materializeMcp(profile, {
      configsRoot,
      processEnv: { SOUL_MCPS_ROOT: "/nonexistent/path" },
    });
    expect(
      (out.claude as { mcpServers: Record<string, unknown> }).mcpServers,
    ).toHaveProperty("drawio");
  });
});
