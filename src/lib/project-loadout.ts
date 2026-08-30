/**
 * Project loadout — project-aware skill loading.
 *
 * A loadout classifies each of a profile's local skills as **full**
 * (materialized as today) or **deferred** (excluded from the runtime skills
 * dir — that's what removes its always-on frontmatter cost — but listed in a
 * generated index skill so the agent can still find and load it on demand).
 * Deferral is *defer, not drop*: a wrong guess degrades to one extra Read,
 * never a missing capability.
 *
 * Classification is deterministic, per project:
 *   1. `userKeep` (promoted via `cue loadout keep`)      → full
 *   2. `userDefer` (demoted via `cue loadout defer`)     → deferred
 *   3. a `when:` condition on the skill ref              → evaluate against cwd
 *   4. ALWAYS_KEEP operational primitives                → full
 *   5. id/category token or description word matches a
 *      project signal (package.json deps, frameworks,
 *      languages, tools from project-scanner)            → full
 *   6. everything else                                   → deferred
 *
 * The result persists in ~/.config/cue/loadouts.json keyed by the profile pin
 * dir (mirrors mcp-overrides.json), and is reused while BOTH the profile's
 * skill-set fingerprint and the project's signals hash still match — so
 * repeat launches don't re-read 170 SKILL.md files.
 *
 * Fail open everywhere: any error yields "no loadout" and the launch proceeds
 * with the full profile, exactly as before this feature existed.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, type Dirent } from "node:fs";
import { dirname, join } from "node:path";

import type { DeferredSkillEntry, ResolvedProfile, ResolvedSkill } from "../../profiles/_types";
import { evaluateCondition } from "./conditional-skills";
import { configDir } from "./config-paths";
import { scanProject } from "./project-scanner";
import { ALWAYS_KEEP } from "./skill-subset";

/** Loadout only engages on genuinely heavy profiles; lean ones load as today. */
export const LOADOUT_MIN_SKILLS = 25;

/** One deferred skill's row in the generated index. */
export type DeferredSkill = DeferredSkillEntry;

/** One directory's persisted loadout. */
export interface LoadoutEntry {
  /** Composite profile selector this loadout was captured for. */
  profile: string;
  /** Hash of the profile's sorted local-skill id set at capture time. */
  fingerprint: string;
  /** Hash of the project signals at capture time. */
  signalsHash: string;
  full: string[];
  deferred: string[];
  /** Skill ids the user explicitly promoted / demoted (`cue loadout keep|defer`). */
  userKeep: string[];
  userDefer: string[];
  /** `cue loadout off` — launch skips the loadout for this project. */
  enabled: boolean;
  capturedAt: string;
}

type LoadoutsFile = Record<string, LoadoutEntry>;

export function loadoutsPath(): string {
  return join(configDir(), "loadouts.json");
}

function readAll(path: string): LoadoutsFile {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as LoadoutsFile) : {};
  } catch {
    return {};
  }
}

export function readLoadout(dir: string, path: string = loadoutsPath()): LoadoutEntry | undefined {
  return readAll(path)[dir];
}

export function writeLoadout(dir: string, entry: LoadoutEntry, path: string = loadoutsPath()): void {
  const all = readAll(path);
  all[dir] = entry;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(all, null, 2) + "\n");
}

export function deleteLoadout(dir: string, path: string = loadoutsPath()): boolean {
  const all = readAll(path);
  if (!(dir in all)) return false;
  delete all[dir];
  writeFileSync(path, JSON.stringify(all, null, 2) + "\n");
  return true;
}

