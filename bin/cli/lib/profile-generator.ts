/**
 * Profile auto-generation.
 *
 * This module is intentionally read-mostly: scanners inspect installed skills
 * and plugins, the heuristic buckets them by domain, and the writer creates a
 * schema-valid `profiles/<name>/profile.yaml` without overwriting by default.
 */
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse as parseYaml } from "yaml";

import type { NpxSkillRef, Profile } from "../../../profiles/_types";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

export type SkillOrigin = "local" | "npx" | "plugin";

export type ProfileDomain =
  | "frontend"
  | "backend"
  | "docs"
  | "devops"
  | "media"
  | "data"
  | "marketing"
  | "research"
  | "security"
  | "orchestration"
  | "core"
  | "misc";

export interface DiscoveredSkill {
  origin: SkillOrigin;
  name: string;
  description: string;
  path?: string;
  localRef?: string;
  repo?: string;
  pin?: string;
  sourceKind?: "npx" | "unknown";
  plugin?: string;
  pluginStatus?: "enabled" | "disabled" | "installed" | "broken";
}

export interface ScanResult {
  skills: DiscoveredSkill[];
  diagnostics: string[];
}

export interface ScanOptions {
  repoRoot?: string;
  skillsRoot?: string;
  npxRoots?: string[];
  pluginsRoot?: string;
  claudeConfigPath?: string;
}

export interface DomainAssignment {
  skill: DiscoveredSkill;
  domain: ProfileDomain;
  score: number;
  scores: Record<ProfileDomain, number>;
  matchedTokens: string[];
  alternatives: ProfileDomain[];
  crossCutting: boolean;
}

export interface ProfileGenerationOptions {
  name: string;
  description?: string;
  assignments: DomainAssignment[];
  domains?: ProfileDomain[];
  inheritCore?: boolean;
}

export interface GeneratedProfile {
  profile: Profile;
  yaml: string;
  included: DomainAssignment[];
  core: DomainAssignment[];
  skipped: DomainAssignment[];
}

export interface WriteProfileOptions {
  profilesDir?: string;
  force?: boolean;
}

export class ProfileAlreadyExists extends Error {
  constructor(public readonly profilePath: string) {
    super(
      `Profile already exists at ${profilePath}. Re-run with --force to overwrite.`,
    );
    this.name = "ProfileAlreadyExists";
  }
}

const DOMAIN_ORDER: ProfileDomain[] = [
  "frontend",
  "backend",
  "docs",
  "devops",
  "media",
  "data",
  "marketing",
  "research",
  "security",
  "orchestration",
  "core",
  "misc",
];

const DOMAIN_KEYWORDS: Record<ProfileDomain, string[]> = {
  frontend: [
    "frontend",
    "web",
    "website",
    "ui",
    "ux",
    "react",
    "nextjs",
    "vite",
    "storefront",
    "landing",
    "css",
    "mobile",
    "dashboard",
    "browser",
  ],
  backend: [
    "backend",
    "api",
    "route",
    "server",
    "database",
    "db",
    "schema",
    "migration",
    "workflow",
    "module",
    "auth",
    "medusa",
    "stripe",
    "webhook",
    "commerce",
    "admin",
  ],
  docs: [
    "doc",
    "docs",
    "documentation",
    "pdf",
    "word",
    "markdown",
    "article",
    "blog",
    "copy",
    "writing",
    "content",
    "readme",
  ],
  devops: [
    "deploy",
    "deployment",
    "hosting",
    "dns",
    "domain",
    "vps",
    "docker",
    "ci",
    "github",
    "pr",
    "merge",
    "branch",
    "coolify",
    "hostinger",
    "production",
  ],
  media: [
    "image",
    "video",
    "audio",
    "render",
    "remotion",
    "photo",
    "photoshoot",
    "png",
    "visual",
    "screenshot",
    "generate",
    "animate",
  ],
  data: [
    "analytics",
    "excel",
    "spreadsheet",
    "csv",
    "data",
    "dataset",
    "metrics",
    "report",
    "supabase",
  ],
  marketing: [
    "marketing",
    "ads",
    "seo",
    "campaign",
    "email",
    "launch",
    "pricing",
    "churn",
    "referral",
    "sales",
    "brand",
    "aso",
    "cro",
    "copywriting",
  ],
  research: [
    "research",
    "search",
    "scrape",
    "crawler",
    "browser",
    "keyword",
    "competitor",
    "flight",
    "polymarket",
    "extract",
  ],
  security: [
    "security",
    "secure",
    "audit",
    "token",
    "secret",
    "vulnerability",
    "sandbox",
  ],
  orchestration: [
    "orchestration",
    "agent",
    "agents",
    "team",
    "pipeline",
    "swarm",
    "colony",
    "omx",
    "worker",
    "codex",
    "claude",
  ],
  core: [
    "commit",
    "lint",
    "format",
    "file",
    "files",
    "reading",
    "read",
    "filesystem",
    "note",
    "memory",
    "prompt",
    "skill",
    "skills",
    "help",
    "setup",
    "workspace",
  ],
  misc: [],
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "use",
  "user",
  "when",
  "with",
]);

