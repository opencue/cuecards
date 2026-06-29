/**
 * Profile linter for `cue validate`.
 *
 * The rules below are intentionally numbered and centralized so a later
 * suppression pass can key off stable ids such as `# lint: ignore W1`.
 *
 * W1: profile declares more than 120 skills.
 * W2: profile declares more than 5 MCP servers.
 * W3: inheritance chain depth is greater than 2.
 * W4: a skill slug appears in both `skills.local` and `skills.npx`.
 * W5: a referenced plugin is not installed locally (environmental, not a profile bug).
 * W6: a skill's description has no parseable trigger phrases (reactive routing won't work).
 * W7: a skill has no capability summary the router can infer (proactive routing won't work).
 * W8: a skill has a capability but no explicit `when_to_invoke:` (proactive routing falls back to a single generic row).
 * E1: profile `name:` collides with another profile.
 * E2: inheritance chain contains a cycle.
 * E3: referenced skill or MCP cannot be resolved.
 */

import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { existsSync, type Dirent } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { parse as parseYaml } from "yaml";

import {
  InheritanceCycle,
  InheritanceDepthExceeded,
  type NpxSkillRef,
  type Profile,
  ProfileError,
  ProfileNotFound,
  type ResolvedProfile,
  SchemaViolation,
} from "../../profiles/_types";
import { listProfiles, loadProfile } from "./profile-loader";
import { materializeMcp, McpNotFound, type MaterializeOptions } from "./mcp-materializer";
import { resolveLocal } from "./resolver-local";
import {
  NpxFetchFailed,
  resolveNpxDetailed,
  type NpxFetchFn,
} from "./resolver-npx";
import { PluginNotInstalled, resolvePlugins } from "./resolver-plugins";
import { parseSkillFromPath } from "./skill-router";
import { repoRoot as cueRepoRoot } from "./repo-root";

const DEFAULT_PROFILES_DIR = join(cueRepoRoot(), "profiles");
const DEFAULT_SKILLS_ROOT = join(cueRepoRoot(), "resources", "skills", "skills");
const DEFAULT_CONFIGS_ROOT = join(cueRepoRoot(), "resources", "mcps", "configs");
const DEFAULT_RULES_ROOT = join(cueRepoRoot(), "resources", "rules");
const DEFAULT_COMMANDS_ROOT = join(cueRepoRoot(), "resources", "commands");
const DEFAULT_HOOKS_ROOT = join(cueRepoRoot(), "resources", "hooks");
const DEFAULT_SUBAGENTS_ROOT = join(cueRepoRoot(), "resources", "subagents");

export type LintRuleId =
  | "W1" | "W2" | "W3" | "W4" | "W5" | "W6" | "W7" | "W8" | "W9"
  | "E1" | "E2" | "E3";
export type DiagnosticRuleId = LintRuleId | "SCHEMA" | "LOAD";
export type LintSeverity = "warning" | "error";

export interface RuleDoc {
  severity: LintSeverity;
  title: string;
  description: string;
}

export const PROFILE_LINT_RULES: Record<LintRuleId, RuleDoc> = {
  W1: {
    severity: "warning",
    title: "too many skills",
    description: "Profile declares more than 120 skills; this can bloat prompt tokens.",
  },
  W2: {
    severity: "warning",
    title: "too many MCPs",
    description: "Profile declares more than 5 MCP servers; this can slow startup and bloat tool context.",
  },
  W3: {
    severity: "warning",
    title: "deep inheritance",
    description: "Inheritance chain depth is greater than 2; flatten the profile if it becomes hard to reason about.",
  },
  W4: {
    severity: "warning",
    title: "ambiguous skill source",
    description: "A skill slug appears in both local and npx sources.",
  },
  W5: {
    severity: "warning",
    title: "plugin not installed locally",
    description: "A referenced plugin is not installed under ~/.claude/plugins (environmental — install with `/plugin marketplace add <name>`).",
  },
  W6: {
    severity: "warning",
    title: "skill has no trigger phrases",
    description: "Skill description doesn't include quoted phrases after 'Use when user says/asks/...'. Claude can't reactive-route to this skill from user phrasing.",
  },
  W7: {
    severity: "warning",
    title: "skill has no capability summary",
    description: "Skill description has no inferable capability blurb. Claude can't proactively reach for this skill during its own reasoning.",
  },
  W8: {
    severity: "warning",
    title: "skill missing when_to_invoke",
    description: "Skill has a capability but no explicit `when_to_invoke:` frontmatter — proactive routing falls back to a single generic row. Add `when_to_invoke:` with task-shape bullets for richer routing.",
  },
  W9: {
    severity: "warning",
    title: "local-only MCP",
    description: "Profile references an MCP that has a source dir but isn't in the sanitized public registry — a private/local server the user wires into their own ~/.claude.json. Not a profile bug, so it's a warning, not E3.",
  },
  E1: {
    severity: "error",
    title: "profile name collision",
    description: "Two profile.yaml files declare the same name.",
  },
  E2: {
    severity: "error",
    title: "cyclic inheritance",
    description: "The inherits chain loops back onto a profile already in the chain.",
  },
  E3: {
    severity: "error",
    title: "missing reference",
    description: "A referenced skill, MCP, or plugin cannot be resolved by its resolver.",
  },
};

