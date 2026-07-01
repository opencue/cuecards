/**
 * Agent adapters — materialize skills + MCPs for any AI coding agent.
 *
 * Each adapter knows how to write skills and MCP configs in the format
 * that a specific agent expects.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, } from "node:fs";
import { join, } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface AgentAdapter {
  /** Agent identifier (used in profile.yaml agents field) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Where this agent reads its config from */
  configDir(): string;
  /** Write skills as the agent's rules/instructions file */
  writeSkills(skills: { id: string; content: string }[], targetDir: string): void;
  /** Write MCP server configs in the agent's format */
  writeMcps(mcps: Record<string, unknown>, targetDir: string): void;
  /**
   * Absolute path of this agent's NATIVE rules/instructions file under
   * targetDir, or null if the agent has no single rules file. Used by
   * `cue ruler` to fan a profile's rules out to every agent. The path mirrors
   * each adapter's `writeSkills` target so cue stays internally consistent.
   */
  rulesFile(targetDir: string): string | null;
  /** Try to find the agent binary on PATH */
  detectBinary(): string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findBinary(name: string): string | null {
  const res = spawnSync("which", [name], { encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() : null;
}

function concatSkills(skills: { id: string; content: string }[]): string {
  return skills.map(s => `<!-- skill: ${s.id} -->\n${s.content}`).join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// Claude Code adapter (existing behavior)
// ---------------------------------------------------------------------------

export const claudeCode: AgentAdapter = {
  id: "claude-code",
  name: "Claude Code",
  configDir: () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
  writeSkills(skills, targetDir) {
    const skillsDir = join(targetDir, "skills");
    mkdirSync(skillsDir, { recursive: true });
    // Skills are symlinked individually (handled by materializer)
  },
  writeMcps(mcps, targetDir) {
    const settingsPath = join(targetDir, "settings.json");
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      try { settings = JSON.parse(readFileSync(settingsPath, "utf8")); } catch {}
    }
    settings.mcpServers = { ...(settings.mcpServers as Record<string, unknown> ?? {}), ...mcps };
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  },
  rulesFile: (targetDir) => join(targetDir, "CLAUDE.md"),
  detectBinary: () => findBinary("claude"),
};

// ---------------------------------------------------------------------------
// Codex adapter (existing behavior)
// ---------------------------------------------------------------------------

export const codex: AgentAdapter = {
  id: "codex",
  name: "Codex",
  configDir: () => process.env.CODEX_HOME ?? join(homedir(), ".codex"),
  writeSkills(skills, targetDir) {
    const skillsDir = join(targetDir, "skills");
    mkdirSync(skillsDir, { recursive: true });
  },
  writeMcps(mcps, targetDir) {
    // Codex uses config.toml
    const lines: string[] = [];
    for (const [id, val] of Object.entries(mcps)) {
      lines.push(`[mcp_servers.${id}]`);
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        lines.push(`${k} = ${JSON.stringify(v)}`);
      }
      lines.push("");
    }
    writeFileSync(join(targetDir, "config.toml"), lines.join("\n"));
  },
  rulesFile: (targetDir) => join(targetDir, "AGENTS.md"),
  detectBinary: () => findBinary("codex"),
};

// ---------------------------------------------------------------------------
// Cursor adapter
// ---------------------------------------------------------------------------

export const cursor: AgentAdapter = {
  id: "cursor",
  name: "Cursor",
  configDir: () => process.cwd(), // project-local
  writeSkills(skills, targetDir) {
    // Cursor reads .cursorrules in project root
    const content = concatSkills(skills);
    writeFileSync(join(targetDir, ".cursorrules"), content);
  },
  writeMcps(mcps, targetDir) {
    // Cursor reads .cursor/mcp.json
    const cursorDir = join(targetDir, ".cursor");
    mkdirSync(cursorDir, { recursive: true });
    writeFileSync(join(cursorDir, "mcp.json"), JSON.stringify({ mcpServers: mcps }, null, 2));
  },
  rulesFile: (targetDir) => join(targetDir, ".cursorrules"),
  detectBinary: () => findBinary("cursor"),
};

// ---------------------------------------------------------------------------
// Cline adapter
// ---------------------------------------------------------------------------

export const cline: AgentAdapter = {
  id: "cline",
  name: "Cline",
  configDir: () => process.cwd(),
  writeSkills(skills, targetDir) {
    // Cline reads .clinerules in project root
    const content = concatSkills(skills);
    writeFileSync(join(targetDir, ".clinerules"), content);
  },
  writeMcps(mcps, targetDir) {
    // Cline reads cline_mcp_settings.json in project root
    writeFileSync(join(targetDir, "cline_mcp_settings.json"), JSON.stringify({ mcpServers: mcps }, null, 2));
  },
  rulesFile: (targetDir) => join(targetDir, ".clinerules"),
  detectBinary: () => null, // VS Code extension, no binary
};

// ---------------------------------------------------------------------------
// Windsurf adapter
// ---------------------------------------------------------------------------

export const windsurf: AgentAdapter = {
  id: "windsurf",
  name: "Windsurf",
  configDir: () => process.cwd(),
  writeSkills(skills, targetDir) {
    const content = concatSkills(skills);
    writeFileSync(join(targetDir, ".windsurfrules"), content);
  },
  writeMcps(mcps, targetDir) {
    // Windsurf uses same format as Cursor
    const dir = join(targetDir, ".windsurf");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mcp.json"), JSON.stringify({ mcpServers: mcps }, null, 2));
  },
  rulesFile: (targetDir) => join(targetDir, ".windsurfrules"),
  detectBinary: () => findBinary("windsurf"),
};

// ---------------------------------------------------------------------------
// Gemini CLI adapter
// ---------------------------------------------------------------------------

export const gemini: AgentAdapter = {
  id: "gemini",
  name: "Gemini CLI",
  configDir: () => join(homedir(), ".gemini"),
  writeSkills(skills, targetDir) {
    // Gemini reads skills from ~/.gemini/skills/ as individual files
    const skillsDir = join(targetDir, "skills");
    mkdirSync(skillsDir, { recursive: true });
    for (const s of skills) {
      const slug = s.id.split("/").pop() ?? s.id;
      writeFileSync(join(skillsDir, `${slug}.md`), s.content);
    }
  },
  writeMcps(mcps, targetDir) {
    // Gemini uses settings.json with mcpServers
    const settingsPath = join(targetDir, "settings.json");
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      try { settings = JSON.parse(readFileSync(settingsPath, "utf8")); } catch {}
    }
    settings.mcpServers = mcps;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  },
  rulesFile: (targetDir) => join(targetDir, "GEMINI.md"),
  detectBinary: () => findBinary("gemini"),
};