export function defaultProfilesDir(repoRoot = REPO_ROOT): string {
  return process.env.SOUL_PROFILES_DIR ?? join(repoRoot, "profiles");
}

export function defaultSkillsRoot(repoRoot = REPO_ROOT): string {
  return join(repoRoot, "skills", "skills");
}

export function validateProfileName(name: string): boolean {
  return /^[a-z][a-z0-9-]{1,63}$/.test(name);
}

export async function scanInstalledSkills(
  options: ScanOptions = {},
): Promise<ScanResult> {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const diagnostics: string[] = [];
  const skills: DiscoveredSkill[] = [];

  skills.push(
    ...(await scanLocalSkills({
      skillsRoot: options.skillsRoot ?? defaultSkillsRoot(repoRoot),
      diagnostics,
    })),
  );

  const npxScan = await scanViaOptionalModule(
    "scan-npx.ts",
    "scanNpxSkills",
    diagnostics,
    { roots: options.npxRoots, npxRoots: options.npxRoots },
  );
  if (npxScan.used) {
    skills.push(...normalizeNpxGroups(npxScan.value));
  } else {
    skills.push(
      ...(await scanNpxFallback({
        roots: options.npxRoots,
        diagnostics,
      })),
    );
  }

  const pluginScan = await scanViaOptionalModule(
    "scan-plugins.ts",
    "scanPlugins",
    diagnostics,
    {
      pluginsRoot: options.pluginsRoot,
      claudeConfigPath: options.claudeConfigPath,
    },
  );
  if (pluginScan.used) {
    skills.push(...normalizePluginGroups(pluginScan.value, diagnostics));
  } else {
    skills.push(
      ...(await scanPluginsFallback({
        pluginsRoot: options.pluginsRoot,
        claudeConfigPath: options.claudeConfigPath,
        diagnostics,
      })),
    );
  }

  return { skills: dedupeDiscovered(skills), diagnostics };
}

