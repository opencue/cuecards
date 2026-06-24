/**
 * Profile loader — reads `profiles/<name>/profile.yaml`, validates against the
 * draft-07 schema in `profiles/schema.json`, and resolves the `inherits`
 * chain into a fully-merged `ResolvedProfile`.
 *
 * Also supports composite selectors of the form `a+b[+c…]` — each part is
 * loaded independently (full inherits chain resolved per part) and the
 * resulting `ResolvedProfile`s are unioned together. See `foldComposite`.
 *
 * Pure-ish: the only side effects are filesystem reads under `profiles/`.
 * Never throws raw — every failure surfaces as a typed `ProfileError` subclass
 * from `profiles/_types.ts`.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { parse as parseYaml } from "yaml";

import {
  InheritanceCycle,
  InheritanceDepthExceeded,
  type MCPRef,
  type NpxSkillRef,
  type PluginRef,
  type Profile,
  ProfileError,
  ProfileNotFound,
  type ResolvedMCP,
  type ResolvedPlugin,
  type ResolvedProfile,
  type ResolvedSkill,
  type SkillRef,
  SchemaViolation,
} from "../../profiles/_types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Inheritance depth limit, inclusive. depth == number of ancestors. */
const MAX_INHERITANCE_DEPTH = 3;

/** Pattern a plugin id must match: <plugin>@<marketplace>. */
const PLUGIN_PATTERN = /^[a-z0-9][a-z0-9-]*@[a-z0-9][a-z0-9_-]*$/;

/** Resolve repo root: env override first, else walk up from this file. */
const REPO_ROOT = process.env.CUE_REPO_ROOT ?? process.env.SOUL_REPO_ROOT ?? resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const DEFAULT_PROFILES_DIR = join(REPO_ROOT, "profiles");

/**
 * Roots the loader against a profiles/ tree. Honors `CUE_PROFILES_DIR` (or
 * legacy `SOUL_PROFILES_DIR`) so tests can point at a temp directory without
 * monkey-patching. The schema file always comes from the repo's
 * `profiles/schema.json` — it is the canonical contract and does not move
 * with the data root.
 */
function profilesDir(): string {
  return process.env.CUE_PROFILES_DIR ?? process.env.SOUL_PROFILES_DIR ?? DEFAULT_PROFILES_DIR;
}

const SCHEMA_PATH = join(DEFAULT_PROFILES_DIR, "schema.json");

// ---------------------------------------------------------------------------
// Ajv validator (lazy singleton)
// ---------------------------------------------------------------------------

let _validator: ValidateFunction | null = null;

