/**
 * Shared profile-runtime preparation helpers.
 *
 * `launch` and `install` both need the same boring setup: wildcard expansion,
 * MCP registry loading, user memory reads, and the materializeRuntime call.
 * Keeping it here avoids the installer drifting from the hot launch path.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { homedir } from "node:os";

import type { AgentKind, ResolvedProfile } from "../../profiles/_types";
import { configDir } from "./config-paths";
import { debug } from "./debug-log";
import { listAllSkillIds, resolveLocalSkill } from "./resolver-local";
import { materializeRuntime, type McpServerConfig, type MaterializeOutput } from "./runtime-materializer";

export type RuntimeAgent = Extract<AgentKind, "claude-code" | "codex">;

export const RUNTIME_AGENTS: RuntimeAgent[] = ["claude-code", "codex"];

export function isRuntimeAgent(agent: AgentKind | string): agent is RuntimeAgent {
  return agent === "claude-code" || agent === "codex";
}

export function runtimeAgentSubdir(agent: RuntimeAgent): "claude" | "codex" {
  return agent === "claude-code" ? "claude" : "codex";
}

export function runtimeDirFor(profileName: string, agent: RuntimeAgent, runtimeRoot = join(configDir(), "runtime")): string {
  return join(runtimeRoot, profileName, runtimeAgentSubdir(agent));
}

export async function expandSkillWildcards(profile: ResolvedProfile): Promise<void> {
  if (!profile.skills.local.some((s) => s.id === "*/*")) return;
  const allIds = await listAllSkillIds();
  const wildcard = profile.skills.local.find((s) => s.id === "*/*")!;
  const existing = new Set(profile.skills.local.filter((s) => s.id !== "*/*").map((s) => s.id));
  profile.skills.local = [
    ...profile.skills.local.filter((s) => s.id !== "*/*"),
    ...allIds.filter((id) => !existing.has(id)).map((id) => ({ ...wildcard, id })),
  ];
}

export async function loadMcpRegistry(agent: RuntimeAgent): Promise<Record<string, McpServerConfig>> {
  const root = process.env.CUE_REPO_ROOT ?? process.env.SOUL_REPO_ROOT ?? resolve(import.meta.dirname, "..", "..");
  const files = agent === "claude-code"
    ? ["claude_runtime.sanitized.json", "claude.sanitized.json"]
    : ["codex.sanitized.json"];

  const merged: Record<string, McpServerConfig> = {};
  for (const file of files) {
    try {
      const text = await readFile(join(root, "resources", "mcps", "configs", file), "utf8");
      const raw = JSON.parse(text) as { servers?: Record<string, McpServerConfig> };
      for (const [id, config] of Object.entries(raw.servers ?? {})) {
        if (!(id in merged)) merged[id] = config;
      }
    } catch {
      // Missing registries are tolerated; validate/doctor report broken refs.
    }
  }

  // The curated master registry wins over the runtime snapshot.
  const master = agent === "claude-code" ? "claude.sanitized.json" : "codex.sanitized.json";
  try {
    const text = await readFile(join(root, "resources", "mcps", "configs", master), "utf8");
    const raw = JSON.parse(text) as { servers?: Record<string, McpServerConfig> };
    for (const [id, config] of Object.entries(raw.servers ?? {})) {
      merged[id] = config;
    }
  } catch (err) {
    debug("runtime-install:master-config", err);
  }

  return merged;
}