export function tokenize(input: string): string[] {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!normalized) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of normalized.split(/\s+/)) {
    if (token.length < 2 || STOP_WORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

export function assignDomain(skill: DiscoveredSkill): DomainAssignment {
  const tokens = tokenize(
    [
      skill.name,
      skill.description,
      skill.localRef,
      skill.repo,
      skill.plugin,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const tokenSet = new Set(tokens);
  const scores = Object.fromEntries(
    DOMAIN_ORDER.map((domain) => [domain, 0]),
  ) as Record<ProfileDomain, number>;
  const matchedTokens = new Set<string>();

  for (const domain of DOMAIN_ORDER) {
    for (const keyword of DOMAIN_KEYWORDS[domain]) {
      const pieces = tokenize(keyword);
      if (pieces.length === 0) continue;
      if (pieces.every((piece) => tokenSet.has(piece))) {
        scores[domain] += pieces.length;
        for (const piece of pieces) matchedTokens.add(piece);
      }
    }
  }

  const nonCore = DOMAIN_ORDER.filter(
    (domain) => domain !== "core" && domain !== "misc",
  );
  const ranked = nonCore
    .map((domain) => ({ domain, score: scores[domain] }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain),
    );
  const top = ranked[0] ?? { domain: "misc" as ProfileDomain, score: 0 };
  const alternatives = ranked
    .filter((entry) => entry.score > 0 && entry.score === top.score)
    .map((entry) => entry.domain);

  const coreScore = scores.core;
  const crossCutting = coreScore > 0 && (top.score === 0 || coreScore > top.score);
  const domain = crossCutting
    ? "core"
    : top.score > 0
      ? top.domain
      : "misc";
  const score = domain === "core" ? coreScore : top.score;

  return {
    skill,
    domain,
    score,
    scores,
    matchedTokens: [...matchedTokens].sort(),
    alternatives: alternatives.filter((alt) => alt !== domain),
    crossCutting,
  };
}

export function bucketSkills(skills: DiscoveredSkill[]): DomainAssignment[] {
  return skills.map(assignDomain).sort(compareAssignments);
}

export function groupAssignments(
  assignments: DomainAssignment[],
): Map<ProfileDomain, DomainAssignment[]> {
  const grouped = new Map<ProfileDomain, DomainAssignment[]>();
  for (const domain of DOMAIN_ORDER) grouped.set(domain, []);
  for (const assignment of assignments) {
    grouped.get(assignment.domain)!.push(assignment);
  }
  return grouped;
}

export function generateProfile(
  options: ProfileGenerationOptions,
): GeneratedProfile {
  if (!validateProfileName(options.name)) {
    throw new Error(
      `Invalid profile name "${options.name}". Use lowercase kebab-case.`,
    );
  }

  const selectedDomains =
    options.domains && options.domains.length > 0
      ? new Set(options.domains)
      : null;
  const core = options.assignments.filter((a) => a.domain === "core");
  const candidates = options.assignments.filter((assignment) => {
    if (assignment.domain === "core") return false;
    if (selectedDomains) return selectedDomains.has(assignment.domain);
    return true;
  });
  const included = candidates.filter(isProfileable);
  const skipped = options.assignments.filter(
    (assignment) => !included.includes(assignment) && assignment.domain !== "core",
  );

  const profile: Profile = {
    name: options.name,
    description:
      options.description ??
      `Auto-generated from soul scan (${included.length} skills)`,
    agents: ["claude-code", "codex"],
  };
  if (options.inheritCore && core.length > 0) {
    profile.inherits = "core";
  }

  const skills = buildProfileSkills(included);
  if (skills.local.length > 0 || skills.npx.length > 0) {
    profile.skills = {};
    if (skills.local.length > 0) profile.skills.local = skills.local.map((x) => x.ref);
    if (skills.npx.length > 0) profile.skills.npx = skills.npx.map((x) => x.ref);
  }
  // Plugins move to top-level `plugins:` with @<marketplace> qualifier.
  // Scanner discovers plugins by name; we emit them as <name>@claude-plugins-official.
  if (skills.plugins.length > 0) {
    profile.plugins = skills.plugins.map((x) => `${x.ref}@claude-plugins-official`);
  }

  return {
    profile,
    yaml: renderProfileYaml(profile, included, core, skipped),
    included,
    core,
    skipped,
  };
}

function isProfileable(assignment: DomainAssignment): boolean {
  const skill = assignment.skill;
  if (skill.origin === "local") return Boolean(skill.localRef);
  if (skill.origin === "plugin") {
    return Boolean(skill.plugin && skill.pluginStatus !== "disabled" && skill.pluginStatus !== "broken");
  }
  return Boolean(skill.repo && skill.sourceKind !== "unknown");
}

export async function writeGeneratedProfile(
  generated: GeneratedProfile,
  options: WriteProfileOptions = {},
): Promise<string> {
  const profilesDir = options.profilesDir ?? defaultProfilesDir();
  const dir = join(profilesDir, generated.profile.name);
  const path = join(dir, "profile.yaml");
  if (!options.force && (await pathExists(path))) {
    throw new ProfileAlreadyExists(path);
  }
  await mkdir(dir, { recursive: true });
  await writeFile(path, generated.yaml, "utf8");
  return path;
}

export function formatScanTree(assignments: DomainAssignment[]): string {
  const grouped = groupAssignments(assignments);
  const lines: string[] = ["Discovered skills by inferred domain:"];
  for (const domain of DOMAIN_ORDER) {
    const items = grouped.get(domain) ?? [];
    if (items.length === 0) continue;
    lines.push(`${domain} (${items.length})`);
    for (const assignment of items) {
      const skill = assignment.skill;
      const ref = displayRef(skill);
      const details: string[] = [skill.origin];
      if (skill.origin === "plugin" && skill.pluginStatus) {
        details.push(skill.pluginStatus);
      }
      if (skill.origin === "npx" && skill.sourceKind === "unknown") {
        details.push("unknown-origin");
      }
      const suffix =
        assignment.alternatives.length > 0
          ? ` [also: ${assignment.alternatives.join(", ")}]`
          : "";
      lines.push(`  - ${ref} (${details.join(", ")})${suffix}`);
      if (skill.description) lines.push(`    ${skill.description}`);
    }
  }
  if (lines.length === 1) lines.push("  (none found)");
  return lines.join("\n");
}

export async function profileExists(
  name: string,
  profilesDir = defaultProfilesDir(),
): Promise<boolean> {
  return pathExists(join(profilesDir, name, "profile.yaml"));
}

async function scanViaOptionalModule(
  fileName: string,
  exportName: string,
  diagnostics: string[],
  options: Record<string, unknown> = {},
): Promise<{ used: boolean; value: unknown }> {
  const url = pathToFileURL(join(HERE, fileName)).href;
  try {
    const mod = await import(url);
    const fn = (mod as Record<string, unknown>)[exportName];
    if (typeof fn !== "function") {
      diagnostics.push(`${fileName} did not export ${exportName}; fallback scanner used.`);
      return { used: false, value: null };
    }
    return { used: true, value: await fn(options) };
  } catch (err) {
    if (isMissingOptionalModuleError(err, fileName)) {
      return { used: false, value: null };
    }
    const message = err instanceof Error ? err.message : String(err);
    diagnostics.push(`${fileName} failed: ${message}`);
    return { used: true, value: [] };
  }
}

function isMissingOptionalModuleError(err: unknown, fileName: string): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes(fileName) || message.includes("Cannot find module");
}

async function scanLocalSkills({
  skillsRoot,
  diagnostics,
}: {
  skillsRoot: string;
  diagnostics: string[];
}): Promise<DiscoveredSkill[]> {
  const root = resolve(skillsRoot);
  let categories: Awaited<ReturnType<typeof readdir>>;
  try {
    categories = await readdir(root, { withFileTypes: true });
  } catch {
    diagnostics.push(`Local skills root not found: ${root}`);
    return [];
  }

  const out: DiscoveredSkill[] = [];
  for (const category of categories) {
    if (!category.isDirectory()) continue;
    const categoryDir = join(root, category.name);
    let slugs: Awaited<ReturnType<typeof readdir>>;
    try {
      slugs = await readdir(categoryDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const slug of slugs) {
      if (!slug.isDirectory()) continue;
      const dir = join(categoryDir, slug.name);
      const skillMd = join(dir, "SKILL.md");
      if (!(await isFile(skillMd))) continue;
      const meta = await readSkillMeta(skillMd);
      const localRef = relative(root, dir).split(sep).join("/");
      out.push({
        origin: "local",
        name: meta.name ?? slug.name,
        description: meta.description,
        path: await safeRealpath(dir),
        localRef,
      });
    }
  }
  return out;
}

async function scanNpxFallback({
  roots,
  diagnostics,
}: {
  roots?: string[];
  diagnostics: string[];
}): Promise<DiscoveredSkill[]> {
  const scanRoots =
    roots ?? [join(homedir(), ".claude", "skills"), join(homedir(), ".agents", "skills")];
  const out: DiscoveredSkill[] = [];
  for (const root of scanRoots.map((r) => resolve(expandTilde(r)))) {
    if (!(await isDirectory(root))) continue;
    const skillFiles = await findSkillMarkdown(root);
    for (const skillFile of skillFiles) {
      const meta = await readSkillMeta(skillFile);
      const dir = dirname(skillFile);
      const source = normalizeSource(meta.source);
      out.push({
        origin: "npx",
        name: meta.name ?? dirname(skillFile).split(sep).pop() ?? "unknown",
        description: meta.description,
        path: await safeRealpath(dir),
        repo: source.repo,
        pin: source.pin,
        sourceKind: source.repo ? "npx" : "unknown",
      });
    }
  }
  if (out.some((skill) => skill.sourceKind === "unknown")) {
    diagnostics.push("Some scanned npx skills have no _source repo and cannot be emitted as skills.npx entries.");
  }
  return out;
}

async function scanPluginsFallback({
  pluginsRoot,
  claudeConfigPath,
  diagnostics,
}: {
  pluginsRoot?: string;
  claudeConfigPath?: string;
  diagnostics: string[];
}): Promise<DiscoveredSkill[]> {
  const root = resolve(expandTilde(pluginsRoot ?? join(homedir(), ".claude", "plugins")));
  const enabled = await readEnabledPlugins(
    claudeConfigPath ?? join(homedir(), ".claude.json"),
    diagnostics,
  );
  const pluginNames = new Set<string>(enabled);
  let entries: Awaited<ReturnType<typeof readdir>> = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) pluginNames.add(entry.name);
    }
  } catch {
    if (enabled.length > 0) {
      diagnostics.push(`Plugin root not found: ${root}`);
    }
  }

  const out: DiscoveredSkill[] = [];
  for (const plugin of [...pluginNames].sort()) {
    const pluginDir = join(root, plugin);
    const installed = await isDirectory(pluginDir);
    if (!installed) {
      diagnostics.push(`Enabled plugin is missing from disk: ${plugin}`);
      continue;
    }
    const status: DiscoveredSkill["pluginStatus"] =
      enabled.length === 0
        ? "installed"
        : enabled.includes(plugin)
          ? "enabled"
          : "disabled";
    const skillsDir = join(pluginDir, "skills");
    const skillFiles = (await isDirectory(skillsDir))
      ? await findSkillMarkdown(skillsDir)
      : [];
    for (const skillFile of skillFiles) {
      const meta = await readSkillMeta(skillFile);
      out.push({
        origin: "plugin",
        name: meta.name ?? dirname(skillFile).split(sep).pop() ?? "unknown",
        description: meta.description,
        path: await safeRealpath(dirname(skillFile)),
        plugin,
        pluginStatus: status,
      });
    }
  }
  return out;
}

async function readEnabledPlugins(
  configPath: string,
  diagnostics: string[],
): Promise<string[]> {
  try {
    const raw = await readFile(resolve(expandTilde(configPath)), "utf8");
    const parsed = JSON.parse(raw) as { enabledPlugins?: unknown };
    if (!Array.isArray(parsed.enabledPlugins)) return [];
    return parsed.enabledPlugins.filter((x): x is string => typeof x === "string");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      const message = err instanceof Error ? err.message : String(err);
      diagnostics.push(`Could not read enabledPlugins from ${configPath}: ${message}`);
    }
    return [];
  }
}