async function getValidator(): Promise<ValidateFunction> {
  if (_validator) return _validator;
  const schemaText = await readFile(SCHEMA_PATH, "utf8");
  const schema = JSON.parse(schemaText);
  const ajv = new Ajv({ allErrors: true, strict: false, useDefaults: false });
  _validator = ajv.compile(schema);
  return _validator;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the profile YAML path. Tries the main profiles dir first
 * (CUE_PROFILES_DIR or the repo's `profiles/`); if the profile isn't
 * found there, falls back to the shared root used by `cue share install`
 * — installed shared profiles live at `<sharedRoot>/<user>/<repo>/` and
 * are named `<user>-<repo>` so we map the namespaced name back to that
 * subpath. Returns the main-dir path even when nothing exists, so
 * downstream "not found" errors still point at the conventional location.
 */
function profileYamlPath(name: string): string {
  const main = join(profilesDir(), name, "profile.yaml");
  // Try the shared fallback only when the name has the namespaced shape
  // (`user-repo`, no further hyphens beyond what would parse as a single
  // user segment). We match anything containing at least one `-` so
  // multi-hyphen names like `jane-medusa-shop` still resolve.
  try {
    // Synchronous existsSync avoids async fanout in the hot path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    if (fs.existsSync(main)) return main;
    if (!name.includes("-")) return main;
    const sharedBase = process.env.XDG_CONFIG_HOME ?? join(
      process.env.HOME ?? "",
      ".config",
    );
    const sharedRoot = join(sharedBase, "cue", "shared");
    // Walk shared/<user>/<repo>/profile.yaml looking for a name match.
    if (!fs.existsSync(sharedRoot)) return main;
    for (const user of fs.readdirSync(sharedRoot)) {
      const userDir = join(sharedRoot, user);
      try {
        const stats = fs.statSync(userDir);
        if (!stats.isDirectory()) continue;
      } catch { continue; }
      for (const repo of fs.readdirSync(userDir)) {
        const candidate = join(userDir, repo, "profile.yaml");
        if (!fs.existsSync(candidate)) continue;
        // Reuse the same slugifier as shared-profiles.ts so we recognize
        // the installed namespaced name without depending on that module.
        const slug = (s: string) =>
          s.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
        if (`${slug(user)}-${slug(repo)}` === name) return candidate;
      }
    }
  } catch { /* fall through to main */ }
  return main;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Single-profile read + validate (no inheritance resolution)
// ---------------------------------------------------------------------------

async function readRawProfile(name: string): Promise<Profile> {
  const path = profileYamlPath(name);
  if (!(await pathExists(path))) {
    throw new ProfileNotFound(name);
  }

  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    // File disappeared between stat and read, or permission flip. Treat as
    // not-found rather than leaking a raw fs error.
    throw new ProfileNotFound(name);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    throw new SchemaViolation(name, [
      {
        keyword: "yaml-parse",
        message: err instanceof Error ? err.message : String(err),
      },
    ]);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SchemaViolation(name, [
      { keyword: "type", message: "profile.yaml must be a YAML mapping" },
    ]);
  }

  const rawRecord = parsed as Record<string, unknown>;

  // Guard: reject the old skills.plugins shape immediately after parsing, once,
  // before normalization or merging happens. Error is friendlier than AJV's.
  const rawSkills = rawRecord.skills;
  if (
    rawSkills !== null &&
    typeof rawSkills === "object" &&
    !Array.isArray(rawSkills) &&
    "plugins" in (rawSkills as Record<string, unknown>) &&
    (rawSkills as Record<string, unknown>).plugins !== undefined
  ) {
    throw new SchemaViolation(name, [
      {
        keyword: "deprecated-field",
        message:
          'skills.plugins has been renamed. Move plugin entries to top-level "plugins:" ' +
          'and add the @<marketplace> qualifier (e.g. "myplugin@claude-plugins-official").',
      },
    ]);
  }

  // Pre-validation: check plugin marketplace qualifier early so the error
  // message is friendlier than Ajv's pattern mismatch.
  if (Array.isArray(rawRecord.plugins)) {
    for (const ref of rawRecord.plugins as unknown[]) {
      const id = typeof ref === "string" ? ref : (typeof ref === "object" && ref !== null ? (ref as Record<string, unknown>).id : null);
      if (typeof id === "string" && !PLUGIN_PATTERN.test(id)) {
        throw new ProfileError(
          "INVALID_PLUGIN_REF",
          `Profile "${name}" has a plugin without a marketplace qualifier: "${id}". ` +
            `Plugins must use the format <plugin>@<marketplace> (e.g. "${id}@claude-plugins-official").`,
        );
      }
    }
  }

  const validate = await getValidator();
  if (!validate(parsed)) {
    throw new SchemaViolation(
      name,
      (validate.errors ?? []) as ErrorObject[],
    );
  }

  const profile = parsed as Profile;

  // Lint rule E1 (per SCHEMA.md): directory name must equal the `name:` field.
  if (profile.name !== name) {
    throw new SchemaViolation(name, [
      {
        keyword: "name-mismatch",
        message: `Profile dir "${name}" does not match name field "${profile.name}"`,
      },
    ]);
  }

  return profile;
}

// ---------------------------------------------------------------------------
// Normalization helpers — convert raw YAML refs to canonical object form
// ---------------------------------------------------------------------------

/**
 * Normalize a raw MCPRef (string or {id, agents?, when?}) to ResolvedMCP form.
 * Strings become `{ id: string }` with no agents/when keys.
 */
function normalizeMCPRef(raw: MCPRef): ResolvedMCP {
  if (typeof raw === "string") return { id: raw };
  const result: ResolvedMCP = { id: raw.id };
  if (raw.agents) result.agents = raw.agents;
  if (raw.when) result.when = raw.when;
  return result;
}

/**
 * Normalize a raw SkillRef (string or {id, agents?, when?}) to ResolvedSkill form.
 */
function normalizeSkillRef(raw: SkillRef): ResolvedSkill {
  if (typeof raw === "string") return { id: raw };
  const result: ResolvedSkill = { id: raw.id };
  if (raw.agents) result.agents = raw.agents;
  if (raw.when) result.when = raw.when;
  return result;
}

/**
 * Normalize a raw PluginRef (string or {id, agents?}) to ResolvedPlugin form.
 */
function normalizePluginRef(raw: PluginRef): ResolvedPlugin {
  if (typeof raw === "string") return { id: raw };
  return raw.agents ? { id: raw.id, agents: raw.agents } : { id: raw.id };
}

// ---------------------------------------------------------------------------
// Deep-merge helpers
// ---------------------------------------------------------------------------

/** Concat then dedupe primitives, preserving order (parent first, child last). */
function dedupePrimitiveArray<T extends string>(
  parent: T[] | undefined,
  child: T[] | undefined,
): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of [...(parent ?? []), ...(child ?? [])]) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/**
 * Merge arrays of id-bearing objects — dedup by `id`, child wins on collision.
 * Parent entries appear first (Map insertion order); child entries that share an
 * id overwrite the parent value in place; new child-only ids are appended.
 */
function mergeObjectRefs<T extends { id: string }>(
  parent: T[] | undefined,
  child: T[] | undefined,
): T[] {
  const byId = new Map<string, T>();
  for (const ref of parent ?? []) byId.set(ref.id, ref);
  for (const ref of child ?? []) byId.set(ref.id, ref);
  return [...byId.values()];
}

/**
 * Merge NpxSkillRef arrays. Identity = `repo`. When parent and child both have
 * the same repo, the child entry wins entirely (its pin + skills replace the
 * parent's). Per SCHEMA.md the merge rule for arrays is "concat + dedupe by
 * identity"; for NpxSkillRef the per-repo override is the most useful reading
 * because pin changes are the whole point of overriding.
 */
function mergeNpxRefs(
  parent: NpxSkillRef[] | undefined,
  child: NpxSkillRef[] | undefined,
): NpxSkillRef[] {
  const byRepo = new Map<string, NpxSkillRef>();
  for (const ref of parent ?? []) byRepo.set(ref.repo, ref);
  for (const ref of child ?? []) byRepo.set(ref.repo, ref);
  return [...byRepo.values()];
}

interface ProfileSkillsResolved {
  local: ResolvedSkill[];
  npx: NpxSkillRef[];
}

function mergeSkills(
  parent: ResolvedProfile["skills"] | undefined,
  child: Profile["skills"],
): ProfileSkillsResolved {
  const childLocal = child?.local?.map(normalizeSkillRef);
  return {
    local: mergeObjectRefs<ResolvedSkill>(parent?.local, childLocal),
    npx: mergeNpxRefs(parent?.npx, child?.npx),
  };
}

function mergeEnv(
  parent: Profile["env"],
  child: Profile["env"],
): Record<string, string> {
  return { ...(parent ?? {}), ...(child ?? {}) };
}

const DEFAULT_AGENTS: ResolvedProfile["agents"] = ["claude-code", "codex"];

// ---------------------------------------------------------------------------
// Inheritance resolution
// ---------------------------------------------------------------------------

/**
 * Walk the `inherits` chain root-first. Returns `[oldestAncestor, ..., self]`.
 * Detects cycles and enforces a max depth (parent count) of 3.
 *
 * Supports both single-parent (`inherits: "core"`) and multi-parent
 * (`inherits: ["core", "rust-core"]`). Multi-parent profiles resolve each
 * parent's full chain independently, then fold them left-to-right before
 * appending the child. Merge semantics: skills/MCPs/hooks/rules/commands are
 * unioned (deduped), persona is last-wins (last parent's persona wins, child
 * overrides all).
 */
async function buildInheritanceChain(name: string): Promise<Profile[]> {
  const chainNames: string[] = [];
  const chain: Profile[] = [];
  let current: string | undefined = name;

  while (current) {
    if (chainNames.includes(current)) {
      throw new InheritanceCycle([...chainNames, current]);
    }
    chainNames.push(current);

    const profile = await readRawProfile(current);
    chain.push(profile);

    // Multi-inherit: if inherits is an array, resolve each parent and flatten
    const inherits = profile.inherits;
    if (Array.isArray(inherits)) {
      // Resolve each parent chain independently, fold them, then prepend
      const parentChains: Profile[][] = [];
      for (const parentName of inherits) {
        if (chainNames.includes(parentName)) {
          throw new InheritanceCycle([...chainNames, parentName]);
        }
        const parentChain = await buildInheritanceChain(parentName);
        parentChains.push(parentChain);
      }
      // Flatten: all parent chains concatenated (dedup happens in foldChain via merge helpers)
      const allParents: Profile[] = [];
      const seen = new Set<string>();
      for (const pc of parentChains) {
        for (const p of pc) {
          if (!seen.has(p.name)) {
            seen.add(p.name);
            allParents.push(p);
          }
        }
      }
      // Total chain: parents (in order) + self
      const totalChain = [...allParents, profile];
      if (totalChain.length - 1 > MAX_INHERITANCE_DEPTH + 2) {
        throw new InheritanceDepthExceeded(totalChain.map(p => p.name));
      }
      return totalChain;
    }

    current = typeof inherits === "string" ? inherits : undefined;
  }

  // chainNames is [child, parent, grandparent, ...]; parents = total - 1.
  if (chainNames.length - 1 > MAX_INHERITANCE_DEPTH) {
    throw new InheritanceDepthExceeded(chainNames);
  }

  // Reverse so the oldest ancestor is first and the leaf is last.
  return chain.reverse();
}

/** Fold the chain root-first into a resolved profile. */
function foldChain(chain: Profile[]): ResolvedProfile {
  if (chain.length === 0) {
    // Defensive — buildInheritanceChain always returns >=1 entry.
    throw new ProfileError(
      "EMPTY_CHAIN",
      "Inheritance chain unexpectedly empty",
    );
  }

  // Start from the root ancestor.
  let acc: ResolvedProfile = normalizeToResolved(chain[0]!, [chain[0]!.name]);

  for (let i = 1; i < chain.length; i++) {
    const child = chain[i]!;
    acc = {
      // Identity comes from the leaf.
      name: child.name,
      description: child.description,
      icon: child.icon ?? acc.icon,
      iconImage: child.iconImage ?? acc.iconImage,
      // Budget hints are leaf-wins: a child that declares its own model /
      // context window overrides the parent; otherwise it inherits.
      model: child.model ?? acc.model,
      contextWindow: child.contextWindow ?? acc.contextWindow,
      // agents: arrays merge by dedupe; if neither parent nor child declares
      // agents we fall back to the default at the end.
      agents: dedupePrimitiveArray(
        acc.agents,
        child.agents,
      ) as ResolvedProfile["agents"],
      // inherits is a leaf-level field; we drop it from the resolved view
      // because the chain is already flattened. But we surface it on the leaf
      // so callers can see the immediate parent if they want.
      inherits: child.inherits,
      skills: mergeSkills(acc.skills, child.skills),
      mcps: mergeObjectRefs<ResolvedMCP>(
        acc.mcps,
        child.mcps?.map(normalizeMCPRef),
      ),
      plugins: mergeObjectRefs<ResolvedPlugin>(
        acc.plugins,
        child.plugins?.map(normalizePluginRef),
      ),
      env: mergeEnv(acc.env, child.env),
      rules: dedupePrimitiveArray(acc.rules, child.rules),
      commands: dedupePrimitiveArray(acc.commands, child.commands),
      hooks: dedupePrimitiveArray(acc.hooks, child.hooks),
      subagents: dedupePrimitiveArray(acc.subagents, child.subagents),
      // Persona is leaf-wins (child overrides parent fully). Concatenating
      // would produce awkward "you are X. ALSO you are Y" priming.
      persona: child.persona ?? acc.persona,
      // persona_includes IS additive (concat+dedupe). Lets cross-profile
      // policy snippets (Integrity Protocol, voice rules) fan out via core
      // without forcing children to give up their own persona block.
      personaIncludes: dedupePrimitiveArray(acc.personaIncludes, child.persona_includes),
      playbooks: dedupePrimitiveArray(acc.playbooks, child.playbooks),
      qualityGates: dedupePrimitiveArray(acc.qualityGates, child.qualityGates),
      evals: dedupePrimitiveArray(acc.evals, child.evals),
      recommends: dedupePrimitiveArray(acc.recommends, child.recommends),
      autoSelect: dedupePrimitiveArray(acc.autoSelect, child.autoSelect),
      conflicts: dedupePrimitiveArray(acc.conflicts, child.conflicts),
      // bundles is a display hint, leaf-wins: a child that declares its own
      // list overrides the parent; a child that omits it inherits the parent's.
      bundles: child.bundles && child.bundles.length > 0 ? [...child.bundles] : acc.bundles,
      personaRouting: [...acc.personaRouting, ...(child.persona_routing ?? [])],
      inheritanceChain: [...acc.inheritanceChain, child.name],
    };
  }

  // If neither parent nor child declared `agents`, apply the schema default.
  if (acc.agents.length === 0) {
    acc = { ...acc, agents: [...DEFAULT_AGENTS] };
  }

  return acc;
}

/** Promote a raw `Profile` into a `ResolvedProfile` with all defaults applied. */
function normalizeToResolved(p: Profile, chain: string[]): ResolvedProfile {
  return {
    name: p.name,
    description: p.description,
    icon: p.icon,
    iconImage: p.iconImage,
    model: p.model,
    contextWindow: p.contextWindow,
    agents: p.agents && p.agents.length > 0 ? [...p.agents] : [],
    inherits: p.inherits,
    skills: {
      local: (p.skills?.local ?? []).map(normalizeSkillRef),
      npx: [...(p.skills?.npx ?? [])],
    },
    mcps: (p.mcps ?? []).map(normalizeMCPRef),
    plugins: (p.plugins ?? []).map(normalizePluginRef),
    env: { ...(p.env ?? {}) },
    rules: [...(p.rules ?? [])],
    commands: [...(p.commands ?? [])],
    hooks: [...(p.hooks ?? [])],
    subagents: [...(p.subagents ?? [])],
    persona: p.persona ?? "",
    personaIncludes: [...(p.persona_includes ?? [])],
    playbooks: [...(p.playbooks ?? [])],
    qualityGates: [...(p.qualityGates ?? [])],
    evals: [...(p.evals ?? [])],
    recommends: [...(p.recommends ?? [])],
    autoSelect: [...(p.autoSelect ?? [])],
    conflicts: [...(p.conflicts ?? [])],
    bundles: p.bundles && p.bundles.length > 0 ? [...p.bundles] : undefined,
    personaRouting: [...(p.persona_routing ?? [])],
    inheritanceChain: chain,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a profile selector into its component profile names.
 *
 * Plain names pass through as a single-element array. Composite selectors
 * use `+` as separator (e.g. `"postizz+trendradar"`). Whitespace around each
 * part is trimmed and empty parts are rejected.
 */
export function parseProfileSelector(selector: string): string[] {
  const parts = selector.split("+").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new ProfileError(
      "INVALID_SELECTOR",
      `Profile selector "${selector}" is empty after parsing`,
    );
  }
  // Collapse duplicate parts, order preserved. A selector can accumulate
  // repeats — a stale pin, a Recent/Featured row built from an already-duped
  // selector, or a composite primary whose part is also offered as a companion.
  // Loading the same profile twice bloats the materialized CLAUDE.md and the
  // token count for no benefit (skills/mcps fold to a set anyway).
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of parts) {
    if (seen.has(part)) continue;
    seen.add(part);
    unique.push(part);
  }
  return unique;
}

/** True when the selector names two or more profiles to merge. */
export function isCompositeSelector(selector: string): boolean {
  return selector.includes("+") && parseProfileSelector(selector).length > 1;
}

/**
 * Fold an ordered list of already-resolved profiles into one composite
 * `ResolvedProfile`.
 *
 * Merge rules (left-first, right-last semantics):
 *   - `name`: synthesized from the selector (`"a+b"`)
 *   - `description`: joined with " + "
 *   - `icon`/`iconImage`: first non-empty wins
 *   - `agents`: union with dedupe
 *   - `inherits`: dropped (each component is already flattened)
 *   - `skills`/`mcps`/`plugins`: union by id, later wins on collision
 *   - `env`: shallow merge, later wins on collision
 *   - `rules`/`commands`/`hooks`/`playbooks`/`qualityGates`/`evals`: dedupe-concat
 *   - `persona`: concatenated with `## <profile name>` headers so both
 *     personas stay legible. Empty personas are skipped.
 *   - `inheritanceChain`: each part's chain joined with `+`
 */
function foldComposite(selector: string, parts: ResolvedProfile[]): ResolvedProfile {
  if (parts.length === 0) {
    throw new ProfileError("EMPTY_COMPOSITE", `Composite selector "${selector}" resolved to zero profiles`);
  }
  if (parts.length === 1) return parts[0]!;

  const head = parts[0]!;
  let acc: ResolvedProfile = {
    name: selector,
    description: parts.map((p) => p.description).join(" + "),
    icon: parts.find((p) => p.icon)?.icon,
    iconImage: parts.find((p) => p.iconImage)?.iconImage,
    // First part that declares a budget hint wins for the composite.
    model: parts.find((p) => p.model)?.model,
    contextWindow: parts.find((p) => p.contextWindow)?.contextWindow,
    agents: [...head.agents] as ResolvedProfile["agents"],
    inherits: undefined,
    skills: { local: [...head.skills.local], npx: [...head.skills.npx] },
    mcps: [...head.mcps],
    plugins: [...head.plugins],
    env: { ...head.env },
    rules: [...head.rules],
    commands: [...head.commands],
    hooks: [...head.hooks],
    subagents: [...head.subagents],
    persona: head.persona && head.persona.trim().length > 0
      ? `## ${head.name}\n\n${head.persona.trim()}`
      : "",
    playbooks: [...head.playbooks],
    qualityGates: [...head.qualityGates],
    evals: [...head.evals],
    recommends: [...head.recommends],
    autoSelect: [...head.autoSelect],
    conflicts: [...head.conflicts],
    // persona_includes is additive across a composite too — policy snippets
    // (Integrity Protocol, voice rules) from every stacked profile survive.
    personaIncludes: [...head.personaIncludes],
    personaRouting: [...head.personaRouting],
    inheritanceChain: [head.inheritanceChain.join("+")],
  };

  for (let i = 1; i < parts.length; i++) {
    const next = parts[i]!;
    const nextPersona = next.persona && next.persona.trim().length > 0
      ? `## ${next.name}\n\n${next.persona.trim()}`
      : "";
    acc = {
      name: selector,
      description: acc.description,
      icon: acc.icon ?? next.icon,
      iconImage: acc.iconImage ?? next.iconImage,
      model: acc.model ?? next.model,
      contextWindow: acc.contextWindow ?? next.contextWindow,
      agents: dedupePrimitiveArray(acc.agents, next.agents) as ResolvedProfile["agents"],
      inherits: undefined,
      skills: {
        local: mergeObjectRefs<ResolvedSkill>(acc.skills.local, next.skills.local),
        npx: mergeNpxRefs(acc.skills.npx, next.skills.npx),
      },
      mcps: mergeObjectRefs<ResolvedMCP>(acc.mcps, next.mcps),
      plugins: mergeObjectRefs<ResolvedPlugin>(acc.plugins, next.plugins),
      env: mergeEnv(acc.env, next.env),
      rules: dedupePrimitiveArray(acc.rules, next.rules),
      commands: dedupePrimitiveArray(acc.commands, next.commands),
      hooks: dedupePrimitiveArray(acc.hooks, next.hooks),
      subagents: dedupePrimitiveArray(acc.subagents, next.subagents),
      persona: [acc.persona, nextPersona].filter((s) => s.length > 0).join("\n\n"),
      playbooks: dedupePrimitiveArray(acc.playbooks, next.playbooks),
      qualityGates: dedupePrimitiveArray(acc.qualityGates, next.qualityGates),
      evals: dedupePrimitiveArray(acc.evals, next.evals),
      recommends: dedupePrimitiveArray(acc.recommends, next.recommends),
      autoSelect: dedupePrimitiveArray(acc.autoSelect, next.autoSelect),
      conflicts: dedupePrimitiveArray(acc.conflicts, next.conflicts),
      personaIncludes: dedupePrimitiveArray(acc.personaIncludes, next.personaIncludes),
      personaRouting: [...acc.personaRouting, ...next.personaRouting],
      inheritanceChain: [...acc.inheritanceChain, next.inheritanceChain.join("+")],
    };
  }

  if (acc.agents.length === 0) {
    acc = { ...acc, agents: [...DEFAULT_AGENTS] };
  }
  return acc;
}

/**
 * Load and fully resolve a profile by name. Reads
 * `profiles/<name>/profile.yaml`, validates it, then recursively merges in any
 * ancestor profiles declared via `inherits`.
 *
 * Accepts composite selectors of the form `a+b[+c…]` — each part is loaded
 * independently and the results are unioned via {@link foldComposite}.
 *
 * @throws ProfileNotFound      if any component profile is missing
 * @throws SchemaViolation      if YAML is malformed or fails schema validation
 * @throws InheritanceCycle     if any component's `inherits` chain loops
 * @throws InheritanceDepthExceeded if any chain has more than 3 ancestors
 */
export async function loadProfile(name: string): Promise<ResolvedProfile> {
  const parts = parseProfileSelector(name);
  if (parts.length === 1) {
    const chain = await buildInheritanceChain(parts[0]!);
    return foldChain(chain);
  }
  const resolved: ResolvedProfile[] = [];
  for (const part of parts) {
    const chain = await buildInheritanceChain(part);
    resolved.push(foldChain(chain));
  }
  // Name the composite from the deduped parts, not the raw selector: a duped
  // selector ("a+b+a") loads correct (once-each) resources but must not name
  // a redundant runtime dir / CLAUDE.md path — that splits the materializer
  // cache and resurrects the duplicated-profile display bug downstream.
  return foldComposite(parts.join("+"), resolved);
}

/**
 * List every profile under `profiles/` that contains a `profile.yaml`, sorted
 * alphabetically. Directory entries beginning with `_` (e.g. `_active`,
 * `_cache`, `_examples`) are skipped — those are reserved system folders.
 */
export async function listProfiles(): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(profilesDir(), { withFileTypes: true });
  } catch {
    entries = [];
  }

  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    if (await pathExists(profileYamlPath(entry.name))) {
      names.push(entry.name);
    }
  }

  // Also surface profiles installed via `cue share install` so the picker,
  // `cue list`, etc. see them alongside builtins. Namespaced as
  // `<user>-<repo>` to dodge collisions with the builtins above.
  const sharedBase = process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config");
  const sharedRoot = join(sharedBase, "cue", "shared");
  try {
    const users = await readdir(sharedRoot, { withFileTypes: true });
    const slug = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    for (const userEntry of users) {
      if (!userEntry.isDirectory()) continue;
      const userDir = join(sharedRoot, userEntry.name);
      const repos = await readdir(userDir, { withFileTypes: true });
      for (const repoEntry of repos) {
        if (!repoEntry.isDirectory()) continue;
        const yamlPath = join(userDir, repoEntry.name, "profile.yaml");
        if (!(await pathExists(yamlPath))) continue;
        const namespaced = `${slug(userEntry.name)}-${slug(repoEntry.name)}`;
        if (!names.includes(namespaced)) names.push(namespaced);
      }
    }
  } catch { /* shared dir missing — fine */ }

  names.sort();
  return names;
}

/**
 * Read the optional `profiles/_featured.yaml` config and return the ordered
 * list of featured profile slugs. Slugs not present in `listProfiles()` are
 * silently filtered out by the caller.
 */
export async function listFeaturedProfiles(): Promise<string[]> {
  const path = join(profilesDir(), "_featured.yaml");
  if (!(await pathExists(path))) return [];
  try {
    const raw = await readFile(path, "utf8");
    const parsed = parseYaml(raw) as { featured?: unknown } | null | undefined;
    const list = parsed?.featured;
    if (!Array.isArray(list)) return [];
    return list.filter((s): s is string => typeof s === "string" && s.length > 0);
  } catch {
    return [];
  }
}
