/**
 * Marketplace install — wire a `/market` item into a real profile.yaml.
 *
 * The studio's Market page lists everything addable to a profile (skills, MCPs,
 * plugins, companion profiles, workflows). This module is what makes the
 * "Install → Add to profile" picker actually *do* something: it edits the
 * target `profiles/<name>/profile.yaml` in place, idempotently, so the item
 * shows up in the profile (and the dashboard's counts) on the next resolve.
 *
 * It deliberately mirrors `addMcpToProfile` in mcp-catalog.ts — same profile
 * validation, same path-traversal guard, same line-based YAML editing (we keep
 * the file human-authored, so we splice list items rather than round-tripping
 * through a YAML serializer that would reflow comments and quoting).
 *
 * Paths resolve per-call from env so tests can point CUE_PROFILES_DIR at a
 * fixture tree without writing to the real `profiles/`.
 */

import { readFile, writeFile, access } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { addMcpToProfile } from "./mcp-catalog";

function repoRoot(): string {
  return (
    process.env.CUE_REPO_ROOT ??
    process.env.SOUL_REPO_ROOT ??
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
  );
}
function profilesDir(): string {
  return process.env.CUE_PROFILES_DIR ?? join(repoRoot(), "profiles");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The kinds the studio's Market page can route to "Add to profile". */
export type MarketAddKind = "mcp" | "skill" | "profile" | "cli" | "workflow" | "plugin";

export interface MarketInstallInput {
  /** The MarketItem id, e.g. "skill:foo", "mcp:github", "profile:backend". */
  id: string;
  /** Which install path to take. */
  addKind: MarketAddKind;
  /** Target physical profile (a `profiles/<name>/` directory). */
  profile: string;
  /** The item's copy-paste install command — used to recover a skill's repo. */
  add?: string;
}

export interface MarketInstallResult {
  id: string;
  profile: string;
  addKind: MarketAddKind;
  /** True when the profile.yaml was edited (false when already present). */
  changed: boolean;
  /** True when the item was already wired into the profile. */
  alreadyPresent: boolean;
  /** Human-readable summary of what happened. */
  detail: string;
  /**
   * Set for kinds that can't be wired into a profile.yaml (a bare CLI tool).
   * The studio shows the command for the user to run instead.
   */
  manual?: { command: string };
}

/** Resolve + validate a physical profile.yaml path, guarding traversal. */
async function profileYamlPath(profile: string): Promise<string> {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(profile)) {
    throw new Error(`invalid-profile: "${profile}"`);
  }
  const dir = profilesDir();
  const yamlPath = join(dir, profile, "profile.yaml");
  if (!resolve(yamlPath).startsWith(resolve(dir))) {
    throw new Error(`invalid-profile: "${profile}"`);
  }
  try {
    await access(yamlPath);
  } catch {
    throw new Error(
      `not-a-physical-profile: "${profile}" has no profile.yaml (composite profiles can't be written directly)`,
    );
  }
  return yamlPath;
}

/**
 * Add `item` to a top-level YAML list `key` (e.g. plugins, playbooks, inherits).
 * Handles all three on-disk shapes:
 *   - key absent          → append `key:\n  - item`
 *   - key is a scalar     → expand to a list keeping the existing value
 *   - key is a block list → splice in after the last existing entry
 * Idempotent: a no-op when `item` is already present under the key.
 */
