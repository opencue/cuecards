/**
 * Claude Code plugin scanner (Agent A11).
 *
 * Read-only inventory for A12's profile generator. It reads Claude's
 * `enabledPlugins` config, cross-checks the installed plugin tree, and returns
 * every plugin with the skills it exposes.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

import { _internal as pluginResolverInternal } from "./resolver-plugins";

export type DiscoveredPluginStatus = "Enabled" | "Broken" | "Disabled";

export interface DiscoveredPluginSkill {
  name: string;
  description: string;
  /** Absolute path to the skill's SKILL.md, for loading the full doc on demand. */
  skillMdPath?: string;
}

export interface ScanPluginDiagnostic {
  code: string;
  message: string;
  path?: string;
}

export interface DiscoveredPlugin {
  /** Plugin name from the manifest when available, otherwise the directory/ref. */
  name: string;
  /** Stable identity, usually `<name>@<marketplace>` for marketplace plugins. */
  id?: string;
  marketplace?: string;
  version?: string;
  path?: string;
  status: DiscoveredPluginStatus;
  skills: DiscoveredPluginSkill[];
  diagnostics?: ScanPluginDiagnostic[];
}

export interface ScanPluginsOptions {
  /** Path to Claude config. Defaults to ~/.claude.json with settings fallback. */
  claudeConfigPath?: string;
  /** Installed plugins root. Defaults through A8's resolver helper. */
  pluginsRoot?: string;
}

interface EnabledPluginRef {
  ref: string;
  enabled: boolean;
}

interface InstalledPlugin {
  name: string;
  id: string;
  marketplace?: string;
  version?: string;
  dir: string;
  skillsPath?: string;
}

interface ConfigReadOk {
  ok: true;
  refs: EnabledPluginRef[];
  configFound: boolean;
}

interface ConfigReadErr {
  ok: false;
  diagnostic: ScanPluginDiagnostic;
}

type ConfigRead = ConfigReadOk | ConfigReadErr;

