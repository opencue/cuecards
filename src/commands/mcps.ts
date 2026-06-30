/**
 * `cue mcps` — manage MCP servers in profiles.
 *
 * Subcommands:
 *   list [--json]       — MCPs in active profile
 *   available [--json]  — all MCPs NOT in active profile
 *   add <id>            — add MCP to active profile
 *   remove <id>         — remove MCP from active profile
 *   health [--json]     — ping each MCP in active profile
 */

import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { loadProfile } from "../lib/profile-loader";
import { resolveActiveProfile } from "../lib/cwd-resolver";
import { repoRoot } from "../lib/repo-root";

const PROFILES_DIR = process.env.CUE_PROFILES_DIR ?? join(repoRoot(), "profiles");
const MCP_CONFIGS_DIR = join(repoRoot(), "resources", "mcps", "configs");
const MCP_DOCS_DIR = join(repoRoot(), "resources", "mcps", "mcps");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadAllMcpIds(): string[] {
  const ids = new Set<string>();
  for (const file of ["claude.sanitized.json", "claude_runtime.sanitized.json", "codex.sanitized.json"]) {
    try {
      const raw = JSON.parse(readFileSync(join(MCP_CONFIGS_DIR, file), "utf8"));
      if (raw.servers) for (const id of Object.keys(raw.servers)) ids.add(id);
    } catch { /* file may not exist */ }
  }
  return [...ids].sort();
}

function getMcpDescription(id: string): string {
  try {
    const readme = readFileSync(join(MCP_DOCS_DIR, id, "README.md"), "utf8");
    const firstLine = readme.split("\n").find(l => l.trim() && !l.startsWith("#"));
    return firstLine?.trim().slice(0, 100) ?? "";
  } catch {
    return "";
  }
}

async function getActiveProfileName(): Promise<string | null> {
  try {
    return await resolveActiveProfile();
  } catch {
    return null;
  }
}

async function getActiveProfileMcpIds(): Promise<string[]> {
  const name = await getActiveProfileName();
  if (!name) return [];
  try {
    const profile = await loadProfile(name);
    return profile.mcps.map(m => typeof m === "string" ? m : m.id);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function cmdList(json: boolean): Promise<number> {
  const ids = await getActiveProfileMcpIds();
  const results = ids.map(id => ({ id, description: getMcpDescription(id) }));

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  } else {
    const profileName = await getActiveProfileName();
    process.stdout.write(`MCPs in profile "${profileName}" (${results.length}):\n\n`);
    for (const r of results) {
      process.stdout.write(`  ${r.id}${r.description ? "  — " + r.description : ""}\n`);
    }
  }
  return 0;
}

async function cmdAvailable(json: boolean): Promise<number> {
  const allIds = loadAllMcpIds();
  const activeIds = new Set(await getActiveProfileMcpIds());
  const available = allIds.filter(id => !activeIds.has(id));
  const results = available.map(id => ({ id, description: getMcpDescription(id) }));

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  } else {
    process.stdout.write(`Available MCPs not in active profile (${results.length}):\n\n`);
    for (const r of results) {
      process.stdout.write(`  ${r.id}${r.description ? "  — " + r.description : ""}\n`);
    }
  }
  return 0;
}

async function cmdAdd(id: string): Promise<number> {
  const profileName = await getActiveProfileName();
  if (!profileName) {
    process.stderr.write("No active profile.\n");
    return 1;
  }

  const allIds = loadAllMcpIds();
  if (!allIds.includes(id)) {
    process.stderr.write(`MCP "${id}" not found in registry. Available: ${allIds.join(", ")}\n`);
    return 1;
  }

  const yamlPath = join(PROFILES_DIR, profileName, "profile.yaml");
  let content = await readFile(yamlPath, "utf8");

  if (content.includes(`- ${id}`)) {
    process.stderr.write(`MCP "${id}" already in profile "${profileName}"\n`);
    return 0;
  }

  if (content.includes("mcps:")) {
    const lines = content.split("\n");
    const mcpsIdx = lines.findIndex(l => l.match(/^mcps:/));
    let insertIdx = mcpsIdx + 1;
    while (insertIdx < lines.length && lines[insertIdx]?.match(/^\s+-\s/)) insertIdx++;
    lines.splice(insertIdx, 0, `  - ${id}`);
    content = lines.join("\n");
  } else {
    content = content.trimEnd() + `\nmcps:\n  - ${id}\n`;
  }

  await writeFile(yamlPath, content);
  process.stdout.write(`Added MCP "${id}" to profile "${profileName}"\n`);
  return 0;
}