export interface ProfileLintIssue {
  rule: DiagnosticRuleId;
  severity: LintSeverity;
  message: string;
  subject?: string;
  details?: string[];
}

export interface ProfileLintCheck {
  name: string;
  message: string;
}

export interface ProfileLintResult {
  profileName: string;
  checks: ProfileLintCheck[];
  issues: ProfileLintIssue[];
  resolved?: ResolvedProfile;
}

export interface ProfileLinterOptions {
  profilesDir?: string;
  skillsRoot?: string;
  pluginsRoot?: string;
  configsRoot?: string;
  processEnv?: MaterializeOptions["processEnv"];
  repoRoot?: string;
  npxFetch?: NpxFetchFn;
  npxOffline?: boolean;
}

interface RawProfileRecord {
  dirName: string;
  declaredName?: string;
}

function profilesDir(opts: ProfileLinterOptions): string {
  return opts.profilesDir ?? process.env.CUE_PROFILES_DIR ?? process.env.SOUL_PROFILES_DIR ?? DEFAULT_PROFILES_DIR;
}

function repoRoot(opts: ProfileLinterOptions): string {
  return opts.repoRoot ?? process.env.CUE_REPO_ROOT ?? process.env.SOUL_REPO_ROOT ?? cueRepoRoot();
}

function addIssue(
  result: ProfileLintResult,
  rule: DiagnosticRuleId,
  severity: LintSeverity,
  message: string,
  extra: Pick<ProfileLintIssue, "subject" | "details"> = {},
): void {
  result.issues.push({ rule, severity, message, ...extra });
}

function addCheck(result: ProfileLintResult, name: string, message: string): void {
  result.checks.push({ name, message });
}

export function hasLintErrors(result: ProfileLintResult): boolean {
  return result.issues.some((issue) => issue.severity === "error");
}

export async function lintAllProfiles(
  opts: ProfileLinterOptions = {},
): Promise<ProfileLintResult[]> {
  const names = await withProfilesDir(opts.profilesDir, () => listProfiles());
  const results: ProfileLintResult[] = [];
  for (const name of names) {
    results.push(await lintProfile(name, opts));
  }
  return results;
}

export async function lintProfile(
  profileName: string,
  opts: ProfileLinterOptions = {},
): Promise<ProfileLintResult> {
  const result: ProfileLintResult = {
    profileName,
    checks: [],
    issues: [],
  };

  await checkNameCollisions(profileName, result, opts);

  let resolved: ResolvedProfile;
  try {
    resolved = await withProfilesDir(opts.profilesDir, () => loadProfile(profileName));
  } catch (err) {
    recordLoadFailure(profileName, err, result);
    return result;
  }

  result.resolved = resolved;
  addCheck(result, "schema", `profile "${profileName}" loaded and schema-valid`);
  addCheck(
    result,
    "inheritance",
    `chain: ${resolved.inheritanceChain.join(" -> ")}`,
  );

  checkStaticRules(resolved, result);

  await checkLocalSkills(resolved, result, opts);
  await checkNpxSkills(resolved, result, opts);
  await checkPlugins(resolved, result, opts);
  await checkMcps(resolved, result, opts);
  await checkResourceRefs(resolved, result, opts);
  await checkSkillDescriptions(resolved, result, opts);

  return result;
}

/**
 * Lint each local skill's SKILL.md frontmatter for router-friendliness.
 * Emits W6 (no triggers), W7 (no capability), W8 (capability but no
 * when_to_invoke). Only inspects local skills — npx/plugin skills live
 * outside the repo and may be out-of-tree.
 */
