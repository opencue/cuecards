/**
 * runtime-materializer — produce a per-profile config dir under
 *   ~/.config/cue/runtime/<profile>/{claude,codex}/
 * with content-hash short-circuit and atomic swap.
 *
 * Pure surface; callers inject filesystem and registry dependencies so this
 * module can be tested without touching ~/.claude or ~/.codex.
 */

import { createHash } from "node:crypto";
import { mkdir, rename, rm, symlink, writeFile, readFile, mkdtemp } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { AgentKind, ResolvedProfile } from "../../profiles/_types";

export interface MaterializeInput {
  profile: ResolvedProfile;
  agent: AgentKind;
  runtimeRoot: string;
  /** Map skill id → source dir on disk (caller resolves local/npx/plugin paths). */
  skillSourceLookup: (id: string) => Promise<string>;
  /** Pre-resolved sanitized MCP registry for this agent. */
  mcpRegistry: Record<string, unknown>;
  /** Content of ~/.claude/CLAUDE.md (or ~/.codex/AGENTS.md) to append. */
  userClaudeMd: string;
  /** Directory to copy .credentials.json from (e.g. a pre-set CLAUDE_CONFIG_DIR). */
  credentialsSource?: string;
}

export interface MaterializeOutput {
  runtimeDir: string;
  rebuilt: boolean;
  hash: string;
}

function agentSubdir(agent: AgentKind): string {
  return agent === "claude-code" ? "claude" : "codex";
}

function appliesToAgent(scoped: { agents?: AgentKind[] }, agent: AgentKind): boolean {
  if (!scoped.agents || scoped.agents.length === 0) return true;
  return scoped.agents.includes(agent);
}

function sortedJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(sortedJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + sortedJson(obj[k])).join(",") + "}";
}

function computeHash(profile: ResolvedProfile, agent: AgentKind): string {
  const canonical = sortedJson({ agent, profile });
  return createHash("sha256").update(canonical).digest("hex");
}

export async function materializeRuntime(input: MaterializeInput): Promise<MaterializeOutput> {
  const { profile, agent, runtimeRoot } = input;
  const runtimeDir = join(runtimeRoot, profile.name, agentSubdir(agent));
  const hash = computeHash(profile, agent);

  // Short-circuit if hash matches.
  try {
    const existing = (await readFile(join(runtimeDir, ".cue-hash"), "utf8")).trim();
    if (existing === hash) {
      // Always refresh credentials AND settings on cache hit so account
      // switches don't leak settings/permissions across runs.
      if (input.credentialsSource) {
        const { copyFile } = await import("node:fs/promises");
        try {
          await copyFile(
            join(input.credentialsSource, ".credentials.json"),
            join(runtimeDir, ".credentials.json"),
          );
        } catch { /* no credentials yet */ }
        // Re-merge settings.json from current credentialsSource.
        if (agent === "claude-code") {
          const merged = await buildClaudeSettings(profile, agent, input);
          await writeFile(join(runtimeDir, "settings.json"), merged + "\n");
        }
      }
      return { runtimeDir, rebuilt: false, hash };
    }
  } catch { /* not present — fall through to build */ }

  // Build in a sibling tmp dir, atomic-swap at the end.
  await mkdir(dirname(runtimeDir), { recursive: true });
  const tmpDir = await mkdtemp(`${runtimeDir}.tmp.`);

  // 1. Skills
  const skillsDir = join(tmpDir, "skills");
  await mkdir(skillsDir, { recursive: true });
  for (const skill of profile.skills.local) {
    if (!appliesToAgent(skill, agent)) continue;
    const src = await input.skillSourceLookup(skill.id);
    const target = join(skillsDir, skill.id);
    await mkdir(dirname(target), { recursive: true });
    await symlink(src, target);
  }

  // 2. settings.json (Claude) or config.toml (Codex) — Claude-only first cut.
  const mcpServers: Record<string, unknown> = {};
  for (const m of profile.mcps) {
    if (!appliesToAgent(m, agent)) continue;
    const reg = input.mcpRegistry[m.id];
    if (reg !== undefined) mcpServers[m.id] = reg;
  }
  if (agent === "claude-code") {
    const merged = await buildClaudeSettings(profile, agent, input);
    await writeFile(join(tmpDir, "settings.json"), merged + "\n");
  } else {
    // Codex equivalent — write config.toml from registry. Caller pre-renders to TOML.
    await writeFile(join(tmpDir, "config.toml"), tomlRender({ mcp_servers: mcpServers }));
  }

  // 3. CLAUDE.md with stamp
  const iconStr = profile.icon ?? "";
  const stamp = `<!-- cue: profile=${profile.name} icon=${iconStr} -->\n` +
                `# Active Profile: ${iconStr ? iconStr + " " : ""}${profile.name}\n` +
                `> ${profile.description}\n` +
                `> generated ${new Date().toISOString()} — do not hand-edit\n\n`;
  await writeFile(join(tmpDir, agent === "claude-code" ? "CLAUDE.md" : "AGENTS.md"), stamp + input.userClaudeMd);

  // 4. hash (no trailing newline so /^[a-f0-9]{64}$/ matches directly)
  await writeFile(join(tmpDir, ".cue-hash"), hash);

  // 5. Copy .credentials.json from source config dir (auth persistence).
  if (input.credentialsSource) {
    const credSrc = join(input.credentialsSource, ".credentials.json");
    try {
      const { copyFile } = await import("node:fs/promises");
      await copyFile(credSrc, join(tmpDir, ".credentials.json"));
    } catch { /* no credentials yet — user will log in once */ }
  }

  // 6. Atomic swap: rm -rf old, rename tmp.
  await rm(runtimeDir, { recursive: true, force: true });
  await rename(tmpDir, runtimeDir);

  return { runtimeDir, rebuilt: true, hash };
}