/** Walk `cwd` upward looking for a saved loadout (covers running in a subdir). */
export function findLoadoutDir(cwd: string, path: string = loadoutsPath()): string | undefined {
  const all = readAll(path);
  let dir = cwd;
  for (;;) {
    if (dir in all) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Order-independent fingerprint of a skill id set (same recipe as mcpFingerprint). */
export function skillFingerprint(skillIds: string[]): string {
  const normalized = [...new Set(skillIds.map((id) => id.toLowerCase()))].sort();
  return createHash("sha256").update(normalized.join(",")).digest("hex").slice(0, 16);
}

export function signalsHash(signals: ReadonlySet<string>): string {
  return createHash("sha256").update([...signals].sort().join(",")).digest("hex").slice(0, 16);
}

// Tokens too generic to indicate project relevance on their own — matching
// "config" or "api" would mark half the library as relevant everywhere.
const STOP_TOKENS = new Set([
  "config", "framework", "plugin", "plugins", "core", "cli", "api", "app",
  "web", "node", "js", "ts", "mjs", "cjs", "json", "types", "type", "utils",
  "util", "tools", "tool", "dev", "lib", "libs", "sdk", "client", "server",
  "dom", "helper", "helpers", "common", "base", "main", "src", "the", "and",
  "for", "with", "eslint", "prettier", "test", "tests", "testing",
]);

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP_TOKENS.has(t));
}

// Never descend into these when sweeping a monorepo for nested projects.
const SWEEP_SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "out", "coverage", "target", "vendor",
  ".git", ".next", ".turbo", ".venv", ".cache", ".output", "__pycache__",
]);
// IO bound for the sweep — plenty for apps/ + packages/ layouts.
const SWEEP_MAX_DIRS = 40;

/**
 * Directories to derive signals from: the project root plus nested project
 * dirs up to two levels deep (monorepos keep the real deps in
 * `apps/backend/package.json` etc., where a root-only read sees just turbo
 * and prettier). Bounded BFS, junk dirs skipped.
 */
function signalDirs(cwd: string): string[] {
  const dirs: string[] = [cwd];
  let frontier = [cwd];
  for (let depth = 0; depth < 2 && dirs.length < SWEEP_MAX_DIRS; depth++) {
    const next: string[] = [];
    for (const dir of frontier) {
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith(".") || SWEEP_SKIP_DIRS.has(e.name)) continue;
        const sub = join(dir, e.name);
        dirs.push(sub);
        next.push(sub);
        if (dirs.length >= SWEEP_MAX_DIRS) return dirs;
      }
    }
    frontier = next;
  }
  return dirs;
}

/**
 * Derive the project's signal keywords: scanner facts (languages, frameworks,
 * tools, docker/ci) plus every package.json dependency name — from the root
 * AND nested project dirs (see signalDirs). Signals are what skill
 * ids/descriptions get matched against, so they stay specific — generic
 * tokens are stripped.
 */
export function projectSignals(cwd: string): Set<string> {
  const signals = new Set<string>();
  for (const dir of signalDirs(cwd)) {
    try {
      const info = scanProject(dir);
      for (const group of [info.languages, info.frameworks, info.tools]) {
        for (const item of group) for (const t of tokenize(item)) signals.add(t);
      }
      if (info.hasDocker) signals.add("docker");
      if (info.hasCI) signals.add("ci");
    } catch { /* unreadable dir — skip */ }
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      const deps = {
        ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies,
      } as Record<string, unknown>;
      for (const name of Object.keys(deps)) for (const t of tokenize(name)) signals.add(t);
    } catch { /* no package.json here */ }
  }
  return signals;
}

export interface ClassifyInput {
  skills: ResolvedSkill[];
  signals: ReadonlySet<string>;
  cwd: string;
  /** Frontmatter description for a skill id ("" when unknown). */
  describe: (id: string) => string;
  userKeep?: string[];
  userDefer?: string[];
}

/**
 * Deterministic full/deferred split. Pure given `describe`, so tests don't
 * need a skills tree on disk.
 */
export function classifySkills(input: ClassifyInput): { full: string[]; deferred: string[] } {
  const keep = new Set((input.userKeep ?? []).map((s) => s.toLowerCase()));
  const defer = new Set((input.userDefer ?? []).map((s) => s.toLowerCase()));
  const full: string[] = [];
  const deferred: string[] = [];

  // Word-boundary description match: a signal like "medusa" hits "the Medusa
  // admin", but "res" never hits "resources". Signals under 4 chars only
  // match id tokens exactly, not description prose.
  const descSignals = [...input.signals].filter((s) => s.length >= 4);

  for (const skill of input.skills) {
    const id = skill.id;
    const key = id.toLowerCase();
    if (keep.has(key)) { full.push(id); continue; }
    if (defer.has(key)) { deferred.push(id); continue; }
    if (skill.when) {
      (evaluateCondition(skill.when, input.cwd) ? full : deferred).push(id);
      continue;
    }
    if (ALWAYS_KEEP.has(id)) { full.push(id); continue; }
    const idTokens = tokenize(id);
    if (idTokens.some((t) => input.signals.has(t))) { full.push(id); continue; }
    const desc = input.describe(id).toLowerCase();
    if (desc && descSignals.some((s) => new RegExp(`\\b${s}\\b`).test(desc))) {
      full.push(id);
      continue;
    }
    deferred.push(id);
  }
  return { full, deferred };
}

