/**
 * Plugin skills resolver (Agent A8).
 *
 * Given a `ResolvedProfile`, walk the Claude Code plugins root and produce a
 * `LinkPlan[]` for every entry in `profile.plugins`. Claude Code
 * plugins ship a `skills/` directory; each `<plugin>/skills/<slug>/SKILL.md`
 * we find becomes one plan with the target namespaced as
 * `.claude/skills/<plugin>:<slug>/` so it cannot collide with local- or
 * npx-sourced skills.
 *
 * Read-only by contract: this module never installs a plugin. If a referenced
 * plugin directory is missing we throw `PluginNotInstalled` carrying the
 * install hint the user should run.
 *
 * The plugins-root path is configurable via constructor arg (`opts.pluginsRoot`)
 * or `SOUL_PLUGINS_ROOT`. Default is `~/.claude/plugins`. Tests point this at
 * an isolated tmpdir — production code never reaches into the real `~/.claude`
 * tree directly.
 *
 * NOTE: A11 (`scan-plugins.ts`) implements similar plugin-root discovery. By
 * the fleet contract we let that duplication appear now and extract a shared
 * helper in a later cleanup pass if the patterns actually converge — so this
 * module keeps a small private helper rather than reaching across boundaries.
 */
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  ProfileError,
  type LinkPlan,
  type ResolvedProfile,
} from "../../../profiles/_types";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Thrown when a profile references a plugin that is not present under the
 * configured plugins root. Carries the `install_hint` so CLI callers can
 * surface a one-liner the user can copy-paste.
 */
export class PluginNotInstalled extends ProfileError {
  public readonly install_hint: string;
  public readonly plugin: string;
  public readonly pluginsRoot: string;

  constructor(plugin: string, pluginsRoot: string) {
    const hint = `/plugin marketplace add ${plugin}`;
    super(
      "PLUGIN_NOT_INSTALLED",
      `Plugin "${plugin}" is not installed under "${pluginsRoot}". ` +
        `Install it with: ${hint}`,
    );
    this.install_hint = hint;
    this.plugin = plugin;
    this.pluginsRoot = pluginsRoot;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ResolvePluginsOptions {
  /**
   * Absolute path to the directory containing installed plugins. Each plugin
   * is expected to live at `<pluginsRoot>/<name>/skills/<slug>/SKILL.md`.
   *
   * Resolution order:
   *   1. explicit `pluginsRoot` argument
   *   2. `SOUL_PLUGINS_ROOT` environment variable
   *   3. `${HOME}/.claude/plugins` (default)
   */
  pluginsRoot?: string;
}

/**
 * Resolve every `plugins` entry on the profile into one or more
 * `LinkPlan`s.
 *
 * For each plugin name:
 *   - If `<pluginsRoot>/<name>/` does not exist, throw `PluginNotInstalled`
 *     with the install hint.
 *   - Otherwise, enumerate `<pluginsRoot>/<name>/skills/*` and emit one
 *     `LinkPlan` per directory containing a `SKILL.md`.
 *   - A plugin with an empty (or missing) `skills/` directory contributes
 *     zero plans — that is not an error, just a plugin without skills.
 *
 * Targets are namespaced (`<plugin>:<slug>`) so they cannot collide with
 * local or npx skills in the materialized `.claude/skills/` tree.
 */
export async function resolvePlugins(
  profile: ResolvedProfile,
  opts: ResolvePluginsOptions = {},
): Promise<LinkPlan[]> {
  const refs = profile.plugins ?? [];
  if (refs.length === 0) return [];

  const root = resolvePluginsRoot(opts.pluginsRoot);

  const plans: LinkPlan[] = [];
  for (const ref of refs) {
    // Use the part before '@' as the plugin directory name on disk.
    const pluginName = ref.id.split("@")[0]!;
    plans.push(...(await resolveOnePlugin(pluginName, root)));
  }
  return plans;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Resolve the plugins root, expanding `~` if the caller (or env var) hands it
 * to us. Always returns an absolute path.
 *
 * Kept private — A11's scanner needs the same logic; per the fleet plan we
 * let the duplication appear here and extract later if/when it converges.
 */
function resolvePluginsRoot(explicit?: string): string {
  const raw = explicit ?? process.env.SOUL_PLUGINS_ROOT ?? join(homedir(), ".claude", "plugins");
  return resolve(expandTilde(raw));
}

function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const st = await stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    const st = await stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

/**
 * Enumerate the skills exposed by a single plugin.
 *
 * Layout assumed:
 *   <root>/<plugin>/                       <- must exist or PluginNotInstalled
 *   <root>/<plugin>/skills/                <- may be absent or empty (→ [])
 *   <root>/<plugin>/skills/<slug>/SKILL.md <- each match → 1 LinkPlan
 *
 * Subdirectories under `skills/` that do not contain a `SKILL.md` are
 * skipped silently — they may be shared fixtures, helper docs, etc.
 */
async function resolveOnePlugin(
  plugin: string,
  pluginsRoot: string,
): Promise<LinkPlan[]> {
  const pluginDir = join(pluginsRoot, plugin);
  if (!(await isDirectory(pluginDir))) {
    throw new PluginNotInstalled(plugin, pluginsRoot);
  }

  const skillsDir = join(pluginDir, "skills");
  if (!(await pathExists(skillsDir))) {
    // Plugin installed but ships no skills/ tree. Not an error.
    return [];
  }

  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    // skills/ exists but is unreadable. Treat as zero skills rather than
    // throwing — the materializer simply has nothing to link.
    return [];
  }

  const slugs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const plans: LinkPlan[] = [];
  for (const slug of slugs) {
    const skillDir = join(skillsDir, slug);
    const skillMd = join(skillDir, "SKILL.md");
    if (!(await isFile(skillMd))) continue;
    plans.push({
      source: skillDir,
      target: `.claude/skills/${plugin}:${slug}/`,
      origin: "plugin",
    });
  }
  return plans;
}

// Exposed for the test suite — lets tests assert the env-var / tilde expansion
// without re-implementing the resolution chain.
export const _internal = { resolvePluginsRoot, expandTilde };