// Build the merged Claude Code settings.json content (string).
// Reads existing settings from credentialsSource (preserves permissions,
// trustedDirectories, skipAutoPermissionPrompt) and overlays the profile's
// plugins + MCPs.
async function buildClaudeSettings(
  profile: ResolvedProfile,
  agent: AgentKind,
  input: MaterializeInput,
): Promise<string> {
  const enabledPlugins: Record<string, true> = {};
  for (const plugin of profile.plugins) {
    if (!appliesToAgent(plugin, agent)) continue;
    enabledPlugins[plugin.id] = true;
  }
  const mcpServers: Record<string, unknown> = {};
  for (const m of profile.mcps) {
    if (!appliesToAgent(m, agent)) continue;
    const reg = input.mcpRegistry[m.id];
    if (reg !== undefined) mcpServers[m.id] = reg;
  }
  let baseSettings: Record<string, unknown> = {};
  if (input.credentialsSource) {
    try {
      const raw = await readFile(join(input.credentialsSource, "settings.json"), "utf8");
      baseSettings = JSON.parse(raw);
    } catch { /* no existing settings — start fresh */ }
  }
  const settings = {
    ...baseSettings,
    enabledPlugins: { ...(baseSettings.enabledPlugins as Record<string, unknown> ?? {}), ...enabledPlugins },
    mcpServers: { ...(baseSettings.mcpServers as Record<string, unknown> ?? {}), ...mcpServers },
  };
  return JSON.stringify(settings, null, 2);
}

// Minimal TOML emitter for the MCP config block. Replace with `@iarna/toml` if
// we need broader coverage. Codex only reads a flat-ish [mcp_servers.<id>] table.
function tomlRender(obj: { mcp_servers: Record<string, unknown> }): string {
  const out: string[] = [];
  for (const [id, val] of Object.entries(obj.mcp_servers)) {
    out.push(`[mcp_servers.${id}]`);
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out.push(`${k} = ${JSON.stringify(v)}`);
    }
    out.push("");
  }
  return out.join("\n");
}
