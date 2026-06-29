/**
 * Profile merge engine — combine several existing profiles into one fat
 * profile, then optimize and render it.
 *
 * Wiring, not new algorithms: the union math is `loadProfile("a+b+c")` (which
 * runs the loader's `foldComposite` internally), conflicts come from
 * {@link detectConflicts}, usage from {@link scoreSkills}. This module adds the
 * preview shape, the four optimize actions, and the two render modes the Merge
 * Studio + `cue merge` need.
 *
 *   static mode → flattened fat `profile.yaml` (`inherits: core` + inlined skills)
 *   alias  mode → thin `profile.yaml` (`inherits: [a, b, c]`, auto-syncs)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { join } from "node:path";

import { loadProfile } from "./profile-loader";
import { detectConflicts, suggestResolutions, type Conflict, type Resolution } from "./conflict-detector";
import { scoreSkills } from "./skill-scorer";
import { profilesDir } from "./repo-root";
import type { NpxSkillRef } from "../../profiles/_types";

// Rough token cost per skill / MCP, used only for the size indicator in the
// preview. Not a real tokenizer — a knob to flag "this profile loads a lot".
const TOKENS_PER_SKILL = 1200;
const TOKENS_PER_MCP = 150;
const DEFAULT_BUDGET = 60;

// Skills that prune/budget must never drop, regardless of usage (commit prep,
// skill discovery — they bootstrap the rest). Matched by slug suffix.
const ALWAYS_KEEP_SLUGS = new Set([
  "caveman-commit", "find-skills", "smart-loader", "help",
]);

export type OptimizeAction = "prune" | "dedupe" | "budget" | "router";

export interface MergeOptions {
  /** Target profile name (defaults to the joined selector). */
  name?: string;
  /** Optional human description; otherwise synthesized from sources. */
  description?: string;
  /** Optimize actions to apply, in order. */
  optimize?: OptimizeAction[];
  /** Max skills kept when `budget` runs. */
  budget?: number;
  /** Session window for usage scoring. */
  sessionLimit?: number;
}

/** A profile-level mutual-exclusion between two selected sources. */
export interface ProfilePair { a: string; b: string; }

/** Per-skill usage snapshot carried into prune/budget. */
export interface SkillUsageRow { id: string; references: number; lastSeen: string | null; }

export interface MergePreview {
  /** Source profile names being merged. */
  names: string[];
  /** Target profile name. */
  name: string;
  icon: string;
  description: string;
  /** Non-core skill ids that will be inlined in static mode (post-optimize). */
  skills: string[];
  /** Skills dropped by prune/budget, with the reason. */
  dropped: { id: string; reason: "prune" | "budget" }[];
  npx: NpxSkillRef[];
  mcps: string[];
  plugins: string[];
  env: Record<string, string>;
  rules: string[];
  commands: string[];
  hooks: string[];
  persona: string;
  /** Selected sources declared mutually exclusive (the `conflicts:` field). */
  profileConflicts: ProfilePair[];
  /** Skill-directive contradictions across the merged set. */
  skillConflicts: Conflict[];
  /** Suggested resolution per skill conflict. */
  resolutions: Resolution[];
  usage: SkillUsageRow[];
  estTokens: number;
  appliedOptimizations: OptimizeAction[];
}

/** Sort + de-dupe a string list, stable. */
function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