function normalizeNpxGroups(value: unknown): DiscoveredSkill[] {
  if (!Array.isArray(value)) return [];
  const out: DiscoveredSkill[] = [];
  for (const group of value as Record<string, unknown>[]) {
    const repo = typeof group.repo === "string" ? group.repo : undefined;
    const pin = typeof group.pin === "string" ? group.pin : undefined;
    const skills = Array.isArray(group.skills) ? group.skills : [];
    for (const skill of skills as Record<string, unknown>[]) {
      const name = stringOrUndefined(skill.name) ?? "unknown";
      const description = stringOrUndefined(skill.description) ?? "";
      out.push({
        origin: "npx",
        name,
        description: normalizeWhitespace(description),
        path: stringOrUndefined(skill.path),
        repo,
        pin,
        sourceKind: repo ? "npx" : "unknown",
      });
    }
  }
  return out;
}

function normalizePluginGroups(
  value: unknown,
  diagnostics: string[] = [],
): DiscoveredSkill[] {
  if (!Array.isArray(value)) return [];
  const out: DiscoveredSkill[] = [];
  for (const pluginGroup of value as Record<string, unknown>[]) {
    const groupDiagnostics = Array.isArray(pluginGroup.diagnostics)
      ? pluginGroup.diagnostics
      : [];
    for (const diagnostic of groupDiagnostics as Record<string, unknown>[]) {
      const message = stringOrUndefined(diagnostic.message);
      if (message) diagnostics.push(message);
    }
    const plugin = stringOrUndefined(pluginGroup.name);
    if (!plugin) continue;
    const status = normalizePluginStatus(stringOrUndefined(pluginGroup.status));
    const skills = Array.isArray(pluginGroup.skills) ? pluginGroup.skills : [];
    for (const skill of skills as Record<string, unknown>[]) {
      const name = stringOrUndefined(skill.name) ?? "unknown";
      const description = stringOrUndefined(skill.description) ?? "";
      out.push({
        origin: "plugin",
        name,
        description: normalizeWhitespace(description),
        path: stringOrUndefined(skill.path),
        plugin,
        pluginStatus: status,
      });
    }
  }
  return out;
}

