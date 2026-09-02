#!/usr/bin/env bun
/**
 * gen-profile-catalog.ts — regenerate the AUTOGEN profile section in README.md
 * and refresh docs/data/profiles.md.
 *
 * Resolves every profile via the real loader so counts reflect inheritance
 * (a profile that inherits `core` shows 11 inherited + N own skills, etc.).
 * Groups profiles by editorial category and emits a visually grouped catalog.
 *
 * Usage:
 *   bun scripts/gen-profile-catalog.ts          # write
 *   bun scripts/gen-profile-catalog.ts --check  # exit 1 if README would change
 *
 * Re-run after adding or renaming profiles so the README stays in sync.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadProfile, listProfiles } from "../src/lib/profile-loader";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILES_DIR = join(REPO_ROOT, "profiles");
const README = join(REPO_ROOT, "README.md");

const START = "<!-- AUTOGEN:PROFILES:START -->";
const END = "<!-- AUTOGEN:PROFILES:END -->";

// ---------------------------------------------------------------------------
// Editorial categorization. This is the one piece that can't be derived from
// the YAML — it's a curated grouping for human navigation. Keep this list
// in sync as new profiles land.
// ---------------------------------------------------------------------------

interface Category {
  slug: string;
  title: string;
  blurb: string;
  members: string[];
}

const CATEGORIES: Category[] = [
  {
    slug: "foundation",
    title: "🐢 Foundation",
    blurb: "What every profile inherits, plus the diagnostic fallback.",
    members: ["core", "full"],
  },
  {
    slug: "backend",
    title: "🐻 Backend & Languages",
    blurb: "Language-scoped expert agents for API and systems work.",
    members: ["backend", "python-api", "go-api", "rust", "rust-core", "rust-cli", "rust-web", "rust-ffi", "rust-wasm", "rust-game", "rust-embedded"],
  },
  {
    slug: "frontend",
    title: "🦋 Frontend & 3D",
    blurb: "UI implementation, design, and graphics.",
    members: ["frontend", "nextjs", "threejs"],
  },
  {
    slug: "infra",
    title: "🧊 Infra & Ops",
    blurb: "Deploy targets and multi-agent orchestration.",
    members: ["coolify", "hostinger", "fleet-control"],
  },
  {
    slug: "security",
    title: "🔒 Security & Research",
    blurb: "Specialized analysis profiles.",
    members: ["cybersecurity", "research"],
  },
  {
    slug: "media",
    title: "🎨 Media & Docs",
    blurb: "Content, design, writing, and visual generation.",
    members: ["creative-media", "video", "docs-writer", "readme-writer", "event-design"],
  },
  {
    slug: "growth",
    title: "💰 Growth & Career",
    blurb: "Marketing, trends, and career-shaped agents.",
    members: ["marketing", "affiliate", "trendradar", "career"],
  },
  {
    slug: "vertical",
    title: "🦊 Verticals",
    blurb: "Domain-specific bundles.",
    members: ["medusa-dev", "nvidia", "jetson", "ecc"],
  },
  {
    slug: "modes",
    title: "🐆 Modes",
    blurb: "Operating-mode profiles, not domain bundles.",
    members: ["caveman-quick"],
  },
];

// ---------------------------------------------------------------------------
// Data loading — uses the real loader so inheritance counts are honest.
// ---------------------------------------------------------------------------

interface ProfileMeta {
  name: string;
  icon: string;
  /** Path relative to repo root to a real-logo PNG/SVG, if the profile ships one. */
  iconImage: string | null;
  description: string;
  skillCount: number;
  mcpCount: number;
  commandCount: number;
  hookCount: number;
  inherits: string | null;
}

async function gatherProfiles(): Promise<Map<string, ProfileMeta>> {
  const out = new Map<string, ProfileMeta>();
  const names = await listProfiles();
  for (const name of names) {
    try {
      const p = await loadProfile(name);
      // iconImage is stored as a per-profile-dir relative path (e.g. "logo.png").
      // Confirm the file actually exists before linking it in the README.
      let iconImagePath: string | null = null;
      if (p.iconImage) {
        const abs = join(PROFILES_DIR, name, p.iconImage);
        if (existsSync(abs) && statSync(abs).isFile()) {
          iconImagePath = `./profiles/${name}/${p.iconImage}`;
        }
      }
      out.set(name, {
        name,
        icon: p.icon ?? "❔",
        iconImage: iconImagePath,
        description: (p.description ?? "").trim(),
        skillCount: p.skills.local.length,
        mcpCount: p.mcps.length,
        commandCount: p.commands.length,
        hookCount: p.hooks.length,
        inherits: p.inherits ?? null,
      });
    } catch (e) {
      process.stderr.write(`  ⚠️  ${name}: failed to load — ${(e as Error).message}\n`);
    }
  }
  return out;
}