/** Collapse conflicts to one row per unordered skill pair. */
function dedupeConflicts(conflicts: Conflict[]): Conflict[] {
  const seen = new Set<string>();
  const out: Conflict[] = [];
  for (const c of conflicts) {
    const [a, b] = [c.skillA, c.skillB].sort();
    const key = `${a}|${b}|${c.domain}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Merge N profiles into a preview. Loads each source plus the merged composite
 * (`a+b+c`, folded by the loader) and `core` (to subtract baseline skills that
 * the static output inherits rather than inlines).
 */
export async function mergeProfiles(names: string[], opts: MergeOptions = {}): Promise<MergePreview> {
  const cleaned = uniq(names.map((n) => n.trim()).filter(Boolean));
  if (cleaned.length === 0) {
    throw new Error("mergeProfiles: no source profiles given");
  }

  const selector = cleaned.join("+");
  const [merged, core, ...sources] = await Promise.all([
    loadProfile(selector),
    loadProfile("core"),
    ...cleaned.map((n) => loadProfile(n)),
  ]);

  const coreIds = new Set(core.skills.local.map((s) => s.id));
  const allSkillIds = merged.skills.local.map((s) => s.id);
  const nonCore = allSkillIds.filter((id) => !coreIds.has(id));

  // Profile-level conflicts: a selected source that lists another selected
  // source in its `conflicts:`. Symmetric — dedupe the unordered pair.
  const selected = new Set(cleaned);
  const pairKeys = new Set<string>();
  const profileConflicts: ProfilePair[] = [];
  for (const src of sources) {
    for (const other of src.conflicts) {
      if (other === src.name || !selected.has(other)) continue;
      const [a, b] = [src.name, other].sort() as [string, string];
      const key = `${a}|${b}`;
      if (pairKeys.has(key)) continue;
      pairKeys.add(key);
      profileConflicts.push({ a, b });
    }
  }

  // detectConflicts emits one row per opposing directive *pair*, so the same
  // two skills can appear dozens of times. Collapse to unique unordered skill
  // pairs (keep the first directive example) — that's what's actionable.
  const skillConflicts = dedupeConflicts(detectConflicts(nonCore));
  const resolutions = suggestResolutions(skillConflicts);
  const usageRaw = scoreSkills(nonCore, opts.sessionLimit ?? 20);
  const usage: SkillUsageRow[] = usageRaw.map((u) => ({ id: u.id, references: u.references, lastSeen: u.lastSeen }));

  const name = opts.name ?? selector;
  const description =
    opts.description ??
    `Merged loadout — ${cleaned.join(" + ")} (${nonCore.length} skills, ${merged.mcps.length} MCPs)`.slice(0, 199);

  const preview: MergePreview = {
    names: cleaned,
    name,
    icon: merged.icon ?? sources.find((s) => s.icon)?.icon ?? "🧩",
    description,
    skills: nonCore,
    dropped: [],
    npx: merged.skills.npx,
    mcps: merged.mcps.map((m) => m.id),
    plugins: merged.plugins.map((p) => p.id),
    env: merged.env,
    rules: merged.rules.filter((r) => !core.rules.includes(r)),
    commands: merged.commands.filter((c) => !core.commands.includes(c)),
    hooks: merged.hooks.filter((h) => !core.hooks.includes(h)),
    persona: merged.persona,
    profileConflicts,
    skillConflicts,
    resolutions,
    usage,
    estTokens: nonCore.length * TOKENS_PER_SKILL + merged.mcps.length * TOKENS_PER_MCP,
    appliedOptimizations: [],
  };

  if (opts.optimize && opts.optimize.length > 0) {
    return optimizeMerge(preview, opts.optimize, { budget: opts.budget });
  }
  return preview;
}

function slugOf(id: string): string {
  return id.split("/").pop() ?? id;
}

function isAlwaysKeep(id: string): boolean {
  return ALWAYS_KEEP_SLUGS.has(slugOf(id));
}

/**
 * Apply optimize actions to a preview, in the given order. Pure — returns a new
 * preview, never mutates the input (immutability rule).
 */
export function optimizeMerge(
  preview: MergePreview,
  actions: OptimizeAction[],
  opts: { budget?: number } = {},
): MergePreview {
  let skills = [...preview.skills];
  const dropped = [...preview.dropped];
  const usageById = new Map(preview.usage.map((u) => [u.id, u.references]));

  for (const action of actions) {
    if (action === "prune") {
      // Only prune when there's a usage signal to trust. If NO skill in the
      // set has any references (sparse/short session history), pruning would
      // nuke the whole profile — that's noise, not signal, so skip it.
      const hasSignal = skills.some((id) => (usageById.get(id) ?? 0) > 0);
      if (hasSignal) {
        const kept: string[] = [];
        for (const id of skills) {
          const refs = usageById.get(id) ?? 0;
          if (refs > 0 || isAlwaysKeep(id)) kept.push(id);
          else dropped.push({ id, reason: "prune" });
        }
        skills = kept;
      }
    } else if (action === "budget") {
      const max = opts.budget ?? DEFAULT_BUDGET;
      if (skills.length > max) {
        // Keep always-keep + highest-usage up to the cap.
        const ranked = [...skills].sort((a, b) => {
          const ka = isAlwaysKeep(a) ? Infinity : usageById.get(a) ?? 0;
          const kb = isAlwaysKeep(b) ? Infinity : usageById.get(b) ?? 0;
          return kb - ka;
        });
        const keep = new Set(ranked.slice(0, max));
        const next: string[] = [];
        for (const id of skills) {
          if (keep.has(id)) next.push(id);
          else dropped.push({ id, reason: "budget" });
        }
        skills = next;
      }
    }
    // `dedupe` and `router` don't change the skill set — handled below /
    // foldComposite already deduped ids. dedupe just surfaces the conflict
    // report already on the preview.
  }

  const persona = actions.includes("router")
    ? buildSurfaceRouter(skills, preview.name) + (preview.persona ? `\n\n${preview.persona}` : "")
    : preview.persona;

  return {
    ...preview,
    skills,
    dropped,
    persona,
    estTokens: skills.length * TOKENS_PER_SKILL + preview.mcps.length * TOKENS_PER_MCP,
    appliedOptimizations: uniq([...preview.appliedOptimizations, ...actions]) as OptimizeAction[],
  };
}

/**
 * Build a "route work by surface" persona table, grouping skills by their
 * category prefix (the part before `/`). Deterministic — same input, same
 * table — so it's testable without a clustering model.
 */
export function buildSurfaceRouter(skillIds: string[], name: string): string {
  const byCat = new Map<string, string[]>();
  for (const id of skillIds) {
    const cat = id.includes("/") ? id.split("/")[0]! : "misc";
    const list = byCat.get(cat) ?? [];
    list.push(slugOf(id));
    byCat.set(cat, list);
  }
  const rows = [...byCat.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([cat, slugs]) => {
      const sample = slugs.slice(0, 3).join(", ") + (slugs.length > 3 ? ", …" : "");
      return `| ${cat}/* | ${slugs.length} | ${sample} |`;
    });

  return [
    `You operate the merged \`${name}\` loadout end-to-end. Route work by`,
    `surface — don't blur layers. Each row is a skill family; reach for the`,
    `family that owns the task.`,
    ``,
    `## Surface router`,
    ``,
    `| Surface | Skills | Examples |`,
    `|---|---|---|`,
    ...rows,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Render — turn a preview into a `profile.yaml` string
// ---------------------------------------------------------------------------

export type MergeMode = "static" | "alias";

function yamlList(items: string[], indent: string): string {
  return items.map((i) => `${indent}- ${quoteIfNeeded(i)}`).join("\n");
}

function quoteIfNeeded(s: string): string {
  // Quote values that YAML could misread (leading symbols, colons, etc.).
  if (/^[\w@./+-]+$/.test(s)) return s;
  return JSON.stringify(s);
}

function blockScalar(text: string, indent: string): string {
  return text
    .split("\n")
    .map((line) => (line.length ? `${indent}${line}` : indent.trimEnd()))
    .join("\n");
}

/**
 * Render the preview as a `profile.yaml`. `static` inlines the skills and
 * inherits core; `alias` emits a thin `inherits: [sources]` profile that stays
 * in sync with its sources.
 */
export function renderMerged(preview: MergePreview, mode: MergeMode): string {
  const lines: string[] = [];
  lines.push(`name: ${preview.name}`);
  lines.push(`icon: ${JSON.stringify(preview.icon)}`);
  lines.push(`description: ${JSON.stringify(preview.description)}`);

  if (mode === "alias") {
    lines.push(`inherits:`);
    lines.push(yamlList(preview.names, "  "));
    lines.push(`bundles:`);
    lines.push(yamlList(preview.names, "  "));
    return lines.join("\n") + "\n";
  }

  // static
  lines.push(`inherits: core`);
  lines.push(`bundles:`);
  lines.push(yamlList(preview.names, "  "));
  if (preview.profileConflicts.length > 0) {
    const conflictNames = uniq(preview.profileConflicts.flatMap((p) => [p.a, p.b]));
    lines.push(`conflicts:`);
    lines.push(yamlList(conflictNames, "  "));
  }
  if (preview.skills.length > 0 || preview.npx.length > 0) {
    lines.push(`skills:`);
    if (preview.skills.length > 0) {
      lines.push(`  local:`);
      lines.push(yamlList(preview.skills, "    "));
    }
    if (preview.npx.length > 0) {
      lines.push(`  npx:`);
      for (const ref of preview.npx) {
        lines.push(`    - repo: ${ref.repo}`);
        if (ref.pin) lines.push(`      pin: ${ref.pin}`);
        lines.push(`      skills: [${ref.skills.join(", ")}]`);
      }
    }
  }
  if (preview.plugins.length > 0) {
    lines.push(`plugins:`);
    lines.push(yamlList(preview.plugins, "  "));
  }
  if (preview.mcps.length > 0) {
    lines.push(`mcps:`);
    lines.push(yamlList(preview.mcps, "  "));
  }
  if (Object.keys(preview.env).length > 0) {
    lines.push(`env:`);
    for (const [k, v] of Object.entries(preview.env)) {
      lines.push(`  ${k}: ${JSON.stringify(v)}`);
    }
  }
  if (preview.persona && preview.persona.trim().length > 0) {
    lines.push(`persona: |`);
    lines.push(blockScalar(preview.persona.trim(), "  "));
  }
  return lines.join("\n") + "\n";
}

export class MergedProfileExists extends Error {
  constructor(public path: string) {
    super(`Profile already exists: ${path} (use --force to overwrite)`);
    this.name = "MergedProfileExists";
  }
}

async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

/**
 * Write a rendered merge to `profiles/<name>/profile.yaml`. Refuses to clobber
 * an existing profile unless `force`. Returns the written path.
 */
export async function writeMergedProfile(
  name: string,
  yaml: string,
  opts: { force?: boolean; profilesDir?: string } = {},
): Promise<string> {
  const dir = join(opts.profilesDir ?? profilesDir(), name);
  const path = join(dir, "profile.yaml");
  if (!opts.force && (await pathExists(path))) {
    throw new MergedProfileExists(path);
  }
  await mkdir(dir, { recursive: true });
  await writeFile(path, yaml, "utf8");
  return path;
}