export interface ApplyResult {
  /** Copy of the profile with local skills filtered to the full set and
   *  `deferredSkills` attached for the materializer's index skill. */
  profile: ResolvedProfile;
  full: string[];
  deferred: DeferredSkill[];
  signals: string[];
  /** True when this launch computed (or recomputed) the classification. */
  computed: boolean;
}

export interface ApplyInput {
  profile: ResolvedProfile;
  cwd: string;
  /** Directory the loadout is keyed by (the .cue.profile pin dir, else cwd). */
  pinDir: string;
  /** Resolve a skill id to its SKILL.md content ("" when unresolvable). */
  readSkill: (id: string) => Promise<{ description: string; path: string }>;
  loadoutsFile?: string;
}

/**
 * Compute-or-reuse the loadout for a project and produce the filtered profile.
 * Returns null when the loadout doesn't apply (lean profile, disabled for the
 * project, or nothing would be deferred). Throws nothing — callers still wrap
 * in try/catch to stay fail-open against filesystem surprises.
 */
export async function applyProjectLoadout(input: ApplyInput): Promise<ApplyResult | null> {
  const { profile, cwd, pinDir } = input;
  const localSkills = profile.skills.local;
  if (localSkills.length < LOADOUT_MIN_SKILLS) return null;

  const prior = readLoadout(pinDir, input.loadoutsFile);
  if (prior && prior.enabled === false) return null;

  const ids = localSkills.map((s) => s.id);
  const fingerprint = skillFingerprint(ids);
  const signals = projectSignals(cwd);
  const sigHash = signalsHash(signals);

  // Resolve descriptions once — used by classification (description match) and
  // by the deferred index rows.
  const meta = new Map<string, { description: string; path: string }>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        meta.set(id, await input.readSkill(id));
      } catch {
        meta.set(id, { description: "", path: "" });
      }
    }),
  );

  let full: string[];
  let deferredIds: string[];
  let computed = false;
  const priorValid =
    prior !== undefined &&
    prior.profile === profile.name &&
    prior.fingerprint === fingerprint &&
    prior.signalsHash === sigHash;
  if (priorValid) {
    full = prior.full;
    deferredIds = prior.deferred;
  } else {
    const result = classifySkills({
      skills: localSkills,
      signals,
      cwd,
      describe: (id) => meta.get(id)?.description ?? "",
      userKeep: prior?.userKeep,
      userDefer: prior?.userDefer,
    });
    full = result.full;
    deferredIds = result.deferred;
    computed = true;
    writeLoadout(
      pinDir,
      {
        profile: profile.name,
        fingerprint,
        signalsHash: sigHash,
        full,
        deferred: deferredIds,
        userKeep: prior?.userKeep ?? [],
        userDefer: prior?.userDefer ?? [],
        enabled: true,
        capturedAt: new Date().toISOString(),
      },
      input.loadoutsFile,
    );
  }

  if (deferredIds.length === 0) return null;

  const fullSet = new Set(full);
  const deferred: DeferredSkill[] = deferredIds.map((id) => ({
    id,
    description: meta.get(id)?.description ?? "",
    path: meta.get(id)?.path ?? "",
  }));
  const filtered: ResolvedProfile = {
    ...profile,
    skills: { ...profile.skills, local: localSkills.filter((s) => fullSet.has(s.id)) },
    deferredSkills: deferred,
  };
  return { profile: filtered, full, deferred, signals: [...signals].sort(), computed };
}