function normalizePluginStatus(
  status: string | undefined,
): DiscoveredSkill["pluginStatus"] {
  const normalized = status?.toLowerCase();
  if (
    normalized === "enabled" ||
    normalized === "disabled" ||
    normalized === "installed" ||
    normalized === "broken"
  ) {
    return normalized;
  }
  return undefined;
}

interface SkillMeta {
  name?: string;
  description: string;
  source?: unknown;
}

async function readSkillMeta(skillMd: string): Promise<SkillMeta> {
  let text = "";
  try {
    text = await readFile(skillMd, "utf8");
  } catch {
    return { description: "" };
  }

  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (frontmatter) {
    try {
      const parsed = parseYaml(frontmatter[1] ?? "") as Record<string, unknown> | null;
      if (parsed && typeof parsed === "object") {
        return {
          name: stringOrUndefined(parsed.name),
          description: normalizeWhitespace(stringOrUndefined(parsed.description) ?? ""),
          source: parsed._source,
        };
      }
    } catch {
      return { description: "" };
    }
  }

  const heading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
  return { name: heading, description: "" };
}

function normalizeSource(raw: unknown): { repo?: string; pin?: string } {
  if (typeof raw === "string" && isRepoRef(raw)) return { repo: raw };
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const repo = stringOrUndefined(obj.repo) ?? stringOrUndefined(obj.source);
    const pin = stringOrUndefined(obj.pin);
    if (repo && isRepoRef(repo)) return { repo, pin };
  }
  return {};
}