export async function scanPlugins(
  options: ScanPluginsOptions = {},
): Promise<DiscoveredPlugin[]> {
  const pluginsRoot = pluginResolverInternal.resolvePluginsRoot(
    options.pluginsRoot,
  );
  const config = await readEnabledPlugins(options.claudeConfigPath);
  if (!config.ok) return [diagnosticPlugin(config.diagnostic)];
  if (options.claudeConfigPath && !config.configFound) return [];

  const installed = await discoverInstalledPlugins(pluginsRoot);
  const seen = new Set<string>();
  const out: DiscoveredPlugin[] = [];

  for (const entry of config.refs) {
    const parsed = parsePluginRef(entry.ref);
    const found = findInstalled(installed, parsed);
    const fallbackId = parsed.marketplace
      ? `${parsed.name}@${parsed.marketplace}`
      : parsed.name;

    if (found) {
      seen.add(found.id);
      out.push(await toDiscovered(found, entry.enabled ? "Enabled" : "Disabled"));
      continue;
    }

    seen.add(fallbackId);
    out.push({
      name: parsed.name,
      id: fallbackId,
      marketplace: parsed.marketplace,
      status: "Broken",
      skills: [],
      diagnostics: [
        {
          code: "PLUGIN_DIR_MISSING",
          message:
            `Plugin "${entry.ref}" is listed in enabledPlugins but no ` +
            `install directory was found under "${pluginsRoot}".`,
          path: pluginsRoot,
        },
      ],
    });
  }

  const installedOnly = [...installed.values()]
    .filter((plugin) => !seen.has(plugin.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const plugin of installedOnly) {
    out.push(await toDiscovered(plugin, "Disabled"));
  }

  return out;
}

async function readEnabledPlugins(
  explicitPath?: string,
): Promise<ConfigRead> {
  const configPath = await chooseConfigPath(explicitPath);
  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch {
    return { ok: true, refs: [], configFound: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      diagnostic: {
        code: "CLAUDE_CONFIG_MALFORMED",
        message: err instanceof Error ? err.message : String(err),
        path: configPath,
      },
    };
  }

  if (!isRecord(parsed)) return { ok: true, refs: [], configFound: true };
  const raw = parsed.enabledPlugins;
  if (raw === undefined) return { ok: true, refs: [], configFound: true };

  if (Array.isArray(raw)) {
    return {
      ok: true,
      configFound: true,
      refs: raw
        .filter((item): item is string => typeof item === "string")
        .map((ref) => ({ ref, enabled: true })),
    };
  }

  if (isRecord(raw)) {
    return {
      ok: true,
      configFound: true,
      refs: Object.entries(raw)
        .filter(([ref]) => ref.trim() !== "")
        .map(([ref, enabled]) => ({ ref, enabled: Boolean(enabled) })),
    };
  }

  return {
    ok: false,
    diagnostic: {
      code: "ENABLED_PLUGINS_INVALID",
      message: "enabledPlugins must be an array of strings or an object map.",
      path: configPath,
    },
  };
}

async function chooseConfigPath(explicitPath?: string): Promise<string> {
  if (explicitPath) {
    return resolve(pluginResolverInternal.expandTilde(explicitPath));
  }
  if (process.env.SOUL_CLAUDE_CONFIG) {
    return resolve(
      pluginResolverInternal.expandTilde(process.env.SOUL_CLAUDE_CONFIG),
    );
  }

  const runtime = join(homedir(), ".claude.json");
  const settings = join(homedir(), ".claude", "settings.json");

  const hasEnabledPlugins = (s: Record<string, unknown> | "malformed" | null): boolean =>
    s !== null && s !== "malformed" && s.enabledPlugins !== undefined;

  const runtimeState = await readJsonObject(runtime);
  if (runtimeState === "malformed" || hasEnabledPlugins(runtimeState)) {
    return runtime;
  }

  if (hasEnabledPlugins(await readJsonObject(settings))) return settings;
  return runtime;
}

async function discoverInstalledPlugins(
  pluginsRoot: string,
): Promise<Map<string, InstalledPlugin>> {
  const plugins = new Map<string, InstalledPlugin>();

  for (const dir of await directPluginDirs(pluginsRoot)) {
    const plugin = await readInstalledPlugin(dir);
    if (plugin) upsertInstalled(plugins, plugin);
  }

  // Two layouts hold installed plugins, keyed by their marketplace:
  //   marketplaces/<mp>/…              — a clone of the marketplace repo
  //   cache/<mp>/<plugin>/<version>/   — the downloaded plugin payload
  // Most official plugins (vercel, github, firebase…) live ONLY under cache/,
  // so scanning marketplaces/ alone missed them (reported "Broken", 0 skills).
  for (const subdir of ["marketplaces", "cache"]) {
    const root = join(pluginsRoot, subdir);
    for (const marketplaceDir of await childDirs(root)) {
      const marketplace = basename(marketplaceDir);
      for (const dir of await manifestPluginDirs(marketplaceDir)) {
        const plugin = await readInstalledPlugin(dir, marketplace);
        if (plugin) upsertInstalled(plugins, plugin);
      }
    }
  }

  return plugins;
}

/** Compare dotted version strings numerically. >0 means `a` is newer than `b`. */
function compareVersions(a?: string, b?: string): number {
  const pa = (a ?? "0").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = (b ?? "0").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function directPluginDirs(pluginsRoot: string): Promise<string[]> {
  const dirs = await childDirs(pluginsRoot);
  return dirs.filter((dir) => basename(dir) !== "marketplaces");
}

async function manifestPluginDirs(root: string): Promise<string[]> {
  const out: string[] = [];
  await walk(root, 0, out);
  out.sort();
  return out;
}

async function walk(root: string, depth: number, out: string[]): Promise<void> {
  if (await isFile(join(root, ".claude-plugin", "plugin.json"))) {
    out.push(root);
  }
  if (depth >= 4) return;

  for (const dir of await childDirs(root)) {
    const name = basename(dir);
    if (name === ".git" || name === "node_modules" || name === "skills") {
      continue;
    }
    await walk(dir, depth + 1, out);
  }
}

async function readInstalledPlugin(
  dir: string,
  marketplace?: string,
): Promise<InstalledPlugin | null> {
  const manifest = await readPluginManifest(dir);
  const name = manifest.name ?? basename(dir);
  const id = marketplace ? `${name}@${marketplace}` : name;
  // `manifest.skills` is untrusted (from a plugin's plugin.json). Reject an
  // absolute path or one with a ".." segment so a hostile manifest can't point
  // the scanner at an arbitrary directory; fall back to the default location.
  const declaredSkills = typeof manifest.skills === "string" ? manifest.skills : "";
  const safeSkills =
    declaredSkills && !isAbsolute(declaredSkills) && !declaredSkills.split(/[\\/]/).includes("..")
      ? declaredSkills
      : "";
  const skillsPath = safeSkills ? resolve(dir, safeSkills) : join(dir, "skills");

  if (!(await isDirectory(skillsPath)) && !manifest.name) return null;

  return {
    name,
    id,
    marketplace,
    version: manifest.version,
    dir,
    skillsPath,
  };
}

async function readPluginManifest(
  dir: string,
): Promise<{ name?: string; version?: string; skills?: string }> {
  const manifestPath = join(dir, ".claude-plugin", "plugin.json");
  try {
    const raw = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!isRecord(raw)) return {};
    return {
      name: typeof raw.name === "string" ? raw.name : undefined,
      version: typeof raw.version === "string" ? raw.version : undefined,
      skills: typeof raw.skills === "string" ? raw.skills : undefined,
    };
  } catch {
    return {};
  }
}

function upsertInstalled(
  plugins: Map<string, InstalledPlugin>,
  plugin: InstalledPlugin,
): void {
  const existing = plugins.get(plugin.id);
  if (!existing) {
    plugins.set(plugin.id, plugin);
    return;
  }

  // Same plugin found in two places (e.g. cache/ holds 0.42.1 and 0.43.0, or a
  // marketplace clone + a cached payload). Prefer the newest version; on a tie,
  // prefer the more specific (deeper) payload path.
  const vc = compareVersions(plugin.version, existing.version);
  if (vc > 0 || (vc === 0 && plugin.dir.length > existing.dir.length)) {
    plugins.set(plugin.id, plugin);
  }
}

async function toDiscovered(
  plugin: InstalledPlugin,
  status: DiscoveredPluginStatus,
): Promise<DiscoveredPlugin> {
  return {
    name: plugin.name,
    id: plugin.id,
    marketplace: plugin.marketplace,
    version: plugin.version,
    path: plugin.dir,
    status,
    skills: await readPluginSkills(
      plugin.skillsPath ?? join(plugin.dir, "skills"),
    ),
  };
}

async function readPluginSkills(
  skillsPath: string,
): Promise<DiscoveredPluginSkill[]> {
  const dirs = await childDirs(skillsPath);
  const skills: DiscoveredPluginSkill[] = [];
  const sortedDirs = dirs.sort((a, b) => basename(a).localeCompare(basename(b)));

  for (const dir of sortedDirs) {
    const skillMd = join(dir, "SKILL.md");
    if (!(await isFile(skillMd))) continue;
    skills.push(await readSkill(skillMd, basename(dir)));
  }

  return skills;
}

async function readSkill(
  skillMd: string,
  fallbackName: string,
): Promise<DiscoveredPluginSkill> {
  let text = "";
  try {
    text = await readFile(skillMd, "utf8");
  } catch {
    return { name: fallbackName, description: "", skillMdPath: skillMd };
  }

  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return { name: fallbackName, description: "", skillMdPath: skillMd };

  const parsed = parseSkillFrontmatter(frontmatter[1] ?? "");
  return {
    name: parsed.name ?? fallbackName,
    description: parsed.description ?? "",
    skillMdPath: skillMd,
  };
}

function findInstalled(
  installed: Map<string, InstalledPlugin>,
  ref: { name: string; marketplace?: string },
): InstalledPlugin | undefined {
  const id = ref.marketplace ? `${ref.name}@${ref.marketplace}` : ref.name;
  return installed.get(id) ?? installed.get(ref.name);
}

function parsePluginRef(ref: string): { name: string; marketplace?: string } {
  const at = ref.lastIndexOf("@");
  if (at > 0 && at < ref.length - 1) {
    return { name: ref.slice(0, at), marketplace: ref.slice(at + 1) };
  }
  return { name: ref };
}

function diagnosticPlugin(diagnostic: ScanPluginDiagnostic): DiscoveredPlugin {
  return {
    name: "claude-config",
    status: "Broken",
    skills: [],
    diagnostics: [diagnostic],
  };
}

function parseSkillFrontmatter(
  frontmatter: string,
): { name?: string; description?: string } {
  const out: { name?: string; description?: string } = {};
  const lines = frontmatter.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = line.match(/^(name|description):\s*(.*)$/);
    if (!match) continue;

    const key = match[1] as "name" | "description";
    const raw = match[2] ?? "";
    if (raw === "|" || raw === "|-" || raw === ">" || raw === ">-") {
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1]!)) {
        i++;
        block.push(lines[i]!.trim());
      }
      out[key] = raw.startsWith(">")
        ? block.join(" ").trim()
        : block.join("\n").trim();
      continue;
    }

    const value = unquote(raw.trim());
    if (value !== "") out[key] = value;
  }

  return out;
}

function unquote(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if (first === "\"" && last === "\"") {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (first === "'" && last === "'") {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

async function childDirs(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
}

async function readJsonObject(
  path: string,
): Promise<Record<string, unknown> | "malformed" | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return "malformed";
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