async function cmdRemove(id: string): Promise<number> {
  const profileName = await getActiveProfileName();
  if (!profileName) {
    process.stderr.write("No active profile.\n");
    return 1;
  }

  const yamlPath = join(PROFILES_DIR, profileName, "profile.yaml");
  const content = await readFile(yamlPath, "utf8");
  const lines = content.split("\n");
  const filtered = lines.filter(l => !l.match(new RegExp(`^\\s+-\\s+${id}\\s*$`)));

  if (filtered.length === lines.length) {
    process.stderr.write(`MCP "${id}" not found in profile "${profileName}"\n`);
    return 1;
  }

  await writeFile(yamlPath, filtered.join("\n"));
  process.stdout.write(`Removed MCP "${id}" from profile "${profileName}"\n`);
  return 0;
}

async function cmdHealth(json: boolean): Promise<number> {
  const ids = await getActiveProfileMcpIds();
  const results: { id: string; status: "up" | "down" | "unknown"; latency_ms?: number }[] = [];

  for (const id of ids) {
    const start = Date.now();
    // Try to check if the MCP process/command exists
    const allConfigs = loadMcpConfig(id);
    if (!allConfigs) {
      results.push({ id, status: "unknown" });
      continue;
    }

    const cmd = allConfigs.command as string | undefined;
    if (!cmd) {
      results.push({ id, status: "unknown" });
      continue;
    }

    // For stdio MCPs, check if the command binary exists
    const expandedCmd = cmd.replace(/^~/, process.env.HOME ?? "~");
    const check = spawnSync("which", [expandedCmd.split("/").pop() ?? cmd], {
      encoding: "utf8",
      timeout: 2000,
    });
    const latency = Date.now() - start;

    if (check.status === 0) {
      results.push({ id, status: "up", latency_ms: latency });
    } else {
      // Try the full path
      const { existsSync } = await import("node:fs");
      if (existsSync(expandedCmd)) {
        results.push({ id, status: "up", latency_ms: latency });
      } else {
        results.push({ id, status: "down", latency_ms: latency });
      }
    }
  }

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  } else {
    process.stdout.write(`MCP Health Check (${results.length} servers):\n\n`);
    for (const r of results) {
      const icon = r.status === "up" ? "✅" : r.status === "down" ? "❌" : "❓";
      const lat = r.latency_ms !== undefined ? ` (${r.latency_ms}ms)` : "";
      process.stdout.write(`  ${icon} ${r.id}${lat}\n`);
    }
  }
  return 0;
}

function loadMcpConfig(id: string): Record<string, unknown> | null {
  for (const file of ["claude_runtime.sanitized.json", "claude.sanitized.json"]) {
    try {
      const raw = JSON.parse(readFileSync(join(MCP_CONFIGS_DIR, file), "utf8"));
      if (raw.servers?.[id]) return raw.servers[id];
    } catch { /* skip */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue mcps — manage MCP servers in profiles

Usage: cue mcps <subcommand> [args]

Subcommands:
  list              MCPs in active profile
  available         MCPs NOT in active profile
  add <id>          Add MCP to active profile
  remove <id>       Remove MCP from active profile
  health            Ping each MCP, show status

Examples:
  cue mcps add coolify
  cue mcps health
`);
    return 0;
  }

  const sub = args[0] ?? "list";
  const json = args.includes("--json");
  const rest = args.filter(a => a !== "--json");

  switch (sub) {
    case "list":
      return cmdList(json);
    case "available":
      return cmdAvailable(json);
    case "add":
      return cmdAdd(rest[1] ?? "");
    case "remove":
      return cmdRemove(rest[1] ?? "");
    case "health":
      return cmdHealth(json);
    default:
      process.stderr.write(`Unknown subcommand: ${sub}. Use: list, available, add, remove, health\n`);
      return 1;
  }
}