/**
 * Render a profile's icon as either an inline `<img>` tag (when the profile
 * ships a real logo) or the emoji glyph. Width is fixed at 20px so company
 * logos visually balance with the emoji rows in the same table.
 */
function renderIcon(p: ProfileMeta): string {
  if (p.iconImage) {
    return `<img src="${p.iconImage}" width="20" alt="${p.name} logo" align="top">`;
  }
  return p.icon;
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function shortenDesc(d: string, max = 95): string {
  const clean = d.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).replace(/[\s,.;:—-]+\S*$/, "") + "…";
}

function escapeForTable(s: string): string {
  return s.replace(/\|/g, "\\|");
}

function renderCategoryTable(cat: Category, profiles: Map<string, ProfileMeta>): string {
  const rows: string[] = [];
  for (const name of cat.members) {
    const p = profiles.get(name);
    if (!p) continue;
    const cmd = `\`cue use ${name}\``;
    const stats: string[] = [];
    if (p.skillCount) stats.push(`${p.skillCount} skill${p.skillCount === 1 ? "" : "s"}`);
    if (p.mcpCount) stats.push(`${p.mcpCount} MCP${p.mcpCount === 1 ? "" : "s"}`);
    if (p.commandCount) stats.push(`${p.commandCount} cmd${p.commandCount === 1 ? "" : "s"}`);
    const statStr = stats.length ? stats.join(" · ") : "—";
    const inherits = p.inherits ? ` <sub>inherits \`${p.inherits}\`</sub>` : "";
    rows.push(`| ${renderIcon(p)} **${p.name}** | ${escapeForTable(shortenDesc(p.description))}${inherits} | ${statStr} | ${cmd} |`);
  }
  if (rows.length === 0) return "";
  return [
    `### ${cat.title}`,
    "",
    `<sub>${cat.blurb}</sub>`,
    "",
    "| Profile | What it's for | Loadout | Pin it |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

function renderUncategorized(profiles: Map<string, ProfileMeta>): string {
  const assigned = new Set(CATEGORIES.flatMap(c => c.members));
  const orphans = [...profiles.keys()].filter(n => !assigned.has(n));
  if (orphans.length === 0) return "";
  return [
    `### Uncategorized`,
    "",
    `<sub>Profiles not yet in the editorial category map — add them to <code>scripts/gen-profile-catalog.ts</code>.</sub>`,
    "",
    "| Profile | What it's for |",
    "|---|---|",
    ...orphans.map(n => {
      const p = profiles.get(n)!;
      return `| ${renderIcon(p)} **${p.name}** | ${escapeForTable(shortenDesc(p.description))} |`;
    }),
    "",
  ].join("\n");
}

function renderHeader(profiles: Map<string, ProfileMeta>): string {
  const n = profiles.size;
  // Pick a few hero profiles for the inline showcase. Keep this row text-only
  // (<kbd> with raw emoji) — embedding <img> inside <kbd> renders inconsistently
  // across GitHub's markdown viewer. Real-logo profiles are showcased in their
  // category table instead.
  const hero = ["core", "backend", "frontend", "rust", "cybersecurity", "medusa-dev", "creative-media", "caveman-quick"]
    .filter(name => profiles.has(name))
    .map(name => {
      const p = profiles.get(name)!;
      return `<kbd>${p.icon} ${p.name}</kbd>`;
    });

  return [
    `## 🎯 The ${n}-profile catalog`,
    "",
    `> **One repo. ${n} pre-built expert agents.** Pin one with \`cue use <name>\` and \`claude\` launches with that profile's skills, MCPs, hooks, and commands materialized into a per-profile \`CLAUDE_CONFIG_DIR\`. Profiles inherit, so a focused profile like \`rust-cli\` gets \`rust-core\`'s foundations + \`core\`'s baselines for free.`,
    "",
    `<p align="center">${hero.slice(0, 8).join(" ")}</p>`,
    "",
    "```bash",
    "cue list                      # show everything",
    "cue auto-detect               # suggest the right one for cwd",
    "cue use medusa-dev            # pin to current directory",
    "claude                        # launches with that profile's loadout",
    "```",
    "",
  ].join("\n");
}

function renderFooter(profiles: Map<string, ProfileMeta>): string {
  const n = profiles.size;
  return [
    "---",
    "",
    `**Don't see a fit?** Run \`cue auto-detect\` in your project for a suggestion, or \`cue ai "describe your stack"\` to scaffold a new profile from natural language. Canonical machine-readable list: [\`docs/data/profiles.md\`](./docs/data/profiles.md). Total: **${n} profiles** generated by \`scripts/gen-profile-catalog.ts\`.`,
    "",
  ].join("\n");
}

function renderCatalog(profiles: Map<string, ProfileMeta>): string {
  const parts: string[] = [];
  parts.push(renderHeader(profiles));
  for (const cat of CATEGORIES) {
    const block = renderCategoryTable(cat, profiles);
    if (block) parts.push(block);
  }
  const uncat = renderUncategorized(profiles);
  if (uncat) parts.push(uncat);
  parts.push(renderFooter(profiles));
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// docs/data/profiles.md — flat machine-readable list
// ---------------------------------------------------------------------------

function renderDataDoc(profiles: Map<string, ProfileMeta>): string {
  const rows = [...profiles.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => {
      const inherits = p.inherits ? `\`${p.inherits}\`` : "—";
      return `| ${renderIcon(p)} | \`${p.name}\` | ${escapeForTable(shortenDesc(p.description, 140))} | ${p.skillCount} | ${p.mcpCount} | ${p.commandCount} | ${inherits} |`;
    });
  return [
    "<!-- AUTOGEN by scripts/gen-profile-catalog.ts — do not hand-edit. -->",
    "",
    "# All cue profiles (flat list)",
    "",
    `**${profiles.size} profiles** total. For the categorized presentation, see the [README](../../README.md#the-catalog).`,
    "",
    "| Icon | Profile | Description | Skills | MCPs | Commands | Inherits |",
    "|---|---|---|---:|---:|---:|---|",
    ...rows,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Splice into README between AUTOGEN markers
// ---------------------------------------------------------------------------

function splice(readme: string, generated: string): string {
  const startIdx = readme.indexOf(START);
  const endIdx = readme.indexOf(END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`README is missing AUTOGEN markers (${START} / ${END}). Add them around the profile catalog section first.`);
  }
  const before = readme.slice(0, startIdx + START.length);
  const after = readme.slice(endIdx);
  return `${before}\n${generated}\n${after}`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const check = process.argv.includes("--check");
  const profiles = await gatherProfiles();
  if (profiles.size === 0) {
    process.stderr.write("No profiles found.\n");
    process.exit(1);
  }

  const generated = renderCatalog(profiles);

  if (!existsSync(README)) {
    process.stderr.write(`README not found at ${README}\n`);
    process.exit(1);
  }
  const readme = readFileSync(README, "utf8");
  // The README catalog section may be hand-curated (AUTOGEN markers removed on
  // purpose). In that case the data doc is still independent and worth keeping
  // fresh — warn and skip the README splice instead of failing the whole run.
  let next = readme;
  let readmeSkipped = false;
  try {
    next = splice(readme, generated);
  } catch (err) {
    readmeSkipped = true;
    process.stderr.write(
      `⚠ skipping README splice: ${(err as Error).message}\n` +
      `  (regenerating docs/data/profiles.md only)\n`,
    );
  }

  // Sister doc — flat list for LLMs/screen readers.
  const dataDoc = join(REPO_ROOT, "docs", "data", "profiles.md");
  const dataNext = renderDataDoc(profiles);
  const dataPrev = existsSync(dataDoc) ? readFileSync(dataDoc, "utf8") : "";

  const readmeChanged = !readmeSkipped && next !== readme;
  const dataChanged = dataNext !== dataPrev;

  if (check) {
    if (readmeChanged || dataChanged) {
      process.stderr.write(`Profile catalog out of date. Run: bun scripts/gen-profile-catalog.ts\n`);
      if (readmeChanged) process.stderr.write(`  - README.md needs regen\n`);
      if (dataChanged) process.stderr.write(`  - docs/data/profiles.md needs regen\n`);
      process.exit(1);
    }
    process.stdout.write(`✅ profile catalog up to date (${profiles.size} profiles)\n`);
    return;
  }

  if (!readmeSkipped) writeFileSync(README, next);
  writeFileSync(dataDoc, dataNext);
  const targets = readmeSkipped ? "docs/data/profiles.md" : "README.md + docs/data/profiles.md";
  process.stdout.write(`✅ wrote ${profiles.size} profiles to ${targets}\n`);
}

main().catch(err => { process.stderr.write(`${err.stack ?? err.message}\n`); process.exit(1); });