function isRepoRef(value: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}

async function findSkillMarkdown(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        out.push(path);
      }
    }
  }
  await walk(root);
  return out.sort();
}

function dedupeDiscovered(skills: DiscoveredSkill[]): DiscoveredSkill[] {
  const seen = new Set<string>();
  const out: DiscoveredSkill[] = [];
  for (const skill of skills) {
    const key =
      skill.origin === "npx"
        ? [skill.origin, skill.repo ?? "unknown", skill.pin ?? "", skill.name, skill.description].join("|")
        : [
            skill.origin,
            skill.localRef,
            skill.repo,
            skill.pin,
            skill.plugin,
            skill.name,
            skill.path,
          ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(skill);
  }
  return out.sort(compareSkills);
}

function compareSkills(a: DiscoveredSkill, b: DiscoveredSkill): number {
  return displayRef(a).localeCompare(displayRef(b));
}

function compareAssignments(a: DomainAssignment, b: DomainAssignment): number {
  return (
    DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain) ||
    displayRef(a.skill).localeCompare(displayRef(b.skill))
  );
}

interface ProfileSkillRefs {
  local: Array<{ ref: string; domain: ProfileDomain }>;
  npx: Array<{ ref: NpxSkillRef; domain: ProfileDomain }>;
  plugins: Array<{ ref: string; domain: ProfileDomain }>;
}

function buildProfileSkills(assignments: DomainAssignment[]): ProfileSkillRefs {
  const local = new Map<string, ProfileDomain>();
  const npx = new Map<string, { ref: NpxSkillRef; domain: ProfileDomain }>();
  const plugins = new Map<string, ProfileDomain>();

  for (const assignment of assignments) {
    const skill = assignment.skill;
    if (skill.origin === "local" && skill.localRef) {
      if (!local.has(skill.localRef)) local.set(skill.localRef, assignment.domain);
    } else if (skill.origin === "npx" && skill.repo && skill.sourceKind !== "unknown") {
      const existing = npx.get(skill.repo);
      if (existing) {
        if (!existing.ref.skills.includes(skill.name)) {
          existing.ref.skills.push(skill.name);
          existing.ref.skills.sort();
        }
      } else {
        const ref: NpxSkillRef = { repo: skill.repo, skills: [skill.name] };
        if (skill.pin) ref.pin = skill.pin;
        npx.set(skill.repo, { ref, domain: assignment.domain });
      }
    } else if (skill.origin === "plugin" && skill.plugin) {
      if (!plugins.has(skill.plugin)) plugins.set(skill.plugin, assignment.domain);
    }
  }

  return {
    local: [...local.entries()]
      .map(([ref, domain]) => ({ ref, domain }))
      .sort(compareProfileRef),
    npx: [...npx.values()].sort(
      (a, b) =>
        DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain) ||
        a.ref.repo.localeCompare(b.ref.repo),
    ),
    plugins: [...plugins.entries()]
      .map(([ref, domain]) => ({ ref, domain }))
      .sort(compareProfileRef),
  };
}