async function checkSkillDescriptions(
  profile: ResolvedProfile,
  result: ProfileLintResult,
  opts: ProfileLinterOptions,
): Promise<void> {
  const refs = profile.skills.local;
  if (refs.length === 0) return;

  const skillsRoot = opts.skillsRoot ?? DEFAULT_SKILLS_ROOT;
  let weakTriggers = 0;
  let weakCapability = 0;
  let missingWhenTo = 0;

  for (const ref of refs) {
    if (ref.id.includes("*")) continue;
    const parsed = await parseSkillFromPath(ref.id, skillsRoot);
    if (parsed.missing) continue; // E3 already reports missing files

    if (parsed.triggers.length === 0) {
      addIssue(
        result,
        "W6",
        "warning",
        `skill "${ref.id}" has no parseable trigger phrases — add quoted phrases to its description (e.g. \`Use when user says "X", "Y"...\`)`,
        { subject: ref.id },
      );
      weakTriggers++;
    }
    if (!parsed.capability) {
      addIssue(
        result,
        "W7",
        "warning",
        `skill "${ref.id}" has no capability summary — add prose after the trigger phrases, or set \`capability:\` in frontmatter`,
        { subject: ref.id },
      );
      weakCapability++;
    } else if (parsed.capabilityExplicit && parsed.whenToInvoke.length === 0) {
      // W8 only fires when the skill has explicitly opted into the new
      // framework (capability: in frontmatter) but didn't finish the upgrade
      // (no when_to_invoke:). Skills using only inferred capability from
      // prose are exempt — they're a backwards-compat case.
      addIssue(
        result,
        "W8",
        "warning",
        `skill "${ref.id}" has explicit \`capability:\` but no \`when_to_invoke:\` — add task-shape bullets to enable richer proactive routing`,
        { subject: ref.id },
      );
      missingWhenTo++;
    }
  }

  if (weakTriggers === 0 && weakCapability === 0 && missingWhenTo === 0) {
    addCheck(result, "skill descriptions", `${refs.length} skills routed cleanly`);
  }
}

async function checkResourceRefs(
  profile: ResolvedProfile,
  result: ProfileLintResult,
  _opts: ProfileLinterOptions,
): Promise<void> {
  const { access } = await import("node:fs/promises");
  const { isAbsolute } = await import("node:path");

  const buckets: { label: string; refs: string[]; root: string; addExt: boolean }[] = [
    { label: "rules",    refs: profile.rules,    root: DEFAULT_RULES_ROOT,    addExt: true },
    { label: "commands", refs: profile.commands, root: DEFAULT_COMMANDS_ROOT, addExt: true },
    { label: "hooks",    refs: profile.hooks,    root: DEFAULT_HOOKS_ROOT,    addExt: false },
    { label: "subagents", refs: profile.subagents ?? [], root: DEFAULT_SUBAGENTS_ROOT, addExt: true },
  ];

  for (const { label, refs, root, addExt } of buckets) {
    if (refs.length === 0) {
      addCheck(result, label, `no ${label} declared`);
      continue;
    }
    let ok = 0;
    for (const ref of refs) {
      const withExt = addExt && !ref.endsWith(".md") ? `${ref}.md` : ref;
      const full = isAbsolute(withExt) ? withExt : join(root, withExt);
      try {
        await access(full);
        ok++;
      } catch {
        addIssue(
          result,
          "E3",
          "error",
          `${label} reference "${ref}" not found at ${full}`,
          { subject: ref },
        );
      }
    }
    if (ok === refs.length) addCheck(result, label, `${ok} resolved`);
  }
}

async function withProfilesDir<T>(
  profilesRoot: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!profilesRoot) return fn();
  const prior = process.env.CUE_PROFILES_DIR;
  const priorLegacy = process.env.SOUL_PROFILES_DIR;
  process.env.CUE_PROFILES_DIR = profilesRoot;
  process.env.SOUL_PROFILES_DIR = profilesRoot;
  try {
    return await fn();
  } finally {
    if (prior === undefined) {
      delete process.env.CUE_PROFILES_DIR;
    } else {
      process.env.CUE_PROFILES_DIR = prior;
    }
    if (priorLegacy === undefined) {
      delete process.env.SOUL_PROFILES_DIR;
    } else {
      process.env.SOUL_PROFILES_DIR = priorLegacy;
    }
  }
}

