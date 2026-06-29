/**
 * MCP catalog + profile-write helpers, shared by the dashboard server's
 * `/api/v1/mcps/catalog` and `/api/v1/mcps/add` endpoints.
 *
 * The "catalog" is the union of MCP server ids declared across cue's sanitized
 * config snapshots (`resources/mcps/configs/*.sanitized.json`) — the same set
 * `cue mcps add` validates against, so the studio never offers an MCP the CLI
 * would then reject. Per-entry transport + install command are inferred from
 * the server config; the description is the first prose line of the MCP's
 * `README.md` when one exists (most catalog entries have none — that's fine,
 * the card just shows the id).
 *
 * Paths are resolved per-call from env so tests can point CUE_PROFILES_DIR /
 * CUE_REPO_ROOT at a fixture tree without a real write to `profiles/`.
 */

import { readFileSync } from "node:fs";
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";

import { profilesDir, repoRoot } from "./repo-root";

function configsDir(): string {
  return join(repoRoot(), "resources", "mcps", "configs");
}
function docsDir(): string {
  return join(repoRoot(), "resources", "mcps", "mcps");
}

const CONFIG_FILES = [
  "claude.sanitized.json",
  "claude_runtime.sanitized.json",
  "codex.sanitized.json",
] as const;

export type McpTransport = "stdio" | "sse" | "http" | "unknown";

export interface McpCatalogEntry {
  id: string;
  description: string;
  transport: McpTransport;
  install: string;
}

interface ServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  type?: string;
}

/** Union of server ids across all sanitized config snapshots, sorted. */
export function loadAllMcpIds(): string[] {
  const ids = new Set<string>();
  for (const file of CONFIG_FILES) {
    try {
      const raw = JSON.parse(readFileSync(join(configsDir(), file), "utf8"));
      if (raw.servers) for (const id of Object.keys(raw.servers)) ids.add(id);
    } catch {
      /* file may not exist in every snapshot */
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

/** First matching server config for `id` across the snapshots, or null. */
function loadServerConfig(id: string): ServerConfig | null {
  for (const file of CONFIG_FILES) {
    try {
      const raw = JSON.parse(readFileSync(join(configsDir(), file), "utf8"));
      if (raw.servers?.[id]) return raw.servers[id] as ServerConfig;
    } catch {
      /* skip */
    }
  }
  return null;
}

/** First prose line of the MCP's README.md (skipping headings), capped. */
export function getMcpDescription(id: string): string {
  try {
    const readme = readFileSync(join(docsDir(), id, "README.md"), "utf8");
    const firstLine = readme.split("\n").find((l) => l.trim() && !l.startsWith("#"));
    return firstLine?.trim().slice(0, 140) ?? "";
  } catch {
    return "";
  }
}

function transportOf(cfg: ServerConfig | null): McpTransport {
  if (!cfg) return "unknown";
  if (cfg.type === "stdio" || cfg.type === "sse" || cfg.type === "http") return cfg.type;
  if (cfg.url) return cfg.url.includes("/sse") ? "sse" : "http";
  if (cfg.command) return "stdio";
  return "unknown";
}

function installOf(cfg: ServerConfig | null): string {
  if (!cfg) return "";
  if (cfg.command) {
    const args = cfg.args?.length ? " " + cfg.args.join(" ") : "";
    return (cfg.command + args).trim();
  }
  if (cfg.url) return cfg.url;
  return "";
}

/** Full catalog: every addable MCP with inferred transport + install hint. */
export function loadMcpCatalog(): McpCatalogEntry[] {
  return loadAllMcpIds().map((id) => {
    const cfg = loadServerConfig(id);
    return {
      id,
      description: getMcpDescription(id),
      transport: transportOf(cfg),
      install: installOf(cfg),
    };
  });
}

export interface AddMcpResult {
  id: string;
  profile: string;
  alreadyPresent: boolean;
}

/**
 * Append `id` to the `mcps:` list of `profileName`'s profile.yaml.
 *
 * `profileName` must be a single, physical profile (a `profiles/<name>/`
 * directory) — composite runtime profiles like `core+skill-writer` have no
 * file to write, so the caller resolves which part-profile to target before
 * calling. Validates the id against the catalog and guards the profile name
 * against path traversal. Idempotent: a no-op (alreadyPresent: true) when the
 * id is already wired.
 */
export async function addMcpToProfile(id: string, profileName: string): Promise<AddMcpResult> {
  if (!id || !loadAllMcpIds().includes(id)) {
    throw new Error(`unknown-mcp: "${id}" is not in the cue catalog`);
  }
  // Reject anything that could escape profiles/ — names are flat slugs.
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(profileName)) {
    throw new Error(`invalid-profile: "${profileName}"`);
  }
  const dir = profilesDir();
  const yamlPath = join(dir, profileName, "profile.yaml");
  if (!resolve(yamlPath).startsWith(resolve(dir))) {
    throw new Error(`invalid-profile: "${profileName}"`);
  }
  try {
    await access(yamlPath);
  } catch {
    throw new Error(
      `not-a-physical-profile: "${profileName}" has no profile.yaml (composite profiles can't be written directly)`,
    );
  }

  let content = await readFile(yamlPath, "utf8");

  // Already present? Match a list item exactly so "- gbrain" doesn't match
  // "- gbrain-extra".
  const present = content
    .split("\n")
    .some((l) => new RegExp(`^\\s*-\\s+${escapeRe(id)}\\s*(#.*)?$`).test(l));
  if (present) return { id, profile: profileName, alreadyPresent: true };

  if (/^mcps:/m.test(content)) {
    const lines = content.split("\n");
    const mcpsIdx = lines.findIndex((l) => /^mcps:/.test(l));
    let insertIdx = mcpsIdx + 1;
    while (insertIdx < lines.length && /^\s+-\s/.test(lines[insertIdx] ?? "")) insertIdx++;
    lines.splice(insertIdx, 0, `  - ${id}`);
    content = lines.join("\n");
  } else {
    content = content.trimEnd() + `\nmcps:\n  - ${id}\n`;
  }

  await writeFile(yamlPath, content);
  return { id, profile: profileName, alreadyPresent: false };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
