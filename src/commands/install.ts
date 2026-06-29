/**
 * `cue install` — prepare cue profiles, import external skill repos, and audit
 * materialized runtimes.
 *
 * Dry-run is the default. Pass --yes to write runtimes/profile files or execute
 * installers. External repo setup scripts need --run-setup in addition to --yes.
 */

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { AgentKind } from "../../profiles/_types";
import { configDir } from "../lib/config-paths";
import { resolveActiveProfile } from "../lib/cwd-resolver";
import { getAdapter, AGENT_IDS } from "../lib/agent-adapters";
import { loadProfile, listProfiles } from "../lib/profile-loader";
import {
  expandSkillWildcards,
  isRuntimeAgent,
  loadMcpRegistry,
  prepareRuntime,
  resolveClaudeCredentialsSource,
  runtimeDirFor,
  type RuntimeAgent,
  RUNTIME_AGENTS,
} from "../lib/runtime-install";
import { resolveLocalSkill } from "../lib/resolver-local";
import { run as cliRun } from "./cli";
import { repoRoot } from "../lib/repo-root";

type AnyAgent = AgentKind;

interface ParsedArgs {
  profiles: string[];
  allProfiles: boolean;
  agents: AnyAgent[];
  yes: boolean;
  dryRun: boolean;
  json: boolean;
  force: boolean;
  withClis: boolean;
  dir?: string;
  preset?: "skills-only" | "runtimes-and-clis" | "full";
}

interface InstallAction {
  profile: string;
  agent: AnyAgent;
  targetDir: string;
  status: "planned" | "rebuilt" | "cached" | "written" | "failed";
  error?: string;
}

interface InstallReport {
  profile: string;
  agent: RuntimeAgent;
  missingMcps: string[];
  oversizedSkills: Array<{ id: string; bytes: number }>;
  brokenRuntimeSkills: string[];
}

interface RepoArgs {
  repo: string;
  profile?: string;
  category: string;
  yes: boolean;
  dryRun: boolean;
  json: boolean;
  runSetup: boolean;
  force: boolean;
}

const PROFILES_DIR = process.env.CUE_PROFILES_DIR ?? process.env.SOUL_PROFILES_DIR ?? join(repoRoot(), "profiles");
const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");
const BYTE_CEILING = 160_000;

function bold(s: string): string { return `\x1b[1m${s}\x1b[0m`; }
function green(s: string): string { return `\x1b[32m${s}\x1b[0m`; }
function yellow(s: string): string { return `\x1b[33m${s}\x1b[0m`; }
function dim(s: string): string { return `\x1b[2m${s}\x1b[0m`; }

function usage(): void {
  process.stdout.write(`cue install — prepare cue profiles for local agents

Usage:
  cue install [profile] [--agents claude-code,codex] [--with-clis] [--yes]
  cue install --all-profiles [--agents claude-code,codex] [--with-clis] [--yes]
  cue install repo <github-url|owner/repo> --profile <name> [--yes] [--run-setup]
  cue install doctor [profile|--all-profiles] [--json]

Flags:
  --all-profiles       Prepare or audit every installed profile
  --profile <name>     Prepare a specific profile
  --agents <list>      Agents: claude-code,codex,cursor,cline,windsurf,gemini,copilot,roo,amp,aider,all
  --dir <path>         Target dir for project/global adapters outside cue runtime
  --preset <name>      skills-only | runtimes-and-clis | full
  --with-clis          Also run cue cli install --all for each profile
  --yes                Execute writes/installers. Default is dry-run
  --dry-run            Show the plan without writing
  --force              Rebuild runtimes by dropping their .cue-hash first
  --json               Machine-readable output

Repo flags:
  --category <name>    Category for vendored skills, default external
  --run-setup          Run ./setup in the cloned repo. Requires --yes

Examples:
  cue install core
  cue install gstack --yes
  cue install backend --agents cursor --dir . --yes
  cue install --all-profiles --preset runtimes-and-clis --yes
  cue install repo https://github.com/garrytan/gstack.git --profile maker --yes --run-setup
  cue install doctor --all-profiles
`);
}

