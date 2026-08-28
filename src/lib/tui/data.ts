/**
 * TUI data loader. Builds the initial TuiState and re-builds skills/preview
 * when the profile cursor moves to a new profile or a new skill.
 *
 * Reads only — never mutates profile.yaml or runtime dirs. Mirrors the path
 * conventions used by watch-live.ts and current.ts so the TUI stays in sync
 * with what those commands see.
 */

import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configDir } from "../config-paths";

import { listProfiles, loadProfile } from "../profile-loader";
import { resolveProfileForCwd } from "../cwd-resolver";
import { requiredClisFor } from "../cli-extractor";
import { scanPlugins, type DiscoveredPlugin } from "../scan-plugins";
import { cacheKey } from "../resolver-npx";
import { cacheSkillPath } from "../cache";
import { countProfileSkills } from "../profile-capabilities";
import type {
  ActiveProfile,
  Preview,
  ProfileRow,
  SkillRow,
  TuiMode,
  TuiState,
} from "./types";

function mcpRefId(ref: unknown): string {
  if (typeof ref === "string") return ref;
  if (ref && typeof ref === "object" && "id" in ref) {
    const id = (ref as { id: unknown }).id;
    if (typeof id === "string") return id;
  }
  return "";
}

function repoRoot(): string {
  if (process.env.CUE_REPO_ROOT) return process.env.CUE_REPO_ROOT;
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "..");
}


function skillsRoot(): string {
  return join(repoRoot(), "resources", "skills", "skills");
}

function profilesRoot(): string {
  return join(repoRoot(), "profiles");
}

function skillRefId(ref: unknown): string {
  if (typeof ref === "string") return ref;
  if (ref && typeof ref === "object" && "id" in ref) {
    const id = (ref as { id: unknown }).id;
    if (typeof id === "string") return id;
  }
  return "";
}

async function profileRow(name: string): Promise<ProfileRow | null> {
  try {
    const p = await loadProfile(name);
    // iconImage may be inherited, but the file only lives in the declaring
    // profile's own directory — resolve against this profile's dir and verify.
    let iconImagePath: string | undefined;
    if (p.iconImage) {
      const candidate = resolve(profilesRoot(), name, p.iconImage);
      if (existsSync(candidate)) iconImagePath = candidate;
    }
    return {
      name,
      icon: p.icon ?? "",
      description: p.description ?? "",
      iconImagePath,
    };
  } catch {
    // Profile fails to load (schema invalid, missing dir, broken inherits).
    // It can't be used, so drop it from the TUI rather than showing a dead row.
    return null;
  }
}