// ---------------------------------------------------------------------------
// GitHub Copilot adapter
// ---------------------------------------------------------------------------

export const copilot: AgentAdapter = {
  id: "copilot",
  name: "GitHub Copilot",
  configDir: () => process.cwd(),
  writeSkills(skills, targetDir) {
    // Copilot reads .github/copilot-instructions.md
    const ghDir = join(targetDir, ".github");
    mkdirSync(ghDir, { recursive: true });
    const content = concatSkills(skills);
    writeFileSync(join(ghDir, "copilot-instructions.md"), content);
  },
  writeMcps(mcps, targetDir) {
    // Copilot uses .vscode/mcp.json or .github/mcp.json
    const ghDir = join(targetDir, ".github");
    mkdirSync(ghDir, { recursive: true });
    writeFileSync(join(ghDir, "mcp.json"), JSON.stringify({ servers: mcps }, null, 2));
  },
  rulesFile: (targetDir) => join(targetDir, ".github", "copilot-instructions.md"),
  detectBinary: () => null, // VS Code extension
};

// ---------------------------------------------------------------------------
// Roo Code adapter
// ---------------------------------------------------------------------------

export const roo: AgentAdapter = {
  id: "roo",
  name: "Roo Code",
  configDir: () => process.cwd(),
  writeSkills(skills, targetDir) {
    // Roo reads .roo/rules/
    const rulesDir = join(targetDir, ".roo", "rules");
    mkdirSync(rulesDir, { recursive: true });
    for (const s of skills) {
      const slug = s.id.split("/").pop() ?? s.id;
      writeFileSync(join(rulesDir, `${slug}.md`), s.content);
    }
  },
  writeMcps(mcps, targetDir) {
    // Roo uses .roo/mcp.json
    const rooDir = join(targetDir, ".roo");
    mkdirSync(rooDir, { recursive: true });
    writeFileSync(join(rooDir, "mcp.json"), JSON.stringify({ mcpServers: mcps }, null, 2));
  },
  rulesFile: (targetDir) => join(targetDir, ".roo", "rules", "cue-rules.md"),
  detectBinary: () => null, // VS Code extension
};

// ---------------------------------------------------------------------------
// Amp adapter
// ---------------------------------------------------------------------------

export const amp: AgentAdapter = {
  id: "amp",
  name: "Amp",
  configDir: () => process.cwd(),
  writeSkills(skills, targetDir) {
    // Amp reads AGENTS.md in project root
    const content = concatSkills(skills);
    writeFileSync(join(targetDir, "AGENTS.md"), content);
  },
  writeMcps(mcps, targetDir) {
    // Amp uses .amp/mcp.json
    const ampDir = join(targetDir, ".amp");
    mkdirSync(ampDir, { recursive: true });
    writeFileSync(join(ampDir, "mcp.json"), JSON.stringify({ mcpServers: mcps }, null, 2));
  },
  rulesFile: (targetDir) => join(targetDir, "AGENTS.md"),
  detectBinary: () => findBinary("amp"),
};

// ---------------------------------------------------------------------------
// Aider adapter
// ---------------------------------------------------------------------------

export const aider: AgentAdapter = {
  id: "aider",
  name: "Aider",
  configDir: () => process.cwd(),
  writeSkills(skills, targetDir) {
    // Aider reads .aider.conf.yml conventions
    const content = concatSkills(skills);
    writeFileSync(join(targetDir, ".aider.conventions.md"), content);
  },
  writeMcps(_mcps, _targetDir) {
    // Aider doesn't support MCP
  },
  rulesFile: (targetDir) => join(targetDir, ".aider.conventions.md"),
  detectBinary: () => findBinary("aider"),
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const ADAPTERS: Record<string, AgentAdapter> = {
  "claude-code": claudeCode,
  "codex": codex,
  "cursor": cursor,
  "cline": cline,
  "windsurf": windsurf,
  "gemini": gemini,
  "copilot": copilot,
  "roo": roo,
  "amp": amp,
  "aider": aider,
};

export const AGENT_IDS = Object.keys(ADAPTERS);

export function getAdapter(id: string): AgentAdapter | null {
  return ADAPTERS[id] ?? null;
}