function parseAgents(raw: string | undefined): AnyAgent[] | null {
  if (!raw) return [...RUNTIME_AGENTS];
  const values = raw === "all" ? AGENT_IDS : raw.split(",").map((p) => p.trim()).filter(Boolean);
  const out: AnyAgent[] = [];
  for (const value of values) {
    const normalized = value === "claude" ? "claude-code" : value;
    if (!AGENT_IDS.includes(normalized)) return null;
    if (!out.includes(normalized as AnyAgent)) out.push(normalized as AnyAgent);
  }
  return out.length > 0 ? out : null;
}

function parse(args: string[]): ParsedArgs | null {
  const profiles: string[] = [];
  let allProfiles = false;
  let agents: AnyAgent[] = [...RUNTIME_AGENTS];
  let yes = false;
  let dryRun = false;
  let json = false;
  let force = false;
  let withClis = false;
  let dir: string | undefined;
  let preset: ParsedArgs["preset"];

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-h" || a === "--help") return null;
    if (a === "--all-profiles") allProfiles = true;
    else if (a === "--profile") profiles.push(args[++i] ?? "");
    else if (a === "--agents") {
      const parsed = parseAgents(args[++i]);
      if (!parsed) throw new Error(`invalid --agents value; use ${AGENT_IDS.join(",")},all`);
      agents = parsed;
    } else if (a === "--dir") dir = args[++i];
    else if (a === "--preset") {
      const value = args[++i];
      if (value !== "skills-only" && value !== "runtimes-and-clis" && value !== "full") {
        throw new Error("invalid --preset; use skills-only, runtimes-and-clis, or full");
      }
      preset = value;
    } else if (a === "--yes") yes = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--json") json = true;
    else if (a === "--force") force = true;
    else if (a === "--with-clis" || a === "--clis") withClis = true;
    else if (a.startsWith("-")) throw new Error(`unknown flag: ${a}`);
    else profiles.push(a);
  }

  if (preset === "runtimes-and-clis" || preset === "full") withClis = true;
  if (preset === "skills-only") withClis = false;

  return {
    profiles: profiles.filter(Boolean),
    allProfiles,
    agents,
    yes,
    dryRun: dryRun || !yes,
    json,
    force,
    withClis,
    dir,
    preset,
  };
}

async function resolveProfiles(parsed: ParsedArgs): Promise<string[]> {
  if (parsed.allProfiles) return listProfiles();
  if (parsed.profiles.length > 0) return [...new Set(parsed.profiles)];
  const active = await resolveActiveProfile();
  if (!active) throw new Error("no active profile. Pass a profile name or use --all-profiles.");
  return [active];
}

function targetDirFor(profile: string, agent: AnyAgent, dir?: string): string {
  if (isRuntimeAgent(agent)) return runtimeDirFor(profile, agent);
  const adapter = getAdapter(agent);
  return resolve(dir ?? adapter?.configDir() ?? process.cwd());
}

async function loadSkillContent(id: string): Promise<{ id: string; content: string } | null> {
  try {
    const dir = await resolveLocalSkill(id);
    return { id, content: await readFile(join(dir, "SKILL.md"), "utf8") };
  } catch {
    return null;
  }
}