function addToplevelListItem(content: string, key: string, item: string): { content: string; alreadyPresent: boolean } {
  const lines = content.split("\n");
  const keyIdx = lines.findIndex((l) => new RegExp(`^${escapeRe(key)}:`).test(l));

  if (keyIdx === -1) {
    return { content: content.trimEnd() + `\n${key}:\n  - ${item}\n`, alreadyPresent: false };
  }

  // Scalar form: `key: value` (anything non-empty, non-comment after the colon).
  const scalar = lines[keyIdx]!.match(new RegExp(`^${escapeRe(key)}:\\s*(\\S[^#]*?)\\s*(#.*)?$`));
  if (scalar?.[1]) {
    const existing = scalar[1].replace(/^["']|["']$/g, "");
    if (existing === item) return { content, alreadyPresent: true };
    lines.splice(keyIdx, 1, `${key}:`, `  - ${existing}`, `  - ${item}`);
    return { content: lines.join("\n"), alreadyPresent: false };
  }

  // Block list: scan the contiguous `  - ...` entries under the key.
  let insertIdx = keyIdx + 1;
  while (insertIdx < lines.length && /^\s+-\s/.test(lines[insertIdx] ?? "")) {
    if (new RegExp(`^\\s*-\\s+${escapeRe(item)}\\s*(#.*)?$`).test(lines[insertIdx]!)) {
      return { content, alreadyPresent: true };
    }
    insertIdx++;
  }
  lines.splice(insertIdx, 0, `  - ${item}`);
  return { content: lines.join("\n"), alreadyPresent: false };
}

/**
 * Add an npx skill entry (`{ repo, skills: [name] }`) under `skills.npx:`.
 * Creates the `skills:` / `npx:` scaffold when absent. Idempotent on `repo`.
 */
function addSkillNpx(content: string, repo: string, skillName: string): { content: string; alreadyPresent: boolean } {
  const lines = content.split("\n");
  if (lines.some((l) => new RegExp(`^\\s*-\\s+repo:\\s+${escapeRe(repo)}\\s*(#.*)?$`).test(l))) {
    return { content, alreadyPresent: true };
  }

  const entry = [`    - repo: ${repo}`, `      skills: [${skillName}]`];
  const skillsIdx = lines.findIndex((l) => /^skills:/.test(l));
  if (skillsIdx === -1) {
    return { content: content.trimEnd() + `\nskills:\n  npx:\n${entry.join("\n")}\n`, alreadyPresent: false };
  }

  // Find `  npx:` inside the skills block (stop at the next top-level key).
  let npxIdx = -1;
  for (let i = skillsIdx + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i] ?? "")) break;
    if (/^\s{2}npx:/.test(lines[i] ?? "")) { npxIdx = i; break; }
  }
  if (npxIdx === -1) {
    lines.splice(skillsIdx + 1, 0, "  npx:", ...entry);
    return { content: lines.join("\n"), alreadyPresent: false };
  }
  // Insert after the existing npx children (indented 4+).
  let insertIdx = npxIdx + 1;
  while (insertIdx < lines.length && /^\s{4,}\S/.test(lines[insertIdx] ?? "")) insertIdx++;
  lines.splice(insertIdx, 0, ...entry);
  return { content: lines.join("\n"), alreadyPresent: false };
}

/** "cue marketplace install-skill owner/repo" → "owner/repo" (best effort). */
function repoFromAddCommand(add: string | undefined): string | null {
  if (!add) return null;
  const m = add.match(/install-skill\s+(\S+)/);
  return m?.[1] ?? null;
}

/**
 * Install a marketplace item into a profile by editing its profile.yaml.
 *
 * Returns `manual` (rather than throwing) for a bare CLI, which has no
 * profile.yaml home — the studio surfaces the command for the user to run.
 */
export async function installMarketItem(input: MarketInstallInput): Promise<MarketInstallResult> {
  const { addKind, profile } = input;
  const ref = input.id.includes(":") ? input.id.slice(input.id.indexOf(":") + 1) : input.id;

  // MCPs already have a dedicated, validated writer — reuse it verbatim.
  if (addKind === "mcp") {
    const r = await addMcpToProfile(ref, profile);
    return {
      id: input.id, profile, addKind,
      changed: !r.alreadyPresent, alreadyPresent: r.alreadyPresent,
      detail: r.alreadyPresent ? `${ref} already in ${profile}` : `added mcp ${ref} to ${profile}`,
    };
  }

  // A bare CLI tool isn't a profile member — hand back the install command.
  if (addKind === "cli") {
    return {
      id: input.id, profile, addKind,
      changed: false, alreadyPresent: false,
      detail: `${ref} is a CLI tool — run its install command`,
      manual: { command: input.add && input.add !== "(see recipe)" ? input.add : `cue cli install ${ref}` },
    };
  }

  const yamlPath = await profileYamlPath(profile);
  const before = await readFile(yamlPath, "utf8");

  let edited: { content: string; alreadyPresent: boolean };
  let label: string;
  switch (addKind) {
    case "skill": {
      const repo = repoFromAddCommand(input.add);
      if (!repo) {
        return {
          id: input.id, profile, addKind, changed: false, alreadyPresent: false,
          detail: `couldn't resolve a repo for ${ref}`,
          manual: { command: input.add ?? `cue marketplace install-skill ${ref}` },
        };
      }
      edited = addSkillNpx(before, repo, ref);
      label = `skill ${ref}`;
      break;
    }
    case "plugin":
      edited = addToplevelListItem(before, "plugins", ref);
      label = `plugin ${ref}`;
      break;
    case "profile":
      if (ref === profile) {
        return {
          id: input.id, profile, addKind, changed: false, alreadyPresent: true,
          detail: `${profile} can't inherit itself`,
        };
      }
      edited = addToplevelListItem(before, "inherits", ref);
      label = `profile ${ref} (inherited)`;
      break;
    case "workflow":
      edited = addToplevelListItem(before, "playbooks", ref);
      label = `workflow ${ref}`;
      break;
    default:
      throw new Error(`unknown-add-kind: "${addKind}"`);
  }

  if (!edited.alreadyPresent && edited.content !== before) {
    await writeFile(yamlPath, edited.content);
  }
  return {
    id: input.id, profile, addKind,
    changed: !edited.alreadyPresent, alreadyPresent: edited.alreadyPresent,
    detail: edited.alreadyPresent ? `${label} already in ${profile}` : `added ${label} to ${profile}`,
  };
}
