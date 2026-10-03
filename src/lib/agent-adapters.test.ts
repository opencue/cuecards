import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { ADAPTERS, AGENT_IDS, getAdapter, claudeCode, codex, antigravity } from "./agent-adapters";

describe("agent-adapters registry contract", () => {
  test("every adapter conforms to the AgentAdapter shape", () => {
    for (const [key, a] of Object.entries(ADAPTERS)) {
      expect(typeof a.id, key).toBe("string");
      expect(a.id.length, key).toBeGreaterThan(0);
      expect(typeof a.name, key).toBe("string");
      expect(typeof a.configDir, key).toBe("function");
      expect(typeof a.writeSkills, key).toBe("function");
      expect(typeof a.writeMcps, key).toBe("function");
      expect(typeof a.rulesFile, key).toBe("function");
      expect(typeof a.detectBinary, key).toBe("function");
    }
  });

  test("every adapter maps to a native rules file (for `cue ruler`)", () => {
    for (const [key, a] of Object.entries(ADAPTERS)) {
      const p = a.rulesFile("/tmp/project");
      expect(p, key).toBeTruthy();
      expect(resolve(p!).startsWith(resolve("/tmp/project")), key).toBe(true);
    }
  });

  test("each adapter's id matches its registry key (no copy-paste drift)", () => {
    for (const [key, a] of Object.entries(ADAPTERS)) {
      expect(a.id).toBe(key);
    }
  });

  test("AGENT_IDS mirrors the registry keys", () => {
    expect([...AGENT_IDS].sort()).toEqual(Object.keys(ADAPTERS).sort());
  });

  test("configDir() returns a non-empty absolute path for every adapter", () => {
    for (const [key, a] of Object.entries(ADAPTERS)) {
      const dir = a.configDir();
      expect(dir.length, key).toBeGreaterThan(0);
      expect(isAbsolute(dir), key).toBe(true);
    }
  });
});

describe("getAdapter", () => {
  test("resolves known agent ids to the right adapter", () => {
    expect(getAdapter("claude-code")).toBe(claudeCode);
    expect(getAdapter("codex")).toBe(codex);
    expect(getAdapter("antigravity")).toBe(antigravity);
  });

  test("returns null for an unknown id", () => {
    expect(getAdapter("does-not-exist")).toBeNull();
    expect(getAdapter("")).toBeNull();
  });
});

describe("configDir env overrides", () => {
  const saved = { claude: process.env.CLAUDE_CONFIG_DIR, codex: process.env.CODEX_HOME };
  afterEach(() => {
    if (saved.claude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved.claude;
    if (saved.codex === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = saved.codex;
  });

  test("claude-code honors CLAUDE_CONFIG_DIR, else ~/.claude", () => {
    process.env.CLAUDE_CONFIG_DIR = "/tmp/custom-claude";
    expect(claudeCode.configDir()).toBe("/tmp/custom-claude");
    delete process.env.CLAUDE_CONFIG_DIR;
    expect(claudeCode.configDir()).toBe(join(homedir(), ".claude"));
  });

  test("codex honors CODEX_HOME, else ~/.codex", () => {
    process.env.CODEX_HOME = "/tmp/custom-codex";
    expect(codex.configDir()).toBe("/tmp/custom-codex");
    delete process.env.CODEX_HOME;
    expect(codex.configDir()).toBe(join(homedir(), ".codex"));
  });
});

describe("writeMcps behavior", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cue-adapters-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("claude-code writes mcpServers into settings.json and preserves existing keys", () => {
    // Pre-existing settings with an unrelated key that must survive the merge.
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ theme: "dark" }));
    claudeCode.writeMcps({ ctx7: { command: "npx", args: ["ctx7"] } }, dir);
    const out = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    expect(out.theme).toBe("dark");
    expect(out.mcpServers.ctx7).toEqual({ command: "npx", args: ["ctx7"] });
  });

  test("codex writes a config.toml with an [mcp_servers.<id>] section", () => {
    codex.writeMcps({ ctx7: { command: "npx" } }, dir);
    const toml = readFileSync(join(dir, "config.toml"), "utf8");
    expect(toml).toContain("[mcp_servers.ctx7]");
    expect(toml).toContain('command = "npx"');
  });

  test("antigravity writes global skills and merges its global MCP config", () => {
    const home = mkdtempSync(join(tmpdir(), "cue-antigravity-home-"));
    const target = join(home, ".gemini");
    const previous = process.env.ANTIGRAVITY_CONFIG_DIR;
    process.env.ANTIGRAVITY_CONFIG_DIR = target;
    try {
      mkdirSync(join(target, "config"), { recursive: true });
      writeFileSync(join(target, "config", "mcp_config.json"), JSON.stringify({
        unrelated: true,
        mcpServers: { existing: { command: "existing" } },
      }));
      antigravity.writeSkills([{ id: "testing/example", content: "# Example" }], target);
      antigravity.writeMcps({ ctx7: { command: "npx", args: ["ctx7"] } }, target);
      expect(readFileSync(join(target, "antigravity-cli", "skills", "example", "SKILL.md"), "utf8")).toBe("# Example");
      const out = JSON.parse(readFileSync(join(target, "config", "mcp_config.json"), "utf8"));
      expect(out.unrelated).toBe(true);
      expect(out.mcpServers.existing).toEqual({ command: "existing" });
      expect(out.mcpServers.ctx7).toEqual({ command: "npx", args: ["ctx7"] });
    } finally {
      if (previous === undefined) delete process.env.ANTIGRAVITY_CONFIG_DIR;
      else process.env.ANTIGRAVITY_CONFIG_DIR = previous;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("antigravity writes workspace skills and MCP config under .agents", () => {
    const dir = mkdtempSync(join(tmpdir(), "cue-antigravity-workspace-"));
    try {
      antigravity.writeSkills([{ id: "testing/example", content: "# Example" }], dir);
      antigravity.writeMcps({ ctx7: { command: "npx" } }, dir);
      expect(readFileSync(join(dir, ".agents", "skills", "example", "SKILL.md"), "utf8")).toBe("# Example");
      const out = JSON.parse(readFileSync(join(dir, ".agents", "mcp_config.json"), "utf8"));
      expect(out.mcpServers.ctx7).toEqual({ command: "npx" });
      expect(antigravity.rulesFile(dir)).toBe(join(dir, "AGENTS.md"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