export async function listProfileRows(): Promise<ProfileRow[]> {
  const names = await listProfiles();
  const rows: ProfileRow[] = [];
  for (const n of names) {
    const row = await profileRow(n);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * Skill ids contributed by the core baseline profile. A skill present here is
 * "built-in" (inherited by every profile, managed via `cue builtin`); anything
 * else was added by the active profile. Cached for the session — core doesn't
 * change while the TUI is open.
 */
let _coreSkillIds: Set<string> | null = null;
async function coreSkillIds(): Promise<Set<string>> {
  if (_coreSkillIds) return _coreSkillIds;
  const ids = new Set<string>();
  try {
    const core = await loadProfile("core");
    for (const ref of core.skills.local ?? []) {
      const id = skillRefId(ref);
      if (id) ids.add(id);
    }
    for (const npx of core.skills.npx ?? []) {
      for (const s of npx.skills ?? []) ids.add(`${npx.repo}#${s}`);
    }
  } catch { /* no core → nothing is built-in */ }
  _coreSkillIds = ids;
  return ids;
}

/**
 * Plugins installed on this machine, scanned once per session. Used to resolve
 * which skills a profile's declared plugins contribute. Scanning reads Claude's
 * config + the installed plugin tree, so it's cached — the set doesn't change
 * while the TUI is open.
 */
let _scannedPlugins: DiscoveredPlugin[] | null = null;
async function scannedPlugins(): Promise<DiscoveredPlugin[]> {
  if (_scannedPlugins) return _scannedPlugins;
  try {
    _scannedPlugins = await scanPlugins();
  } catch {
    _scannedPlugins = [];
  }
  return _scannedPlugins;
}

/**
 * Skills contributed by the profile's declared plugins. A plugin entry is
 * `<name>@<marketplace>`; we match it against the installed plugin tree and
 * list each skill the plugin exposes. A declared-but-not-installed plugin still
 * gets a single row so the user can see the profile wants it.
 */
async function pluginSkillRows(profileName: string): Promise<SkillRow[]> {
  const p = await loadProfile(profileName);
  const declared = (p.plugins ?? []).map((ref) => ref.id).filter(Boolean);
  if (declared.length === 0) return [];
  const installed = await scannedPlugins();
  const byId = new Map<string, DiscoveredPlugin>();
  for (const plugin of installed) {
    if (plugin.id) byId.set(plugin.id, plugin);
    byId.set(plugin.name, plugin);
  }
  const rows: SkillRow[] = [];
  for (const pluginId of declared) {
    const found = byId.get(pluginId);
    // Every plugin here is DECLARED by this profile, so cue enables it in the
    // per-profile runtime (settings.json `enabledPlugins`) regardless of the
    // global Claude toggle. `found.status` reflects only the global config, so
    // we report profile-relative status instead and surface the global toggle
    // as a secondary note (it's why a plugin can read "Disabled" elsewhere).
    const globalNote =
      found && found.status !== "Enabled"
        ? `\nGlobal Claude toggle: ${found.status} (does not affect this profile).`
        : "";
    if (found && found.skills.length > 0) {
      const source = found.id ?? found.name;
      for (const s of found.skills) {
        rows.push({
          id: s.name,
          kind: "plugin",
          origin: "profile",
          pluginId: source,
          // Point at the plugin's real SKILL.md so the preview shows the full
          // doc; previewBody is just the status note prepended to it.
          skillMdPath: s.skillMdPath,
          previewBody:
            `Plugin skill: ${s.name} · from ${source}\n` +
            `Enabled for this profile ✓ (cue enables declared plugins in the per-profile runtime).${globalNote}`,
        });
      }
      continue;
    }
    rows.push({
      id: pluginId,
      kind: "plugin",
      origin: "profile",
      pluginId,
      previewBody:
        `Plugin: ${pluginId}\n\n` +
        (found
          ? `Enabled for this profile ✓, but it exposes no skills.${globalNote}`
          : "Declared by this profile but not installed — its skills can't be listed.\n" +
            "Install it (run `/plugin`, or the profile's install step) so the runtime can load it."),
    });
  }
  return rows;
}

export async function skillsFor(profileName: string): Promise<SkillRow[]> {
  try {
    const p = await loadProfile(profileName);
    const builtin = await coreSkillIds();
    const rows: SkillRow[] = [];
    const root = skillsRoot();
    for (const ref of p.skills.local ?? []) {
      const id = skillRefId(ref);
      if (!id) continue;
      rows.push({
        id,
        kind: "local",
        skillMdPath: join(root, id, "SKILL.md"),
        origin: builtin.has(id) ? "builtin" : "profile",
      });
    }
    for (const npx of p.skills.npx ?? []) {
      // npx skills are fetched into profiles/_cache/npx/<key>/<skill>/SKILL.md.
      // Point at the cached doc when present so the preview shows the real
      // skill instead of a "not loaded" stub.
      const key = cacheKey(npx.repo, npx.pin);
      for (const s of npx.skills ?? []) {
        const id = `${npx.repo}#${s}`;
        const md = join(cacheSkillPath({ repoRoot: repoRoot() }, key, s), "SKILL.md");
        const cached = existsSync(md);
        rows.push({
          id,
          kind: "npx",
          origin: builtin.has(id) ? "builtin" : "profile",
          // Show the cached doc when present; otherwise a helpful note (the
          // skill is fetched into the npx cache when this profile is launched).
          skillMdPath: cached ? md : undefined,
          previewBody: cached
            ? undefined
            : `npx skill: ${s}\nFrom repo: ${npx.repo}${npx.pin ? ` @ ${npx.pin}` : ""}\n\n` +
              `Not cached yet — launch this profile once (cue fetches npx skills\n` +
              `into profiles/_cache/npx/ on materialize), then the full SKILL.md\n` +
              `shows here.`,
        });
      }
    }
    rows.push(...(await pluginSkillRows(profileName)));
    // Group rows into contiguous blocks by source (local category → npx repo →
    // plugin), in first-appearance order, so the skills pane can render one
    // header per group. Stable within each group (index tiebreak).
    const firstSeen = new Map<string, number>();
    for (const r of rows) {
      const g = skillGroupId(r);
      if (!firstSeen.has(g)) firstSeen.set(g, firstSeen.size);
    }
    return rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => (firstSeen.get(skillGroupId(a.r))! - firstSeen.get(skillGroupId(b.r))!) || (a.i - b.i))
      .map((x) => x.r);
  } catch {
    return [];
  }
}

/**
 * Group identity for the skills pane's per-source headers. Local skills group
 * by category prefix, npx by repo, plugin skills by their source plugin.
 */
export function skillGroupId(r: SkillRow): string {
  if (r.kind === "npx") return "N:" + (r.id.split("#")[0] ?? r.id);
  if (r.kind === "plugin") return "P:" + (r.pluginId ?? "");
  const slash = r.id.indexOf("/");
  return "L:" + (slash === -1 ? r.id : r.id.slice(0, slash));
}

/** Human-readable header label for a skill group (paired with skillGroupId). */
export function skillGroupLabel(r: SkillRow): string {
  if (r.kind === "npx") return `npx: ${r.id.split("#")[0] ?? r.id}`;
  if (r.kind === "plugin") return `plugin: ${r.pluginId ?? "?"} ✓`;
  const slash = r.id.indexOf("/");
  return slash === -1 ? r.id : r.id.slice(0, slash);
}

/** MCP ids contributed by the core baseline — used to mark MCP origin. */
let _coreMcpIds: Set<string> | null = null;
async function coreMcpIds(): Promise<Set<string>> {
  if (_coreMcpIds) return _coreMcpIds;
  const ids = new Set<string>();
  try {
    const core = await loadProfile("core");
    for (const ref of core.mcps ?? []) {
      const id = mcpRefId(ref);
      if (id) ids.add(id);
    }
  } catch { /* no core → nothing built-in */ }
  _coreMcpIds = ids;
  return ids;
}

export async function mcpsFor(profileName: string): Promise<SkillRow[]> {
  try {
    const p = await loadProfile(profileName);
    const builtin = await coreMcpIds();
    const rows: SkillRow[] = [];
    for (const ref of p.mcps ?? []) {
      const id = mcpRefId(ref);
      if (!id) continue;
      const origin = builtin.has(id) ? "builtin" : "profile";
      rows.push({
        id,
        kind: "mcp",
        origin,
        previewBody: `MCP server: ${id}\n\nOrigin: ${origin === "builtin" ? "core baseline (built-in)" : `added by ${profileName}`}`,
      });
    }
    return rows;
  } catch {
    return [];
  }
}

/**
 * Extract CLI command names from a skill's `bashPatterns:` frontmatter. We take
 * only start-of-line-anchored patterns (`^\s*<cmd>`), which name the CLI the
 * skill is about, and skip wrapped variants (`npx <cmd>`, `pnpm dlx <cmd>`).
 */
function clisFromBashPatterns(skillMd: string): string[] {
  const fm = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return [];
  const lines = fm[1]!.split("\n");
  const start = lines.findIndex((l) => /^\s*bashPatterns\s*:/.test(l));
  if (start === -1) return [];
  const out = new Set<string>();
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    // Stop at the next top-level frontmatter key (a non-list, non-indented key).
    if (/^[a-zA-Z_]/.test(line)) break;
    const pat = line.match(/['"](.+?)['"]/)?.[1];
    if (!pat) continue;
    const cmd = pat.match(/\^\\s\*([a-zA-Z][a-zA-Z0-9_-]*)/)?.[1];
    if (cmd) out.add(cmd);
  }
  return [...out];
}

/** CLIs contributed by the profile's plugin skills (not seen by the core CLI extractor). */
async function pluginClisFor(profileName: string): Promise<Map<string, string[]>> {
  const byCli = new Map<string, string[]>();
  const skills = (await skillsFor(profileName)).filter((s) => s.kind === "plugin" && s.skillMdPath);
  for (const s of skills) {
    try {
      const md = await readFile(s.skillMdPath!, "utf8");
      for (const cli of clisFromBashPatterns(md)) {
        byCli.set(cli, [...(byCli.get(cli) ?? []), s.id]);
      }
    } catch { /* unreadable skill — skip */ }
  }
  return byCli;
}

export async function clisFor(profileName: string): Promise<SkillRow[]> {
  try {
    const byCli = new Map<string, string[]>();
    // Local/npx skills via the shared extractor.
    for (const req of await requiredClisFor(profileName)) {
      if (/^[a-z][a-z0-9._-]*$/i.test(req.cli)) byCli.set(req.cli, req.skills);
    }
    // Plugin skills (vercel-cli, etc.) the shared extractor doesn't scan.
    for (const [cli, skills] of await pluginClisFor(profileName)) {
      byCli.set(cli, [...(byCli.get(cli) ?? []), ...skills]);
    }
    return [...byCli.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cli, skills]) => ({
        id: cli,
        kind: "cli" as const,
        previewBody:
          `CLI: ${cli}\n\nRequired by ${skills.length} skill(s):\n` +
          skills.map((s) => `  - ${s}`).join("\n"),
      }));
  } catch {
    return [];
  }
}