async function materializeExternalProfile(profileName: string, agent: Exclude<AnyAgent, RuntimeAgent>, dir?: string): Promise<InstallAction> {
  const adapter = getAdapter(agent);
  const targetDir = targetDirFor(profileName, agent, dir);
  if (!adapter) return { profile: profileName, agent, targetDir, status: "failed", error: `unknown agent ${agent}` };
  try {
    const profile = await loadProfile(profileName);
    await expandSkillWildcards(profile);
    const skills = (await Promise.all(profile.skills.local.map((s) => loadSkillContent(s.id))))
      .filter(Boolean) as { id: string; content: string }[];
    const registry = isRuntimeAgent(agent) ? {} : await loadMcpRegistry("claude-code");
    const mcps: Record<string, unknown> = {};
    for (const m of profile.mcps) {
      if (registry[m.id]) mcps[m.id] = registry[m.id];
    }
    adapter.writeSkills(skills, targetDir);
    adapter.writeMcps(mcps, targetDir);
    return { profile: profileName, agent, targetDir, status: "written" };
  } catch (err) {
    return {
      profile: profileName,
      agent,
      targetDir,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function materializeProfile(profileName: string, agent: AnyAgent, force: boolean, dir?: string): Promise<InstallAction> {
  const targetDir = targetDirFor(profileName, agent, dir);
  if (!isRuntimeAgent(agent)) return materializeExternalProfile(profileName, agent, dir);
  try {
    if (force) await rm(join(targetDir, ".cue-hash"), { force: true });
    const profile = await loadProfile(profileName);
    await expandSkillWildcards(profile);
    const result = await prepareRuntime({
      profile,
      agent,
      credentialsSource: agent === "claude-code"
        ? await resolveClaudeCredentialsSource({ healFromRuntime: false })
        : undefined,
    });
    return { profile: profileName, agent, targetDir: result.runtimeDir, status: result.rebuilt ? "rebuilt" : "cached" };
  } catch (err) {
    return {
      profile: profileName,
      agent,
      targetDir,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function plannedActions(profiles: string[], agents: AnyAgent[], dir?: string): InstallAction[] {
  return profiles.flatMap((profile) =>
    agents.map((agent) => ({ profile, agent, targetDir: targetDirFor(profile, agent, dir), status: "planned" as const })),
  );
}

async function captureStdout(fn: () => Promise<number>): Promise<{ stdout: string; code: number }> {
  const orig = process.stdout.write.bind(process.stdout);
  let stdout = "";
  (process.stdout as any).write = (chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  };
  try {
    const code = await fn();
    return { stdout, code };
  } finally {
    (process.stdout as any).write = orig;
  }
}

async function runCliStep(profile: string, dryRun: boolean, json: boolean): Promise<{ profile: string; code: number; stdout?: string }> {
  const args = ["install", "--all", profile];
  if (!dryRun) args.push("--yes");
  if (json || dryRun) args.push("--json");
  if (json || dryRun) {
    const result = await captureStdout(() => cliRun(args));
    return { profile, code: result.code, stdout: result.stdout };
  }
  return { profile, code: await cliRun(args) };
}

function parseJsonOrText(stdout: string | undefined): unknown {
  if (!stdout) return undefined;
  try { return JSON.parse(stdout); } catch { return { text: stdout }; }
}

async function buildReport(profileName: string, agent: RuntimeAgent): Promise<InstallReport> {
  const profile = await loadProfile(profileName);
  await expandSkillWildcards(profile);
  const registry = await loadMcpRegistry(agent);
  const missingMcps = profile.mcps
    .filter((m) => !m.agents || m.agents.includes(agent))
    .map((m) => m.id)
    .filter((id) => !registry[id]);

  const oversizedSkills: InstallReport["oversizedSkills"] = [];
  for (const skill of profile.skills.local) {
    if (skill.agents && !skill.agents.includes(agent)) continue;
    try {
      const dir = await resolveLocalSkill(skill.id);
      const bytes = statSync(join(dir, "SKILL.md")).size;
      if (bytes > BYTE_CEILING) oversizedSkills.push({ id: skill.id, bytes });
    } catch {
      // validate/debug surface missing skills.
    }
  }

  const brokenRuntimeSkills: string[] = [];
  const skillsDir = join(runtimeDirFor(profileName, agent), "skills");
  try {
    for (const entry of readdirSync(skillsDir)) {
      const path = join(skillsDir, entry);
      try {
        if (lstatSync(path).isSymbolicLink() && !existsSync(join(path, "SKILL.md"))) {
          brokenRuntimeSkills.push(entry);
        }
      } catch {
        brokenRuntimeSkills.push(entry);
      }
    }
  } catch {
    // Runtime not materialized yet.
  }

  return { profile: profileName, agent, missingMcps, oversizedSkills, brokenRuntimeSkills };
}

async function doctorCmd(args: string[]): Promise<number> {
  const parsed = parse(args);
  if (!parsed) { usage(); return 0; }
  let profiles: string[];
  try { profiles = await resolveProfiles(parsed); }
  catch (err) { process.stderr.write(`cue install doctor: ${(err as Error).message}\n`); return 1; }
  const agents = parsed.agents.filter(isRuntimeAgent);
  const reports = (await Promise.all(profiles.flatMap((profile) => agents.map((agent) => buildReport(profile, agent)))));
  const failed = reports.some((r) => r.missingMcps.length || r.oversizedSkills.length || r.brokenRuntimeSkills.length);
  if (parsed.json) {
    process.stdout.write(JSON.stringify({ reports }, null, 2) + "\n");
    return failed ? 1 : 0;
  }
  process.stdout.write(`\n  ${bold("cue install doctor")}\n\n`);
  for (const r of reports) {
    const issues = r.missingMcps.length + r.oversizedSkills.length + r.brokenRuntimeSkills.length;
    process.stdout.write(`  ${issues ? yellow("warn") : green("ok")} ${r.profile} ${r.agent}\n`);
    if (r.missingMcps.length) process.stdout.write(`    missing MCPs: ${r.missingMcps.join(", ")}\n`);
    if (r.oversizedSkills.length) process.stdout.write(`    oversized skills: ${r.oversizedSkills.map((s) => `${s.id} (${s.bytes} bytes)`).join(", ")}\n`);
    if (r.brokenRuntimeSkills.length) process.stdout.write(`    broken runtime skills: ${r.brokenRuntimeSkills.join(", ")}\n`);
  }
  process.stdout.write("\n");
  return failed ? 1 : 0;
}

function normalizeRepo(input: string): { owner: string; repo: string; cloneUrl: string; slug: string } {
  const cleaned = input.trim().replace(/\.git$/, "");
  const match = cleaned.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/#?]+)/) ?? cleaned.match(/^(?<owner>[^/\s]+)\/(?<repo>[^/\s]+)$/);
  if (!match?.groups) throw new Error("repo must be a GitHub URL or owner/repo");
  const owner = match.groups.owner!;
  const repo = match.groups.repo!;
  const slug = `${owner}-${repo}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
  return { owner, repo, slug, cloneUrl: `https://github.com/${owner}/${repo}.git` };
}

function parseRepoArgs(args: string[]): RepoArgs | null {
  if (args.includes("-h") || args.includes("--help")) return null;
  let repo: string | undefined;
  let profile: string | undefined;
  let category = "external";
  let yes = false;
  let dryRun = false;
  let json = false;
  let runSetup = false;
  let force = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === repo) continue;
    if (a === "--profile") profile = args[++i];
    else if (a === "--category") category = args[++i] ?? "external";
    else if (a === "--yes") yes = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--json") json = true;
    else if (a === "--run-setup") runSetup = true;
    else if (a === "--force") force = true;
    else if (a.startsWith("-")) throw new Error(`unknown flag: ${a}`);
    else if (!repo) repo = a;
    else throw new Error(`unexpected argument: ${a}`);
  }
  if (!repo) throw new Error("missing repo. Usage: cue install repo <github-url|owner/repo>");
  return { repo, profile, category, yes, dryRun: dryRun || !yes, json, runSetup, force };
}

function findSkillDirs(root: string): string[] {
  const out: string[] = [];
  const ignore = new Set([".git", "node_modules", "dist", "coverage"]);
  function walk(dir: string, depth: number): void {
    if (depth > 5) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    if (entries.includes("SKILL.md")) {
      out.push(dir);
      return;
    }
    for (const entry of entries) {
      if (ignore.has(entry)) continue;
      const path = join(dir, entry);
      try {
        if (statSync(path).isDirectory()) walk(path, depth + 1);
      } catch {
        // skip
      }
    }
  }
  walk(root, 0);
  return out.sort();
}

function profileYamlPath(profile: string): string {
  return join(PROFILES_DIR, profile, "profile.yaml");
}

async function addSkillsToProfile(profile: string, skillIds: string[]): Promise<void> {
  const path = profileYamlPath(profile);
  const raw = await readFile(path, "utf8");
  const doc = (parseYaml(raw) ?? {}) as Record<string, any>;
  doc.skills ??= {};
  doc.skills.local ??= [];
  const existing = new Set((doc.skills.local as unknown[]).map((x) => typeof x === "string" ? x : (x as any)?.id).filter(Boolean));
  for (const id of skillIds) {
    if (!existing.has(id)) doc.skills.local.push(id);
  }
  await writeFile(path, stringifyYaml(doc));
}

async function repoCmd(args: string[]): Promise<number> {
  let parsed: RepoArgs;
  try {
    const p = parseRepoArgs(args);
    if (!p) { usage(); return 0; }
    parsed = p;
  } catch (err) {
    process.stderr.write(`cue install repo: ${(err as Error).message}\n`);
    return 1;
  }

  const repo = normalizeRepo(parsed.repo);
  const cacheDir = join(configDir(), "repo-cache", repo.slug);
  const sourceDesc = `${repo.owner}/${repo.repo}`;
  const skillIds: string[] = [];

  if (!parsed.dryRun) {
    await mkdir(dirname(cacheDir), { recursive: true });
    if (!existsSync(cacheDir)) {
      const clone = spawnSync("git", ["clone", "--single-branch", "--depth", "1", repo.cloneUrl, cacheDir], { stdio: "inherit" });
      if (clone.status !== 0) return clone.status ?? 1;
    } else if (parsed.force) {
      const pull = spawnSync("git", ["-C", cacheDir, "pull", "--ff-only"], { stdio: "inherit" });
      if (pull.status !== 0) return pull.status ?? 1;
    }
    if (parsed.runSetup) {
      const setup = join(cacheDir, "setup");
      if (!existsSync(setup)) {
        process.stderr.write(`cue install repo: no setup script at ${setup}\n`);
        return 1;
      }
      const res = spawnSync("./setup", { cwd: cacheDir, stdio: "inherit" });
      if (res.status !== 0) return res.status ?? 1;
    }
  }

  const scannedRoot = existsSync(cacheDir) ? cacheDir : process.cwd();
  const skillDirs = parsed.dryRun && !existsSync(cacheDir) ? [] : findSkillDirs(scannedRoot);
  if (!parsed.dryRun) {
    await mkdir(join(SKILLS_ROOT, parsed.category), { recursive: true });
    for (const dir of skillDirs) {
      const slug = basename(dir).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      if (!slug) continue;
      const dest = join(SKILLS_ROOT, parsed.category, slug);
      if (!existsSync(dest)) {
        const rel = relative(dirname(dest), dir);
        await symlink(rel, dest);
      }
      await writeFile(join(dest, ".source"), `${sourceDesc}::${relative(cacheDir, dir)}\n`);
      skillIds.push(`${parsed.category}/${slug}`);
    }
    if (parsed.profile && skillIds.length > 0) await addSkillsToProfile(parsed.profile, skillIds);
  }

  const out = {
    dryRun: parsed.dryRun,
    repo: sourceDesc,
    cacheDir,
    category: parsed.category,
    setup: parsed.runSetup ? "will-run" : "skipped",
    discoveredSkills: skillDirs.map((d) => relative(scannedRoot, d)),
    registeredSkills: skillIds,
    profile: parsed.profile,
  };
  if (parsed.json) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  else {
    process.stdout.write(`\n  ${bold("cue install repo")} ${parsed.dryRun ? dim("(dry-run; pass --yes to execute)") : ""}\n`);
    process.stdout.write(`  repo:     ${sourceDesc}\n`);
    process.stdout.write(`  cache:    ${cacheDir}\n`);
    process.stdout.write(`  category: ${parsed.category}\n`);
    process.stdout.write(`  setup:    ${parsed.runSetup ? "enabled" : "skipped"}\n`);
    process.stdout.write(`  skills:   ${parsed.dryRun && !existsSync(cacheDir) ? "unknown until clone" : String(skillDirs.length)}\n`);
    if (parsed.profile) process.stdout.write(`  profile:  ${parsed.profile}\n`);
    process.stdout.write("\n");
  }
  return 0;
}

async function runMain(args: string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    const p = parse(args);
    if (!p) { usage(); return 0; }
    parsed = p;
  } catch (err) {
    process.stderr.write(`cue install: ${(err as Error).message}\n`);
    return 1;
  }

  let profiles: string[];
  try { profiles = await resolveProfiles(parsed); }
  catch (err) { process.stderr.write(`cue install: ${(err as Error).message}\n`); return 1; }

  const projectAgents = parsed.agents.filter((a) => !isRuntimeAgent(a));
  if (!parsed.dryRun && profiles.length > 1 && projectAgents.length > 0) {
    process.stderr.write("cue install: refusing to write project/global agent files for multiple profiles in one target dir. Use one profile at a time.\n");
    return 1;
  }

  const actions = parsed.dryRun
    ? plannedActions(profiles, parsed.agents, parsed.dir)
    : await Promise.all(profiles.flatMap((profile) =>
        parsed.agents.map((agent) => materializeProfile(profile, agent, parsed.force, parsed.dir)),
      ));

  const cliResults = parsed.withClis
    ? await Promise.all(profiles.map((profile) => runCliStep(profile, parsed.dryRun, parsed.json)))
    : [];
  const reports = await Promise.all(profiles.flatMap((profile) =>
    parsed.agents.filter(isRuntimeAgent).map((agent) => buildReport(profile, agent)),
  ));

  if (parsed.json) {
    process.stdout.write(JSON.stringify({
      dryRun: parsed.dryRun,
      profiles,
      agents: parsed.agents,
      actions,
      cliResults: cliResults.map((r) => ({ profile: r.profile, code: r.code, plan: parseJsonOrText(r.stdout) })),
      reports,
    }, null, 2) + "\n");
    return actions.some((a) => a.status === "failed") || cliResults.some((r) => r.code !== 0) ? 1 : 0;
  }

  process.stdout.write(`\n  ${bold("cue install")} ${parsed.dryRun ? dim("(dry-run; pass --yes to execute)") : ""}\n`);
  process.stdout.write(`  profiles: ${profiles.join(", ")}\n`);
  process.stdout.write(`  agents:   ${parsed.agents.join(", ")}\n\n`);
  for (const action of actions) {
    const status = action.status === "planned" ? yellow("plan")
      : action.status === "failed" ? yellow("failed")
      : green(action.status);
    process.stdout.write(`  ${status.padEnd(16)} ${action.profile.padEnd(20)} ${action.agent.padEnd(11)} ${dim(action.targetDir)}\n`);
    if (action.error) process.stdout.write(`    ${yellow(action.error)}\n`);
  }
  if (parsed.withClis) {
    process.stdout.write(`\n  ${bold("CLI installers")}\n`);
    for (const result of cliResults) {
      process.stdout.write(`  ${result.code === 0 ? green("ok") : yellow("failed")} ${result.profile}\n`);
      if (result.stdout && parsed.dryRun) {
        const plan = parseJsonOrText(result.stdout) as { plans?: unknown[]; text?: string };
        process.stdout.write(`    ${plan.plans?.length ?? 0} missing CLI plan(s)\n`);
      } else if (result.stdout) process.stdout.write(result.stdout);
    }
  }
  const warnings = reports.reduce((n, r) => n + r.missingMcps.length + r.oversizedSkills.length + r.brokenRuntimeSkills.length, 0);
  process.stdout.write(`\n  ${bold("Report")} ${warnings ? yellow(`${warnings} warning(s)`) : green("clean")}\n`);
  if (parsed.dryRun) {
    process.stdout.write(`\n  Execute: ${bold("cue install " + (parsed.allProfiles ? "--all-profiles " : profiles.join(" ") + " ") + "--yes")}\n\n`);
  } else {
    process.stdout.write(`\n  ${green("install complete")}\n\n`);
  }
  return actions.some((a) => a.status === "failed") || cliResults.some((r) => r.code !== 0) ? 1 : 0;
}

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    usage();
    return 0;
  }
  const sub = args[0];
  if (sub === "repo") return repoCmd(args.slice(1));
  if (sub === "doctor") return doctorCmd(args.slice(1));
  return runMain(args);
}