function compareProfileRef(
  a: { ref: string; domain: ProfileDomain },
  b: { ref: string; domain: ProfileDomain },
): number {
  return (
    DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain) ||
    a.ref.localeCompare(b.ref)
  );
}

function renderProfileYaml(
  profile: Profile,
  included: DomainAssignment[],
  core: DomainAssignment[],
  skipped: DomainAssignment[],
): string {
  const skills = buildProfileSkills(included);
  const lines: string[] = [];
  lines.push(`# Auto-generated by soul new ${profile.name} --from-scan.`);
  if (core.length > 0) {
    lines.push("# Core candidates were detected as cross-cutting.");
    if (profile.inherits === "core") {
      lines.push("# This profile inherits from core; keep those skills in profiles/core/.");
    } else {
      lines.push("# Create profiles/core/profile.yaml and add inherits: core to use them as a base.");
    }
    for (const assignment of core.slice(0, 20)) {
      lines.push(`# core: ${displayRef(assignment.skill)}`);
    }
    if (core.length > 20) lines.push(`# core: ... ${core.length - 20} more`);
  }
  if (skipped.length > 0) {
    lines.push(
      `# Skipped ${skipped.length} scanned skills that were not profileable or outside the selected domain filter.`,
    );
  }
  lines.push(`name: ${quoteYaml(profile.name)}`);
  lines.push(`description: ${quoteYaml(profile.description)}`);
  lines.push("agents: [claude-code, codex]");
  if (profile.inherits) lines.push(`inherits: ${quoteYaml(profile.inherits)}`);

  if (profile.skills) {
    lines.push("skills:");
    if (skills.local.length > 0) {
      lines.push("  local:");
      renderStringRefsByDomain(lines, skills.local);
    }
    if (skills.npx.length > 0) {
      lines.push("  npx:");
      let lastDomain: ProfileDomain | null = null;
      for (const entry of skills.npx) {
        if (entry.domain !== lastDomain) {
          lines.push(`    # ${entry.domain}`);
          lastDomain = entry.domain;
        }
        lines.push(`    - repo: ${quoteYaml(entry.ref.repo)}`);
        if (entry.ref.pin) lines.push(`      pin: ${quoteYaml(entry.ref.pin)}`);
        lines.push("      skills:");
        for (const skill of entry.ref.skills) {
          lines.push(`        - ${quoteYaml(skill)}`);
        }
      }
    }
  }

  // Plugins are top-level with <plugin>@<marketplace> qualifier.
  if (skills.plugins.length > 0) {
    lines.push("plugins:");
    renderStringRefsByDomain(lines, skills.plugins.map((x) => ({ ref: `${x.ref}@claude-plugins-official`, domain: x.domain })));
  }

  return lines.join("\n") + "\n";
}

function renderStringRefsByDomain(
  lines: string[],
  refs: Array<{ ref: string; domain: ProfileDomain }>,
): void {
  let lastDomain: ProfileDomain | null = null;
  for (const entry of refs) {
    if (entry.domain !== lastDomain) {
      lines.push(`    # ${entry.domain}`);
      lastDomain = entry.domain;
    }
    lines.push(`    - ${quoteYaml(entry.ref)}`);
  }
}

function quoteYaml(value: string | undefined): string {
  return JSON.stringify(value ?? "");
}

function displayRef(skill: DiscoveredSkill): string {
  if (skill.origin === "local") return skill.localRef ?? skill.name;
  if (skill.origin === "plugin") return `${skill.plugin ?? "plugin"}:${skill.name}`;
  if (skill.repo) return `${skill.repo}:${skill.name}`;
  return `npx:${skill.name}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function safeRealpath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

function expandTilde(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export const _internal = {
  DOMAIN_KEYWORDS,
  DOMAIN_ORDER,
  displayRef,
  readSkillMeta,
};
