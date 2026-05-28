/**
 * `cue current` — print the active profile and resolved capability list.
 *
 * Default: profile name + counts (skills / MCPs / plugins) + runtime dir.
 * --verbose: also list every skill grouped by category, every MCP with a
 *            sanity-check on its runtime settings.json entry, and every
 *            hook script grouped by event.
 * --json:    machine-readable output for both modes.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { resolveProfileForCwd } from "../lib/cwd-resolver";
import { loadProfile } from "../lib/profile-loader";

function configDir(): string {
  return process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, "cue") : join(homedir(), ".config", "cue");
}

interface InspectResult {
  profile: string;
  source: string;
  skills: number;
  mcps: number;
  plugins: number;
  runtimeDir: string;
  verbose?: {
    skillsByCategory: Record<string, string[]>;
    mcpServers: Array<{ name: string; configured: boolean }>;
    hooks: Record<string, string[]>;
  };
}

function readSkillsByCategory(runtimeSkillsDir: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!existsSync(runtimeSkillsDir)) return out;
  for (const category of readdirSync(runtimeSkillsDir).sort()) {
    const catDir = join(runtimeSkillsDir, category);
    let st;
    try { st = statSync(catDir); } catch { continue; }
    if (!st.isDirectory()) continue;
    const skills: string[] = [];
    for (const skillName of readdirSync(catDir).sort()) {
      const skillPath = join(catDir, skillName);
      try {
        if (statSync(skillPath).isDirectory()) skills.push(skillName);
      } catch { /* skip unreadable */ }
    }
    if (skills.length > 0) out[category] = skills;
  }
  return out;
}

function readMcpServers(runtimeSettingsPath: string): Array<{ name: string; configured: boolean }> {
  if (!existsSync(runtimeSettingsPath)) return [];
  try {
    const raw = JSON.parse(readFileSync(runtimeSettingsPath, "utf8"));
    const servers = raw.mcpServers ?? {};
    return Object.entries(servers).map(([name, val]: [string, unknown]) => ({
      name,
      configured: typeof val === "object" && val !== null && "command" in (val as Record<string, unknown>),
    })).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function readHooks(runtimeSettingsPath: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!existsSync(runtimeSettingsPath)) return out;
  try {
    const raw = JSON.parse(readFileSync(runtimeSettingsPath, "utf8"));
    const hooks = raw.hooks ?? {};
    for (const [event, entries] of Object.entries(hooks)) {
      const ids: string[] = [];
      for (const entry of (entries as Array<{ hooks?: Array<{ id?: string; description?: string }> }>)) {
        for (const h of entry.hooks ?? []) {
          ids.push(h.id ?? h.description ?? "(unnamed)");
        }
      }
      if (ids.length > 0) out[event] = ids;
    }
  } catch { /* ignore parse errors */ }
  return out;
}

export async function run(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const verbose = args.includes("--verbose") || args.includes("-v");
  const resolved = await resolveProfileForCwd({
    cwd: process.cwd(),
    homeDir: homedir(),
    configDir: configDir(),
  });
  if (resolved.source === "none") {
    process.stdout.write(json ? "{}\n" : "no profile pinned for this cwd\n");
    return 0;
  }
  const profile = await loadProfile(resolved.profile);
  const runtimeDir = join(configDir(), "runtime", resolved.profile);
  const out: InspectResult = {
    profile: resolved.profile,
    source: resolved.source,
    skills: profile.skills.local.length + profile.skills.npx.length,
    mcps: profile.mcps.length,
    plugins: profile.plugins.length,
    runtimeDir,
  };
  if (verbose) {
    out.verbose = {
      skillsByCategory: readSkillsByCategory(join(runtimeDir, "claude", "skills")),
      mcpServers: readMcpServers(join(runtimeDir, "claude", "settings.json")),
      hooks: readHooks(join(runtimeDir, "claude", "settings.json")),
    };
  }
  process.stdout.write(json ? JSON.stringify(out, null, 2) + "\n" : formatHuman(out));
  return 0;
}

function formatHuman(o: InspectResult): string {
  const lines: string[] = [
    `Profile: ${o.profile} (${o.source})`,
    `Skills: ${o.skills}`,
    `MCPs: ${o.mcps}`,
    `Plugins: ${o.plugins}`,
    `Runtime dir: ${o.runtimeDir}`,
  ];
  if (!o.verbose) return lines.join("\n") + "\n";

  lines.push("");
  lines.push("Skills by category:");
  for (const [cat, skills] of Object.entries(o.verbose.skillsByCategory)) {
    lines.push(`  ${cat}/  (${skills.length})`);
    for (const s of skills) lines.push(`    - ${s}`);
  }

  lines.push("");
  lines.push("MCPs:");
  if (o.verbose.mcpServers.length === 0) {
    lines.push("  (none configured in runtime settings.json)");
  } else {
    for (const m of o.verbose.mcpServers) {
      lines.push(`  ${m.configured ? "✓" : "✗"} ${m.name}`);
    }
  }

  lines.push("");
  lines.push("Hooks:");
  if (Object.keys(o.verbose.hooks).length === 0) {
    lines.push("  (none)");
  } else {
    for (const [event, ids] of Object.entries(o.verbose.hooks)) {
      lines.push(`  ${event}:`);
      for (const id of ids) lines.push(`    - ${id}`);
    }
  }

  return lines.join("\n") + "\n";
}
