/**
 * Profile linter for `soul validate`.
 *
 * The rules below are intentionally numbered and centralized so a later
 * suppression pass can key off stable ids such as `# lint: ignore W1`.
 *
 * W1: profile declares more than 25 skills.
 * W2: profile declares more than 5 MCP servers.
 * W3: inheritance chain depth is greater than 2.
 * W4: a skill slug appears in both `skills.local` and `skills.npx`.
 * E1: profile `name:` collides with another profile.
 * E2: inheritance chain contains a cycle.
 * E3: referenced skill, MCP, or plugin cannot be resolved.
 */

import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
} from "../../../profiles/_types";
import { listProfiles, loadProfile } from "./profile-loader";
import { materializeMcp, type MaterializeOptions } from "./mcp-materializer";
import { resolveLocal } from "./resolver-local";
import {
  NpxFetchFailed,
  resolveNpxDetailed,
  type NpxFetchFn,
} from "./resolver-npx";
import { resolvePlugins } from "./resolver-plugins";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.SOUL_REPO_ROOT ?? resolve(HERE, "..", "..", "..");
const DEFAULT_PROFILES_DIR = join(REPO_ROOT, "profiles");
const DEFAULT_SKILLS_ROOT = join(REPO_ROOT, "skills", "skills");
const DEFAULT_CONFIGS_ROOT = join(REPO_ROOT, "mcps", "configs");

export type LintRuleId = "W1" | "W2" | "W3" | "W4" | "E1" | "E2" | "E3";
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
    description: "Profile declares more than 25 skills; this can bloat prompt tokens.",
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
  return opts.profilesDir ?? process.env.SOUL_PROFILES_DIR ?? DEFAULT_PROFILES_DIR;
}

function repoRoot(opts: ProfileLinterOptions): string {
  return opts.repoRoot ?? process.env.SOUL_REPO_ROOT ?? REPO_ROOT;
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

  return result;
}

async function withProfilesDir<T>(
  profilesRoot: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!profilesRoot) return fn();
  const prior = process.env.SOUL_PROFILES_DIR;
  process.env.SOUL_PROFILES_DIR = profilesRoot;
  try {
    return await fn();
  } finally {
    if (prior === undefined) {
      delete process.env.SOUL_PROFILES_DIR;
    } else {
      process.env.SOUL_PROFILES_DIR = prior;
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
  let entries: Awaited<ReturnType<typeof readdir>>;
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
  if (skillCount > 25) {
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
  for (const entry of entries) {
    for (const skill of entry.skills) {
      try {
        await resolveOneNpxSkill(entry, skill, opts);
        resolvedCount += 1;
      } catch (err) {
        addResolverIssue(result, "npx skill", `${entry.repo}:${skill}`, err);
      }
    }
  }

  if (resolvedCount === total) {
    addCheck(result, "npx skills", `${resolvedCount} resolved or fetchable`);
  }
}

async function resolveOneNpxSkill(
  entry: NpxSkillRef,
  skill: string,
  opts: ProfileLinterOptions,
): Promise<void> {
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
    return;
  } catch (err) {
    if (opts.npxOffline || process.env.SOUL_OFFLINE === "1") {
      throw err;
    }
    if (!(err instanceof NpxFetchFailed || err instanceof ProfileError)) {
      throw err;
    }
  }

  const tempRepo = await mkdtemp(join(tmpdir(), "soul-validate-npx-"));
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
      addResolverIssue(result, "MCP", ref.id, err);
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