/** Build the middle-pane list for the given mode. */
export async function itemsFor(profileName: string, mode: TuiMode): Promise<SkillRow[]> {
  if (mode === "mcps") return mcpsFor(profileName);
  if (mode === "clis") return clisFor(profileName);
  return skillsFor(profileName);
}

export async function activeFor(cwd: string): Promise<ActiveProfile | null> {
  const res = await resolveProfileForCwd({
    cwd,
    homeDir: homedir(),
    configDir: configDir(),
  });
  if (res.source === "none") return null;
  try {
    const p = await loadProfile(res.profile);
    return {
      name: res.profile,
      source: res.source,
      skillCount: countProfileSkills(p),
      mcpCount: p.mcps.length,
      pluginCount: p.plugins.length,
    };
  } catch {
    return {
      name: res.profile,
      source: res.source,
      skillCount: 0,
      mcpCount: 0,
      pluginCount: 0,
    };
  }
}

export async function loadInitialState(cwd: string, mode: TuiMode = "skills"): Promise<TuiState> {
  const profiles = await listProfileRows();
  // Assign stable kitty image ids (1..255) to rows that have a logo on disk.
  // The renderer references these when the terminal supports kitty graphics.
  let nextImageId = 1;
  for (const row of profiles) {
    if (row.iconImagePath && nextImageId <= 255) row.imageId = nextImageId++;
  }
  const active = await activeFor(cwd);
  const focusName = active?.name ?? profiles[0]?.name;
  const skills = focusName ? await itemsFor(focusName, mode) : [];
  const preview = skills[0] ? await loadPreview(skills[0]) : null;
  const cursor = active ? Math.max(0, profiles.findIndex((p) => p.name === active.name)) : 0;
  return {
    profiles,
    active,
    skills,
    profileCursor: cursor,
    skillCursor: 0,
    previewScroll: 0,
    preview,
    focus: "profiles",
    error: null,
    mode,
  };
}

const PREVIEW_MAX_BYTES = 16_000;

export async function loadPreview(skill: SkillRow): Promise<Preview | null> {
  // When there's a SKILL.md on disk (local OR plugin skills), show the full
  // doc. previewBody, when also present (plugin rows), is a status note
  // prepended above the doc.
  if (skill.skillMdPath) {
    const note = skill.previewBody ? `${skill.previewBody}\n\n———\n\n` : "";
    try {
      const buf = await readFile(skill.skillMdPath, "utf8");
      const doc = buf.length > PREVIEW_MAX_BYTES ? buf.slice(0, PREVIEW_MAX_BYTES) + "\n…\n" : buf;
      return { title: skill.id, body: note + doc };
    } catch (e) {
      const reason = `(could not read ${skill.skillMdPath}: ${(e as Error).message})`;
      return { title: skill.id, body: note ? note + reason : reason };
    }
  }
  // No SKILL.md: MCP / CLI / not-installed-plugin rows carry a pre-rendered body.
  if (skill.previewBody !== undefined) {
    return { title: skill.id, body: skill.previewBody };
  }
  return { title: skill.id, body: "(npx skill — preview not loaded)" };
}
