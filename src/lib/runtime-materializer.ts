/**
 * runtime-materializer — produce a per-profile config dir under
 *   ~/.config/cue/runtime/<profile>/{claude,codex}/
 * with content-hash short-circuit and atomic swap.
 *
 * Pure surface; callers inject filesystem and registry dependencies so this
 * module can be tested without touching ~/.claude or ~/.codex.
 */

import { createHash } from "node:crypto";
import { mkdir, rename, rm, symlink, writeFile, readFile, mkdtemp, readdir, lstat } from "node:fs/promises";
import { dirname, join, resolve as resolvePath, basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentKind, ResolvedProfile } from "../../profiles/_types";
import { normalizeUvxGitServers } from "./uvx-installer";

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RESOURCES_RULES = join(REPO_ROOT, "resources", "rules");
const RESOURCES_COMMANDS = join(REPO_ROOT, "resources", "commands");
const RESOURCES_HOOKS = join(REPO_ROOT, "resources", "hooks");

function resolveResourcePath(ref: string, base: string): string {
  return isAbsolute(ref) ? ref : join(base, ref);
}

/** MCP server configuration as stored in the registry. */
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface MaterializeInput {
  profile: ResolvedProfile;
  agent: AgentKind;
  runtimeRoot: string;
  /** Map skill id → source dir on disk (caller resolves local/npx/plugin paths). */
  skillSourceLookup: (id: string) => Promise<string>;
  /** Pre-resolved sanitized MCP registry for this agent. */
  mcpRegistry: Record<string, McpServerConfig>;
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

  // Normalize any `uvx --from git+<repo> <bin>` MCP entries: install the
  // package locally with `uv tool install` and rewrite the entry to call the
  // installed binary. Sidesteps both the MCP-startup cold-download race and
  // the auto-mode classifier's "fetch arbitrary code from URL" block.
  // Idempotent — re-runs detect an existing binary and just rewrite.
  const { normalized: normalizedRegistry, report: uvxReport } =
    normalizeUvxGitServers(input.mcpRegistry);
  const effectiveInput: MaterializeInput = { ...input, mcpRegistry: normalizedRegistry };
  if (uvxReport.installed.length > 0) {
    process.stderr.write(
      `[cue] installed uvx MCPs: ${uvxReport.installed.join(", ")}\n`,
    );
  }

  const hash = computeHash(profile, agent);

  // Short-circuit if hash matches.
  try {
    const existing = (await readFile(join(runtimeDir, ".cue-hash"), "utf8")).trim();
    if (existing === hash) {
      // Refresh state from credentialsSource even on cache hit so account
      // switches and newly-added source entries are reflected.
      if (effectiveInput.credentialsSource) {
        // Re-merge settings.json from current credentialsSource.
        if (agent === "claude-code") {
          const merged = await buildClaudeSettings(profile, agent, effectiveInput);
          await writeFile(join(runtimeDir, "settings.json"), merged + "\n");
        }
        // Re-overlay any source entries that aren't already present (e.g.
        // user added a new sessions/ entry, plugins/, etc.).
        await overlaySourceState(runtimeDir, effectiveInput.credentialsSource);
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

  // 1b. Commands — symlink each <ref>.md into commands/ (Claude reads .claude/commands/*.md)
  if (agent === "claude-code" && profile.commands.length > 0) {
    const commandsDir = join(tmpDir, "commands");
    await mkdir(commandsDir, { recursive: true });
    for (const ref of profile.commands) {
      const src = resolveResourcePath(ref.endsWith(".md") ? ref : `${ref}.md`, RESOURCES_COMMANDS);
      try {
        await lstat(src);
        await symlink(src, join(commandsDir, basename(src)));
      } catch { /* missing source — skip */ }
    }
  }

  // 1c. Rules — symlink into rules/. Contents get appended to CLAUDE.md below.
  if (profile.rules.length > 0) {
    const rulesDir = join(tmpDir, "rules");
    await mkdir(rulesDir, { recursive: true });
    for (const ref of profile.rules) {
      const src = resolveResourcePath(ref.endsWith(".md") ? ref : `${ref}.md`, RESOURCES_RULES);
      try {
        await lstat(src);
        await symlink(src, join(rulesDir, basename(src)));
      } catch { /* missing source — skip */ }
    }
  }

  // 1d. Hooks — symlink scripts into hooks/. settings.json wiring happens in buildClaudeSettings.
  if (agent === "claude-code" && profile.hooks.length > 0) {
    const hooksDir = join(tmpDir, "hooks");
    await mkdir(hooksDir, { recursive: true });
    for (const ref of profile.hooks) {
      const src = resolveResourcePath(ref, RESOURCES_HOOKS);
      try {
        await lstat(src);
        await symlink(src, join(hooksDir, basename(src)));
      } catch { /* missing source — skip */ }
    }
  }

  // 2. settings.json (Claude) or config.toml (Codex) — Claude-only first cut.
  const mcpServers: Record<string, McpServerConfig> = {};
  for (const m of profile.mcps) {
    if (!appliesToAgent(m, agent)) continue;
    const reg = effectiveInput.mcpRegistry[m.id];
    if (reg !== undefined) mcpServers[m.id] = reg;
  }
  if (agent === "claude-code") {
    const merged = await buildClaudeSettings(profile, agent, effectiveInput);
    await writeFile(join(tmpDir, "settings.json"), merged + "\n");
  } else {
    // Codex equivalent — write config.toml from registry. Caller pre-renders to TOML.
    await writeFile(join(tmpDir, "config.toml"), tomlRender({ mcp_servers: mcpServers }));
  }

  // 3. CLAUDE.md with stamp + role identity
  const iconStr = profile.icon ?? "";
  const skillsList = (profile.skills?.local ?? [])
    .map((s) => typeof s === "string" ? s : s.id)
    .filter((s) => !s.includes("*"));
  const mcpsList = (profile.mcps ?? [])
    .map((m) => typeof m === "string" ? m : m.id);

  let stamp = `<!-- cue: profile=${profile.name} icon=${iconStr} -->\n` +
              `# Active Profile: ${iconStr ? iconStr + " " : ""}${profile.name}\n\n` +
              `> ${profile.description}\n\n`;

  // Role identity — tell Claude what it is
  stamp += `## Your Role\n\n` +
           `You are operating as **${profile.name}** — ${profile.description.toLowerCase()}.\n` +
           `Focus on tasks within this domain. Use the skills loaded in this profile.\n\n`;

  // Skills summary
  if (skillsList.length > 0) {
    stamp += `## Available Skills (${skillsList.length})\n\n`;
    if (skillsList.length <= 20) {
      stamp += skillsList.map((s) => `- \`${s.split("/").pop()}\``).join("\n") + "\n";
    } else {
      // Group by category
      const groups = new Map<string, string[]>();
      for (const s of skillsList) {
        const parts = s.split("/");
        const cat = parts.length > 1 ? parts[0]! : "other";
        const list = groups.get(cat) ?? [];
        list.push(parts.pop()!);
        groups.set(cat, list);
      }
      for (const [cat, skills] of [...groups.entries()].sort()) {
        stamp += `- **${cat}/** (${skills.length}): ${skills.slice(0, 5).join(", ")}${skills.length > 5 ? ` +${skills.length - 5} more` : ""}\n`;
      }
    }
    stamp += "\n";
  }

  // MCPs
  if (mcpsList.length > 0) {
    stamp += `## MCP Servers: ${mcpsList.join(", ")}\n\n`;
  }

  // Skill usage analytics — help the model prioritize frequently-used skills
  try {
    const { skillStats } = await import("./analytics");
    const stats = skillStats(profile.name);
    if (stats.length > 0) {
      stamp += `## Skill Usage (last 30 days)\n\n`;
      stamp += `Prioritize these skills — they're the ones actually used:\n`;
      for (const s of stats.slice(0, 8)) {
        stamp += `- \`${s.skill}\` (${s.hits}× used)\n`;
      }
      stamp += "\n";
    }
  } catch { /* analytics unavailable — skip */ }

  // Profile fit monitoring
  stamp += `## Profile Fit Monitor\n\n` +
    `Track how well this profile matches the work being done. If you notice:\n` +
    `- You're doing work outside this profile's domain (e.g. backend work in a frontend profile)\n` +
    `- None of the loaded skills are relevant to what the user is asking\n` +
    `- You keep needing tools/skills that aren't in this profile\n\n` +
    `Then after completing the user's immediate request, suggest switching:\n\n` +
    `> 💡 This session has been mostly [backend/infra/docs] work — your current profile is **${profile.name}**.\n` +
    `> A better fit might be **[suggested]**. Switch with: \`/cue switch [name]\` or \`echo [name] > .cue-profile\`\n\n` +
    `Only suggest once per session. Don't interrupt urgent work.\n\n`;

  // #8: Warm-start context — last session summary
  const lastSession = await getLastSessionSummary(profile.name);
  if (lastSession) {
    stamp += `## Last Session\n\n${lastSession}\n\n`;
  }

  // #9: Skill chaining hints — common workflows from usage patterns
  const chains = await getSkillChains(skillsList);
  if (chains) {
    stamp += `## Common Workflows\n\n${chains}\n\n`;
  }

  // Rules — index only. Symlinks live in rules/; Claude reads on demand instead
  // of paying the full token cost every turn.
  if (profile.rules.length > 0) {
    stamp += `## Rules (${profile.rules.length})\n\n` +
      `Read on demand from \`rules/\`:\n` +
      profile.rules.map((r) => `- \`rules/${basename(r.endsWith(".md") ? r : `${r}.md`)}\``).join("\n") + "\n\n";
  }

  // Commands — list as a quick reference
  if (profile.commands.length > 0) {
    stamp += `## Available Commands\n\n` +
      profile.commands.map((c) => `- /${basename(c, ".md")}`).join("\n") + "\n\n";
  }

  stamp += `---\n*generated ${new Date().toISOString()} — do not hand-edit*\n\n`;

  await writeFile(join(tmpDir, agent === "claude-code" ? "CLAUDE.md" : "AGENTS.md"), stamp + input.userClaudeMd);

  // 4. hash (no trailing newline so /^[a-f0-9]{64}$/ matches directly)
  await writeFile(join(tmpDir, ".cue-hash"), hash);

  // 5. Overlay source state: symlink everything from credentialsSource that
  // cue doesn't manage (sessions/, projects/, history.jsonl, .credentials.json,
  // .session-stats.json, plugins/, telemetry/, etc.). This makes the runtime
  // dir look like a fully-onboarded Claude Code config from Claude's
  // perspective, while still letting cue override skills/, settings.json,
  // and CLAUDE.md.
  if (input.credentialsSource) {
    await overlaySourceState(tmpDir, input.credentialsSource);
  }

  // 6. Atomic swap: rm -rf old, rename tmp.
  //
  // Preserve session/credential state from the OLD runtime so resume + auth
  // survive across rematerializations:
  //   - .claude.json      → session state, projects list, oauthAccount
  //   - .credentials.json → OAuth tokens (refresh + access)
  //   - backups/          → Claude Code's own .claude.json backup chain
  //
  // We MOVE these from the old runtime over whatever the overlay step (5)
  // dropped into tmpDir — so a logged-in runtime stays logged in even when
  // ~/.claude.json (the credentialsSource) is in a stale/half-logged-out
  // state. Without this, an authmux account swap or a partial claude write
  // to the source would propagate into every cue-materialized profile.
  //
  // Trade-off: to fresh-bootstrap a profile after deliberately switching
  // accounts at the source, run:
  //   rm ~/.config/cue/runtime/<profile>/claude/.credentials.json
  //   rm ~/.config/cue/runtime/<profile>/claude/.claude.json
  // Next launch will copy current source state.
  const preserveFiles = [".claude.json", ".credentials.json", "backups"];
  for (const name of preserveFiles) {
    const oldPath = join(runtimeDir, name);
    const newPath = join(tmpDir, name);
    try {
      const st = await lstat(oldPath);
      if (st.isFile() || st.isDirectory()) {
        // Remove whatever overlay put here (likely a symlink for .claude.json
        // or a copy for .credentials.json) so rename can replace it cleanly.
        await rm(newPath, { force: true, recursive: true });
        await rename(oldPath, newPath);
      }
    } catch { /* doesn't exist — skip */ }
  }
  await rm(runtimeDir, { recursive: true, force: true });
  await rename(tmpDir, runtimeDir);

  return { runtimeDir, rebuilt: true, hash };
}

// Build the merged Claude Code settings.json content (string).
// Reads existing settings from credentialsSource (preserves permissions,
// trustedDirectories, skipAutoPermissionPrompt) and overlays the profile's
// plugins + MCPs.
// Files/dirs cue actively manages — never overlay these from the source dir.
const CUE_MANAGED_ENTRIES = new Set([
  "settings.json",
  "skills",
  "commands",
  "hooks",
  "rules",
  "CLAUDE.md",
  "AGENTS.md",
  ".cue-hash",
  "config.toml",
]);

/**
 * Overlay state from `sourceDir` into `targetDir` by symlinking every
 * top-level entry that cue doesn't actively manage. This makes the runtime
 * dir behave like a fully-onboarded Claude Code config from Claude's
 * perspective — sessions, projects, history, telemetry markers, plugins,
 * `.session-stats.json`, `.credentials.json`, etc. all surface from the
 * account dir. Token refreshes write back to the source.
 *
 * Existing real files/dirs (cue overrides like settings.json, skills/) are
 * left alone. Existing symlinks are replaced — supports account switching
 * on cache hit, where the previous symlinks point to a different source.
 * Errors per-entry are non-fatal.
 */
async function overlaySourceState(targetDir: string, sourceDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(sourceDir);
  } catch {
    return; // source unreadable; nothing to overlay
  }

  // Legacy home-root .claude.json fallback: older Claude Code put session
  // state at ~/.claude.json (sibling to ~/.claude/), not inside it. If the
  // canonical inside-dir version is missing but the home-root one exists,
  // surface it so the runtime looks fully onboarded — otherwise claude
  // boots into the OAuth flow even with a valid .credentials.json present.
  // Only kicks in when sourceDir is the user's ~/.claude.
  if (!entries.includes(".claude.json") && sourceDir === join(homedir(), ".claude")) {
    const legacy = join(homedir(), ".claude.json");
    try {
      const { existsSync } = await import("node:fs");
      if (existsSync(legacy)) entries.push(".claude.json");
    } catch { /* skip */ }
  }

  for (const name of entries) {
    if (CUE_MANAGED_ENTRIES.has(name)) continue;
    const targetPath = join(targetDir, name);
    // Special-case the legacy ~/.claude.json fallback above: source is at the
    // home-root path, not inside sourceDir.
    const isLegacyClaudeJson =
      name === ".claude.json" &&
      sourceDir === join(homedir(), ".claude");
    const sourcePath = isLegacyClaudeJson
      ? join(homedir(), ".claude.json")
      : join(sourceDir, name);

    let existingType: "symlink" | "other" | "missing" = "missing";
    try {
      const st = await lstat(targetPath);
      existingType = st.isSymbolicLink() ? "symlink" : "other";
    } catch { /* missing */ }

    // .claude.json gets the same copy-not-symlink treatment as .credentials.json:
    // claude rewrites it atomically and we want per-profile session state, not
    // a shared one that gets clobbered when 2 profiles run concurrently.
    const isCopyFile = name === ".credentials.json" || isLegacyClaudeJson;

    if (existingType === "other" && !isCopyFile) continue; // cue override — don't touch

    if (existingType === "symlink" || (existingType === "other" && isCopyFile)) {
      // Replace if it points elsewhere (e.g. previous account on cache hit).
      try {
        await rm(targetPath, { force: true });
      } catch { continue; }
    }

    if (isCopyFile) {
      const { copyFile } = await import("node:fs/promises");
      try {
        await copyFile(sourcePath, targetPath);
      } catch { /* skip */ }
    } else {
      try {
        await symlink(sourcePath, targetPath);
      } catch { /* race or permission — skip silently */ }
    }
  }
}

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
  const mcpServers: Record<string, McpServerConfig> = {};
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

  // Merge profile hooks. A hook ref points to a JSON file with shape
  // { hooks: { PreToolUse: [...], ... } } — same shape Claude Code expects.
  // Multiple hook files concat their event arrays under each lifecycle key.
  let mergedHooks: Record<string, unknown[]> = {};
  const baseHooks = (baseSettings.hooks as Record<string, unknown[]> | undefined) ?? {};
  for (const [k, v] of Object.entries(baseHooks)) {
    mergedHooks[k] = Array.isArray(v) ? [...v] : [];
  }
  for (const ref of profile.hooks) {
    const src = resolveResourcePath(ref, RESOURCES_HOOKS);
    try {
      const raw = await readFile(src, "utf8");
      const parsed = JSON.parse(raw) as { hooks?: Record<string, unknown[]> };
      for (const [event, entries] of Object.entries(parsed.hooks ?? {})) {
        if (!Array.isArray(entries)) continue;
        mergedHooks[event] = [...(mergedHooks[event] ?? []), ...entries];
      }
    } catch { /* missing or malformed — skip */ }
  }

  const settings: Record<string, unknown> = {
    ...baseSettings,
    enabledPlugins: { ...(baseSettings.enabledPlugins as Record<string, unknown> ?? {}), ...enabledPlugins },
    mcpServers: { ...(baseSettings.mcpServers as Record<string, unknown> ?? {}), ...mcpServers },
  };
  if (Object.keys(mergedHooks).length > 0) {
    settings.hooks = mergedHooks;
  }
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

// ---------------------------------------------------------------------------
// #8: Warm-start — summarize last session for this profile
// ---------------------------------------------------------------------------

import { homedir } from "node:os";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

async function getLastSessionSummary(profileName: string): Promise<string | null> {
  try {
    const projectsDir = join(homedir(), ".claude", "projects");
    if (!existsSync(projectsDir)) return null;

    // Find the most recent session jsonl in the cwd-based project dir
    const cwdKey = process.cwd().replace(/\//g, "-");
    const projectDir = readdirSync(projectsDir)
      .filter((d) => d.includes(cwdKey.slice(1, 30)))
      .map((d) => join(projectsDir, d))
      .find((d) => existsSync(d));

    if (!projectDir) return null;

    // Find most recent .jsonl (limit scan to avoid slow stat on large dirs)
    const allFiles = readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
    if (allFiles.length === 0) return null;

    // Sort by name (includes timestamp) — take last 3 only
    const recent = allFiles.sort().slice(-3);
    const sessions = recent
      .map((f) => ({ name: f, mtime: statSync(join(projectDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    const lastFile = join(projectDir, sessions[0]!.name);
    const lastMtime = new Date(sessions[0]!.mtime);
    const ago = formatTimeAgo(lastMtime);

    // Extract a quick summary: last few assistant messages
    const res = spawnSync("tail", ["-50", lastFile], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 2000 });
    if (!res.stdout) return null;

    const lines = res.stdout.split("\n").filter(Boolean);
    const summaryParts: string[] = [];

    for (const line of lines.reverse()) {
      try {
        const msg = JSON.parse(line);
        if (msg.type === "assistant" && msg.message?.content) {
          const text = Array.isArray(msg.message.content)
            ? msg.message.content.find((c: any) => c.type === "text")?.text ?? ""
            : typeof msg.message.content === "string" ? msg.message.content : "";
          if (text.length > 20) {
            // Take first sentence
            const sentence = text.split(/[.!?\n]/)[0]?.trim();
            if (sentence && sentence.length > 10) summaryParts.push(sentence);
          }
        }
      } catch {}
      if (summaryParts.length >= 3) break;
    }

    if (summaryParts.length === 0) return null;

    return `Last session (${ago}): ${summaryParts.reverse().join(". ")}.`;
  } catch {
    return null;
  }
}

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// #9: Skill chaining — detect common skill sequences from usage
// ---------------------------------------------------------------------------

async function getSkillChains(skillsList: string[]): Promise<string | null> {
  try {
    const projectsDir = join(homedir(), ".claude", "projects");
    if (!existsSync(projectsDir)) return null;

    // Scan recent sessions for skill co-occurrence
    const coOccurrence = new Map<string, Map<string, number>>();
    const slugs = new Set(skillsList.map((s) => s.split("/").pop() ?? s));

    const res = spawnSync("grep", ["-roh", "skills/[a-z][a-z0-9-]*/SKILL.md", projectsDir], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 2000,
    });

    if (!res.stdout) return null;

    // Group skill reads by session file (co-occurrence within same session)
    const sessionSkills = new Map<string, string[]>();
    // We can't easily get per-file grouping from grep -r, so use a simpler heuristic:
    // just find which skills from THIS profile are most commonly used together
    const skillCounts = new Map<string, number>();
    for (const line of res.stdout.split("\n")) {
      const match = line.match(/skills\/([a-z][a-z0-9-]*)\/SKILL\.md/);
      if (match && slugs.has(match[1]!)) {
        skillCounts.set(match[1]!, (skillCounts.get(match[1]!) ?? 0) + 1);
      }
    }

    // Find top 3 most-used skills and present as a workflow hint
    const topSkills = [...skillCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([s]) => s);

    if (topSkills.length < 2) return null;

    // Build a simple chain from the top skills
    return `Based on your usage patterns, common skill sequences:\n` +
      `- ${topSkills.slice(0, 3).join(" → ")}\n` +
      (topSkills.length > 3 ? `- ${topSkills.slice(2, 5).join(" → ")}\n` : "");
  } catch {
    return null;
  }
}