async function checkNameCollisions(
  profileName: string,
  result: ProfileLintResult,
  opts: ProfileLinterOptions,
): Promise<void> {
  const records = await readRawProfileNames(profilesDir(opts));
  const declaredByDir = new Map(records.map((record) => [record.dirName, record.declaredName]));
  const targetDeclaredName = declaredByDir.get(profileName);
  if (!targetDeclaredName) return;

  const dirs = records
    .filter((record) => record.declaredName === targetDeclaredName)
    .map((record) => record.dirName)
    .sort();

  if (dirs.length > 1) {
    addIssue(
      result,
      "E1",
      "error",
      `profile name "${targetDeclaredName}" is declared by multiple profile directories`,
      { subject: targetDeclaredName, details: dirs },
    );
  }
}

async function readRawProfileNames(root: string): Promise<RawProfileRecord[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const records: RawProfileRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;

    const file = join(root, entry.name, "profile.yaml");
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }

    let declaredName: string | undefined;
    try {
      const parsed = parseYaml(text);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        typeof (parsed as Record<string, unknown>).name === "string"
      ) {
        declaredName = (parsed as Record<string, string>).name;
      }
    } catch {
      declaredName = undefined;
    }

    records.push({ dirName: entry.name, declaredName });
  }
  return records;
}

function recordLoadFailure(
  profileName: string,
  err: unknown,
  result: ProfileLintResult,
): void {
  if (err instanceof InheritanceCycle) {
    addIssue(
      result,
      "E2",
      "error",
      `inheritance cycle detected: ${err.chain.join(" -> ")}`,
      { subject: profileName, details: err.chain },
    );
    return;
  }

  if (err instanceof SchemaViolation) {
    addIssue(
      result,
      "SCHEMA",
      "error",
      `profile "${profileName}" failed schema validation`,
      { subject: profileName, details: err.errors.map(formatUnknown) },
    );
    return;
  }

  if (err instanceof InheritanceDepthExceeded) {
    addIssue(
      result,
      "SCHEMA",
      "error",
      err.message,
      { subject: profileName, details: err.chain },
    );
    return;
  }

  if (err instanceof ProfileNotFound) {
    addIssue(result, "LOAD", "error", err.message, { subject: profileName });
    return;
  }

  if (err instanceof ProfileError) {
    addIssue(result, "LOAD", "error", err.message, { subject: profileName });
    return;
  }

  addIssue(
    result,
    "LOAD",
    "error",
    err instanceof Error ? err.message : String(err),
    { subject: profileName },
  );
}

function checkStaticRules(
  profile: ResolvedProfile,
  result: ProfileLintResult,
): void {
  const skillCount = declaredSkillCount(profile);
  if (skillCount > 120) {
    addIssue(
      result,
      "W1",
      "warning",
      `profile declares ${skillCount} skills; keep profiles lean when possible`,
      { subject: profile.name },
    );
  }

  if (profile.mcps.length > 5) {
    addIssue(
      result,
      "W2",
      "warning",
      `profile declares ${profile.mcps.length} MCPs; this can increase startup cost`,
      { subject: profile.name },
    );
  }

  const depth = Math.max(0, profile.inheritanceChain.length - 1);
  if (depth > 2) {
    addIssue(
      result,
      "W3",
      "warning",
      `inheritance depth is ${depth}; flatten if this profile becomes hard to audit`,
      { subject: profile.name, details: profile.inheritanceChain },
    );
  }

  const localSlugs = new Map<string, string[]>();
  for (const ref of profile.skills.local) {
    const slug = lastPathSegment(ref.id);
    const refs = localSlugs.get(slug) ?? [];
    refs.push(ref.id);
    localSlugs.set(slug, refs);
  }

  const npxSlugs = new Map<string, string[]>();
  for (const entry of profile.skills.npx) {
    for (const skill of entry.skills) {
      const refs = npxSlugs.get(skill) ?? [];
      refs.push(`${entry.repo}:${skill}`);
      npxSlugs.set(skill, refs);
    }
  }

  for (const [slug, localRefs] of localSlugs) {
    const npxRefs = npxSlugs.get(slug);
    if (!npxRefs) continue;
    addIssue(
      result,
      "W4",
      "warning",
      `skill "${slug}" appears in both local and npx sources`,
      { subject: slug, details: [...localRefs, ...npxRefs] },
    );
  }
}