export async function readUserAgentMemory(agent: RuntimeAgent): Promise<string> {
  const path = agent === "claude-code"
    ? join(homedir(), ".claude", "CLAUDE.md")
    : join(homedir(), ".codex", "AGENTS.md");
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * True when `dir` sits inside cue's own runtime tree
 * (`<configDir>/runtime/<profile>/<agent>`).
 *
 * Exists to keep that tree out of {@link pickClaudeCredentialsSource}. cue
 * points `CLAUDE_CONFIG_DIR` at the runtime dir when it launches an agent, so
 * every process spawned inside a cue session inherits it — and a nested launch
 * that took it as the credentials SOURCE would overlay a runtime dir onto
 * itself: `overlaySourceState()` links each unmanaged entry to
 * `<runtimeDir>/<name>`, then the atomic tmp→runtimeDir rename leaves every one
 * of those links pointing at its own path. Observed 2026-08-07 on a live
 * profile: 69 self-referential symlinks (`sessions/`, `projects/`,
 * `history.jsonl`, …), all unreadable, and a runtime that reported "Not logged
 * in" until the next launch rewrote `.credentials.json`.
 */
export function isCueRuntimeDir(dir: string, runtimeRoot = join(configDir(), "runtime")): boolean {
  const target = resolve(dir);
  const root = resolve(runtimeRoot);
  return target === root || target.startsWith(root + sep);
}

export async function pickClaudeCredentialsSource(): Promise<string> {
  // An explicit CLAUDE_CONFIG_DIR wins — that is how authmux hands cue a
  // per-account config — but not when it is cue's own runtime dir, which is
  // what a nested launch inherits. Falling through to the real config keeps
  // the overlay sourced from outside the dir being rebuilt.
  const envConfigDir = process.env.CLAUDE_CONFIG_DIR;
  if (envConfigDir && !isCueRuntimeDir(envConfigDir)) return envConfigDir;

  const homeClaude = join(homedir(), ".claude");
  if (existsSync(join(homeClaude, ".credentials.json"))) return homeClaude;

  try {
    const { spawnSync } = await import("node:child_process");
    const { statSync } = await import("node:fs");
    const res = spawnSync("authmux", ["parallel", "--list", "--json"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (res.status === 0 && res.stdout) {
      const parsed = JSON.parse(res.stdout) as { data?: { profiles?: Array<{ name: string; configDir: string }> } };
      const profiles = parsed?.data?.profiles ?? [];
      const withMtime = profiles
        .map((p) => {
          const credsPath = join(p.configDir, ".credentials.json");
          let mtime = 0;
          try { mtime = statSync(credsPath).mtimeMs; } catch { /* missing */ }
          return { ...p, mtime };
        })
        .filter((p) => p.mtime > 0)
        .sort((a, b) => b.mtime - a.mtime);
      const pick = withMtime[0];
      if (pick) {
        process.stderr.write(`▸ cue: inheriting auth from authmux profile "${pick.name}"\n`);
        return pick.configDir;
      }
    }
  } catch {
    // authmux not installed or query failed.
  }

  return homeClaude;
}

export async function resolveClaudeCredentialsSource(options: { healFromRuntime?: boolean } = {}): Promise<string> {
  const picked = await pickClaudeCredentialsSource();
  if (!options.healFromRuntime) return picked;

  try {
    const { syncFreshestToSource } = await import("./credentials-sync");
    const result = await syncFreshestToSource(picked, join(configDir(), "runtime"));
    if (result.synced) {
      process.stderr.write(
        `▸ cue: refreshed source credentials from a sibling runtime (rotated refresh-token healed)\n`,
      );
    }
  } catch (err) {
    debug("runtime-install:runtime-heal", err);
  }
  return picked;
}

export interface PrepareRuntimeOptions {
  profile: ResolvedProfile;
  agent: RuntimeAgent;
  userMemory?: string;
  credentialsSource?: string;
  /**
   * Write the runtime under this on-disk key instead of `profile.name`. Lets a
   * caller (e.g. `cue sync`) rebuild a composite/aliased runtime dir whose key
   * differs from the resolved profile's own name. Defaults to `profile.name`.
   */
  runtimeKey?: string;
}

export async function prepareRuntime(options: PrepareRuntimeOptions): Promise<MaterializeOutput> {
  return materializeRuntime({
    profile: options.profile,
    agent: options.agent,
    runtimeRoot: join(configDir(), "runtime"),
    runtimeKey: options.runtimeKey,
    skillSourceLookup: (id) => resolveLocalSkill(id),
    mcpRegistry: await loadMcpRegistry(options.agent),
    userClaudeMd: options.userMemory ?? await readUserAgentMemory(options.agent),
    credentialsSource: options.credentialsSource,
  });
}