function declaredSkillCount(profile: ResolvedProfile): number {
  const npxSkillCount = profile.skills.npx.reduce(
    (count, entry) => count + entry.skills.length,
    0,
  );
  return profile.skills.local.length + npxSkillCount + profile.plugins.length;
}

function lastPathSegment(ref: string): string {
  const trimmed = ref.trim().replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

async function checkLocalSkills(
  profile: ResolvedProfile,
  result: ProfileLintResult,
  opts: ProfileLinterOptions,
): Promise<void> {
  const refs = profile.skills.local;
  if (refs.length === 0) {
    addCheck(result, "local skills", "no local skills declared");
    return;
  }

  let resolvedCount = 0;
  for (const ref of refs) {
    try {
      const plans = await resolveLocal(profileWithLocal(profile, ref), {
        skillsRoot: opts.skillsRoot ?? DEFAULT_SKILLS_ROOT,
      });
      resolvedCount += plans.length;
    } catch (err) {
      addResolverIssue(result, "local skill", ref.id, err);
    }
  }

  if (resolvedCount === refs.length) {
    addCheck(result, "local skills", `${resolvedCount} resolved`);
  }
}

async function checkNpxSkills(
  profile: ResolvedProfile,
  result: ProfileLintResult,
  opts: ProfileLinterOptions,
): Promise<void> {
  const entries = profile.skills.npx;
  const total = entries.reduce((count, entry) => count + entry.skills.length, 0);
  if (total === 0) {
    addCheck(result, "npx skills", "no npx skills declared");
    return;
  }

  let resolvedCount = 0;
  let skippedOffline = 0;
  for (const entry of entries) {
    for (const skill of entry.skills) {
      try {
        const status = await resolveOneNpxSkill(entry, skill, opts);
        if (status === "skipped-offline") skippedOffline += 1;
        else resolvedCount += 1;
      } catch (err) {
        addResolverIssue(result, "npx skill", `${entry.repo}:${skill}`, err);
      }
    }
  }

  if (resolvedCount + skippedOffline === total) {
    addCheck(
      result,
      "npx skills",
      skippedOffline > 0
        ? `${resolvedCount} resolved, ${skippedOffline} not cached (offline; run --online to fetch)`
        : `${resolvedCount} resolved or fetchable`,
    );
  }
}

async function resolveOneNpxSkill(
  entry: NpxSkillRef,
  skill: string,
  opts: ProfileLinterOptions,
): Promise<"resolved" | "skipped-offline"> {
  const single: Profile = {
    name: "lint-npx",
    description: "single npx resolver check",
    skills: {
      npx: [{ repo: entry.repo, pin: entry.pin, skills: [skill] }],
    },
  };

  try {
    await resolveNpxDetailed(single, {
      repoRoot: repoRoot(opts),
      fetch: opts.npxFetch,
      offline: true,
    });
    return "resolved";
  } catch (err) {
    const offline = opts.npxOffline || (process.env.CUE_OFFLINE ?? process.env.SOUL_OFFLINE) === "1";
    if (offline) {
      // Offline mode: a cache miss is a benign "not cached", not a lint error.
      // Real problems (PinNotFound, schema, etc.) still propagate to E3.
      if (err instanceof NpxFetchFailed) return "skipped-offline";
      throw err;
    }
    if (!(err instanceof NpxFetchFailed || err instanceof ProfileError)) {
      throw err;
    }
  }

  const tempRepo = await mkdtemp(join(tmpdir(), "cue-validate-npx-"));
  try {
    await mkdir(join(tempRepo, "profiles", "_cache", "npx"), { recursive: true });
    await resolveNpxDetailed(single, {
      repoRoot: tempRepo,
      fetch: opts.npxFetch,
      offline: false,
    });
  } finally {
    await rm(tempRepo, { recursive: true, force: true });
  }
  return "resolved";
}

async function checkPlugins(
  profile: ResolvedProfile,
  result: ProfileLintResult,
  opts: ProfileLinterOptions,
): Promise<void> {
  const refs = profile.plugins;
  if (refs.length === 0) {
    addCheck(result, "plugins", "no plugins declared");
    return;
  }

  let resolvedCount = 0;
  for (const ref of refs) {
    try {
      await resolvePlugins(profileWithPlugin(profile, ref.id), {
        pluginsRoot: opts.pluginsRoot,
      });
      resolvedCount += 1;
    } catch (err) {
      addResolverIssue(result, "plugin", ref.id, err);
    }
  }

  if (resolvedCount === refs.length) {
    addCheck(result, "plugins", `${resolvedCount} resolved`);
  }
}

async function checkMcps(
  profile: ResolvedProfile,
  result: ProfileLintResult,
  opts: ProfileLinterOptions,
): Promise<void> {
  if (profile.mcps.length === 0) {
    addCheck(result, "MCPs", "no MCPs declared");
    return;
  }

  let resolvedCount = 0;
  for (const ref of profile.mcps) {
    try {
      await materializeMcp(profileWithMcp(profile, ref), {
        configsRoot: opts.configsRoot ?? DEFAULT_CONFIGS_ROOT,
        processEnv: opts.processEnv,
      });
      resolvedCount += 1;
    } catch (err) {
      // A ref to an MCP that has a source dir but is absent from the sanitized
      // public registry is a private/local-only server (configured in the
      // user's own ~/.claude.json), not a profile bug — demote to W9, the same
      // way PluginNotInstalled demotes to W5. A ref with no source dir is a
      // genuine dangling reference and still fails with E3.
      if (err instanceof McpNotFound && mcpHasLocalSource(ref.id, opts)) {
        addIssue(
          result,
          "W9",
          "warning",
          `MCP "${ref.id}" is local-only — it has a source dir but isn't in the sanitized public registry; configure it in ~/.claude.json`,
          { subject: ref.id },
        );
      } else {
        addResolverIssue(result, "MCP", ref.id, err);
      }
    }
  }

  if (resolvedCount === profile.mcps.length) {
    addCheck(result, "MCPs", `${resolvedCount} resolved`);
  }
}

function addResolverIssue(
  result: ProfileLintResult,
  kind: string,
  ref: string,
  err: unknown,
): void {
  // Plugin-not-installed is environmental state (the profile is correct, the
  // user's machine just doesn't have the plugin yet) — demote to W5 warning
  // rather than failing validation with E3.
  if (err instanceof PluginNotInstalled) {
    addIssue(
      result,
      "W5",
      "warning",
      `plugin "${ref}" is not installed locally — run /plugin marketplace add ${ref.split("@")[0]}`,
      { subject: ref },
    );
    return;
  }
  addIssue(
    result,
    "E3",
    "error",
    `${kind} "${ref}" failed resolver dry-run: ${formatErrorMessage(err)}`,
    { subject: ref },
  );
}

function profileWithLocal(profile: ResolvedProfile, ref: ResolvedProfile["skills"]["local"][number]): ResolvedProfile {
  return {
    ...profile,
    skills: { local: [ref], npx: [] },
  };
}

function profileWithPlugin(profile: ResolvedProfile, id: string): ResolvedProfile {
  return {
    ...profile,
    skills: { local: [], npx: [] },
    plugins: [{ id }],
  };
}

function profileWithMcp(profile: ResolvedProfile, ref: ResolvedProfile["mcps"][number]): ResolvedProfile {
  return {
    ...profile,
    mcps: [ref],
  };
}

/**
 * True when an MCP id has a source manifest dir under `resources/mcps/mcps/<id>`
 * even though it's absent from the sanitized public registry — i.e. a private /
 * local-only server, not a dangling reference. Keyed off the same registry root
 * the resolver uses (configsRoot's parent) so test overrides stay consistent.
 */
function mcpHasLocalSource(id: string, opts: ProfileLinterOptions): boolean {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return false;
  const configsRoot = opts.configsRoot ?? DEFAULT_CONFIGS_ROOT;
  return existsSync(join(dirname(configsRoot), "mcps", id));
}

function formatErrorMessage(err: unknown): string {
  if (err instanceof ProfileError) {
    return `${err.code}: ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function formatUnknown(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return String(value);

  const record = value as Record<string, unknown>;
  const path =
    typeof record.instancePath === "string" && record.instancePath.length > 0
      ? `${record.instancePath}: `
      : "";
  const keyword =
    typeof record.keyword === "string" && record.keyword.length > 0
      ? `${record.keyword}: `
      : "";
  const message =
    typeof record.message === "string"
      ? record.message
      : JSON.stringify(record);
  return `${path}${keyword}${message}`;
}
