/**
 * `cue skills` — manage skills in profiles.
 *
 * Subcommands:
 *   list [--json]              — skills in active profile
 *   available [--json]         — all skills NOT in active profile
 *   search <query> [--json]    — fuzzy search across catalog
 *   add <repo> [flags]         — wraps `npx skills add` with profile hook
 *   add-to-profile <id>        — append skill to active profile.yaml
 *   remove-from-profile <id>   — remove skill from active profile.yaml
 */

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { styleText } from "node:util";

import { parse as parseYaml } from "yaml";

import { listProfiles, loadProfile } from "../lib/profile-loader";
import { resolveActiveProfile } from "../lib/cwd-resolver";
import { listAllSkillIds } from "../lib/resolver-local";
import { fetchCompanionFiles, readSourceFile, findIncompleteSkills } from "../lib/companion-fetch";
import { gateFreshSkill } from "./security";

const PROFILES_DIR = process.env.CUE_PROFILES_DIR ?? join(repoRoot(), "profiles");
const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");

// ---------------------------------------------------------------------------
// Skill metadata parsing
// ---------------------------------------------------------------------------

interface SkillMeta {
  id: string;
  description: string;
  tags: string[];
  category: string;
  requires_mcps: string[];
}

function parseSkillMeta(id: string): SkillMeta {
  const parts = id.split("/");
  const category = parts.length === 2 ? parts[0]! : "unknown";
  const skillDir = join(SKILLS_ROOT, id);
  const skillMd = join(skillDir, "SKILL.md");
  let description = "";
  let tags: string[] = [];
  let requires_mcps: string[] = [];

  try {
    const content = readFileSync(skillMd, "utf8");
    // Parse the YAML frontmatter with a real parser. The previous regex grabbed
    // whatever sat on the `description:` line, so block scalars (`description: >-`
    // or `|` with the text indented below) surfaced as a literal "—  >-" / "— |"
    // in the listing, and double-quoted strings kept their `\"` escapes. A YAML
    // parse folds block scalars into clean text and unescapes quotes for free.
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      try {
        const fm = parseYaml(fmMatch[1]!) as Record<string, unknown> | null;
        if (fm && typeof fm === "object") {
          if (typeof fm.description === "string") description = fm.description;
          tags = normalizeStringList(fm.tags);
          requires_mcps = normalizeStringList(fm.requires_mcps);
        }
      } catch { /* malformed frontmatter — fall back to the body heuristic */ }
    }
    // Fallback: first non-empty, non-heading line after frontmatter.
    if (!description) {
      const body = fmMatch ? content.slice(fmMatch[0].length) : content;
      const firstLine = body.split("\n").find(l => l.trim() && !l.startsWith("#"));
      if (firstLine) description = firstLine.trim().slice(0, 120);
    }
  } catch { /* skill dir may not have SKILL.md */ }

  return { id, description, tags, category, requires_mcps };
}

/** Coerce a frontmatter field that may be a YAML array or a comma string. */
function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

const COLOR = process.stdout.isTTY === true;
const dim = (s: string): string => (COLOR ? styleText("dim", s) : s);
const accent = (s: string): string => (COLOR ? styleText("cyan", s) : s);

/** Collapse folded-YAML whitespace to one line and truncate to `max` columns. */
function cleanDesc(desc: string, max: number): string {
  const flat = desc.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
}

/**
 * Render skills grouped by category with the name in an aligned column and a
 * dimmed, single-line, width-aware description. Shared by `list` and
 * `available` so both surfaces format identically.
 */
function renderSkillGroups(metas: SkillMeta[], opts: { showTags: boolean } = { showTags: false }): void {
  const grouped = new Map<string, SkillMeta[]>();
  for (const m of metas) {
    const list = grouped.get(m.category) ?? [];
    list.push(m);
    grouped.set(m.category, list);
  }
  const cols = process.stdout.columns && process.stdout.columns > 40 ? process.stdout.columns : 100;
  for (const [cat, skills] of [...grouped.entries()].sort()) {
    process.stdout.write(`  ${dim(`${cat}/`)}\n`);
    // Align names to the longest in the group, capped so one long name can't
    // shove every description off the right edge.
    const nameW = Math.min(24, Math.max(...skills.map((s) => shortName(s.id).length)));
    for (const s of skills) {
      const padded = shortName(s.id).padEnd(nameW);
      const tagStr = opts.showTags && s.tags.length ? ` [${s.tags.join(", ")}]` : "";
      // Reserve: 4 indent + nameW + 2 gap + tag text. Floor at 40 so narrow
      // terminals still show a useful slice.
      const budget = Math.max(40, cols - 6 - nameW - tagStr.length);
      const desc = cleanDesc(s.description, budget);
      process.stdout.write(`    ${accent(padded)}  ${dim(desc)}${dim(tagStr)}\n`);
    }
  }
}

function shortName(id: string): string {
  return id.split("/")[1] ?? id;
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function getActiveProfileName(): Promise<string | null> {
  try {
    return await resolveActiveProfile();
  } catch {
    return null;
  }
}

async function getActiveProfileSkillIds(): Promise<string[]> {
  const name = await getActiveProfileName();
  if (!name) return [];
  try {
    const profile = await loadProfile(name);
    return profile.skills.local.map(s => typeof s === "string" ? s : s.id);
  } catch {
    return [];
  }
}

async function cmdList(json: boolean): Promise<number> {
  const ids = await getActiveProfileSkillIds();
  const metas = ids.map(parseSkillMeta);

  if (json) {
    process.stdout.write(JSON.stringify(metas, null, 2) + "\n");
  } else {
    const profileName = await getActiveProfileName();
    process.stdout.write(`Skills in profile "${profileName}" (${metas.length}):\n\n`);
    renderSkillGroups(metas);
  }
  return 0;
}

async function cmdAvailable(json: boolean): Promise<number> {
  const allIds = await listAllSkillIds();
  const activeIds = new Set(await getActiveProfileSkillIds());
  const available = allIds.filter(id => !activeIds.has(id));
  const metas = available.map(parseSkillMeta);

  if (json) {
    process.stdout.write(JSON.stringify(metas, null, 2) + "\n");
  } else {
    process.stdout.write(`Available skills not in active profile (${metas.length}):\n\n`);
    renderSkillGroups(metas, { showTags: false });
  }
  return 0;
}

async function cmdSearch(query: string, json: boolean): Promise<number> {
  const allIds = await listAllSkillIds();
  const metas = allIds.map(parseSkillMeta);
  const q = query.toLowerCase();

  const matches = metas.filter(m =>
    m.id.toLowerCase().includes(q) ||
    m.description.toLowerCase().includes(q) ||
    m.tags.some(t => t.toLowerCase().includes(q)) ||
    m.category.toLowerCase().includes(q)
  );

  if (json) {
    process.stdout.write(JSON.stringify(matches, null, 2) + "\n");
  } else {
    if (matches.length === 0) {
      process.stdout.write(`No skills matching "${query}"\n`);
    } else {
      process.stdout.write(`Skills matching "${query}" (${matches.length}):\n\n`);
      for (const m of matches) {
        const tagStr = m.tags.length ? ` [${m.tags.join(", ")}]` : "";
        const mcpStr = m.requires_mcps.length ? ` (needs: ${m.requires_mcps.join(", ")})` : "";
        process.stdout.write(`  ${m.id}  — ${m.description}${tagStr}${mcpStr}\n`);
      }
    }
  }
  return 0;
}

async function cmdAddToProfile(id: string, preview = false): Promise<number> {
  const profileName = await getActiveProfileName();
  if (!profileName) {
    process.stderr.write("No active profile. Pin one with `echo <name> > .cue.profile`\n");
    return 1;
  }

  // Check profile lock
  const { isProfileLocked } = await import("./lock");
  const lock = isProfileLocked(profileName);
  if (lock.locked) {
    process.stderr.write(`❌ Profile "${profileName}" is locked${lock.by ? ` by ${lock.by}` : ""}.\n`);
    if (lock.reason) process.stderr.write(`   Reason: ${lock.reason}\n`);
    process.stderr.write(`   Unlock with: cue unlock ${profileName}\n`);
    return 1;
  }

  // Validate skill exists
  const allIds = await listAllSkillIds();
  if (!allIds.includes(id)) {
    process.stderr.write(`Skill "${id}" not found. Run \`cue skills search\` to find valid IDs.\n`);
    return 1;
  }

  const yamlPath = join(PROFILES_DIR, profileName, "profile.yaml");
  const content = await readFile(yamlPath, "utf8");

  // Check if already present
  if (content.includes(`- ${id}`)) {
    process.stderr.write(`Skill "${id}" already in profile "${profileName}"\n`);
    return 0;
  }

  // Check requires_mcps
  const meta = parseSkillMeta(id);

  // Preview mode
  if (preview) {
    process.stdout.write(`Preview: adding "${id}" to profile "${profileName}"\n\n`);
    process.stdout.write(`Changes:\n`);
    process.stdout.write(`  + 1 skill (${id})\n`);
    if (meta.requires_mcps.length) {
      const missing = meta.requires_mcps.filter(m => !content.includes(`- ${m}`));
      if (missing.length) process.stdout.write(`  + ${missing.length} MCP(s): ${missing.join(", ")}\n`);
    }
    process.stdout.write(`\nRun without --preview to apply.\n`);
    return 0;
  }

  let updated = content;

  if (meta.requires_mcps.length > 0) {
    for (const mcp of meta.requires_mcps) {
      if (!updated.includes(`- ${mcp}`)) {
        if (updated.includes("mcps:")) {
          const lines = updated.split("\n");
          const mcpsIdx = lines.findIndex(l => l.match(/^mcps:/));
          if (mcpsIdx >= 0) {
            let insertIdx = mcpsIdx + 1;
            while (insertIdx < lines.length && lines[insertIdx]?.match(/^\s+-\s/)) insertIdx++;
            if (!lines.slice(mcpsIdx, insertIdx).some(l => l.includes(mcp))) {
              lines.splice(insertIdx, 0, `  - ${mcp}`);
              updated = lines.join("\n");
            }
          }
        } else {
          updated = updated.trimEnd() + `\nmcps:\n  - ${mcp}\n`;
        }
        process.stdout.write(`Auto-added required MCP: ${mcp}\n`);
      }
    }
  }

  // Add skill to skills.local
  if (updated.includes("  local:")) {
    const lines = updated.split("\n");
    const localIdx = lines.findIndex(l => l.match(/^\s+local:/));
    let insertIdx = localIdx + 1;
    while (insertIdx < lines.length && lines[insertIdx]?.match(/^\s{4}-\s/)) insertIdx++;
    lines.splice(insertIdx, 0, `    - ${id}`);
    updated = lines.join("\n");
  } else if (updated.includes("skills:")) {
    updated = updated.replace(/^(skills:)\s*$/m, `$1\n  local:\n    - ${id}`);
  } else {
    updated = updated.trimEnd() + `\nskills:\n  local:\n    - ${id}\n`;
  }

  await writeFile(yamlPath, updated);
  process.stdout.write(`Added "${id}" to profile "${profileName}"\n`);
  return 0;
}

async function cmdRemoveFromProfile(id: string): Promise<number> {
  const profileName = await getActiveProfileName();
  if (!profileName) {
    process.stderr.write("No active profile.\n");
    return 1;
  }

  const yamlPath = join(PROFILES_DIR, profileName, "profile.yaml");
  const content = await readFile(yamlPath, "utf8");

  const lines = content.split("\n");
  const filtered = lines.filter(l => !l.match(new RegExp(`^\\s+-\\s+${id.replace("/", "/")}\\s*$`)));

  if (filtered.length === lines.length) {
    process.stderr.write(`Skill "${id}" not found in profile "${profileName}"\n`);
    return 1;
  }

  await writeFile(yamlPath, filtered.join("\n"));
  process.stdout.write(`Removed "${id}" from profile "${profileName}"\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// `cue skills add <repo>` — wraps npx with post-install profile hook
// ---------------------------------------------------------------------------

import * as p from "@clack/prompts";
import { copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { repoRoot } from "../lib/repo-root";

const INSTALL_DIRS = [
  join(homedir(), ".claude", "skills"),
  join(homedir(), ".codex", "skills"),
];

function getInstalledSkills(): Set<string> {
  const skills = new Set<string>();
  for (const dir of INSTALL_DIRS) {
    try { for (const e of readdirSync(dir)) skills.add(e); } catch {}
  }
  return skills;
}

function inferProfileName(repo: string): string {
  const slug = repo.split("/").pop() ?? repo;
  return slug
    .replace(/^anthropic-/i, "")
    .replace(/-skills?$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "new-profile";
}

function inferEmoji(repo: string, profileName: string): string {
  const text = `${repo} ${profileName}`.toLowerCase();
  const map: [RegExp, string][] = [
    [/cyber|security|hack|pentest|vuln/, "🛡️"],
    [/ai|ml|machine.?learn|neural|llm|model/, "🤖"],
    [/web|frontend|react|vue|angular|css/, "🌐"],
    [/backend|api|server|express|fastify/, "⚙️"],
    [/data|analytics|pipeline|etl|warehouse/, "📊"],
    [/cloud|aws|azure|gcp|infra|terraform/, "☁️"],
    [/mobile|ios|android|flutter|react.?native/, "📱"],
    [/devops|ci.?cd|deploy|docker|k8s|kubernetes/, "🚀"],
    [/database|sql|postgres|mongo|redis/, "🗄️"],
    [/design|ui|ux|figma|brand/, "🎨"],
    [/marketing|seo|growth|ads|campaign/, "📣"],
    [/writing|docs|content|blog|copy/, "✍️"],
    [/research|science|paper|academic/, "🔬"],
    [/finance|payment|stripe|billing|crypto/, "💰"],
    [/game|unity|unreal|godot/, "🎮"],
    [/media|video|audio|image|photo/, "🎬"],
    [/network|dns|tcp|http|proxy/, "🔌"],
    [/test|qa|quality|jest|pytest/, "🧪"],
    [/rust|cargo|crate/, "🦀"],
    [/python|pip|django|flask/, "🐍"],
    [/node|npm|bun|deno|javascript|typescript/, "💛"],
    [/forensic|incident|threat|malware/, "🔍"],
    [/crypto|encrypt|ssl|tls|cert/, "🔐"],
    [/linux|ubuntu|debian|arch/, "🐧"],
    [/windows|powershell/, "🪟"],
    [/git|github|gitlab/, "🐙"],
  ];
  for (const [re, emoji] of map) {
    if (re.test(text)) return emoji;
  }
  return "🔧";
}

function inferImageUrl(repo: string, profileName: string): string | null {
  const text = `${repo} ${profileName}`.toLowerCase();
  // Map keywords to well-known icon URLs (simple-icons via CDN)
  const map: [RegExp, string][] = [
    [/cyber|security|hack|pentest/, "https://cdn.simpleicons.org/hackthebox/9FEF00"],
    [/aws/, "https://cdn.simpleicons.org/amazonaws/FF9900"],
    [/azure/, "https://cdn.simpleicons.org/microsoftazure/0078D4"],
    [/gcp|google.?cloud/, "https://cdn.simpleicons.org/googlecloud/4285F4"],
    [/docker/, "https://cdn.simpleicons.org/docker/2496ED"],
    [/kubernetes|k8s/, "https://cdn.simpleicons.org/kubernetes/326CE5"],
    [/terraform/, "https://cdn.simpleicons.org/terraform/844FBA"],
    [/react/, "https://cdn.simpleicons.org/react/61DAFB"],
    [/vue/, "https://cdn.simpleicons.org/vuedotjs/4FC08D"],
    [/angular/, "https://cdn.simpleicons.org/angular/DD0031"],
    [/python|django|flask/, "https://cdn.simpleicons.org/python/3776AB"],
    [/rust/, "https://cdn.simpleicons.org/rust/000000"],
    [/node|express/, "https://cdn.simpleicons.org/nodedotjs/339933"],
    [/typescript/, "https://cdn.simpleicons.org/typescript/3178C6"],
    [/go|golang/, "https://cdn.simpleicons.org/go/00ADD8"],
    [/linux/, "https://cdn.simpleicons.org/linux/FCC624"],
    [/git|github/, "https://cdn.simpleicons.org/github/181717"],
    [/stripe/, "https://cdn.simpleicons.org/stripe/635BFF"],
    [/postgres/, "https://cdn.simpleicons.org/postgresql/4169E1"],
    [/mongo/, "https://cdn.simpleicons.org/mongodb/47A248"],
    [/redis/, "https://cdn.simpleicons.org/redis/DC382D"],
    [/nginx/, "https://cdn.simpleicons.org/nginx/009639"],
    [/splunk/, "https://cdn.simpleicons.org/splunk/000000"],
    [/elastic|elk/, "https://cdn.simpleicons.org/elastic/005571"],
    [/anthropic|claude/, "https://cdn.simpleicons.org/anthropic/191919"],
    [/openai/, "https://cdn.simpleicons.org/openai/412991"],
    [/nvidia|cuda/, "https://cdn.simpleicons.org/nvidia/76B900"],
    [/forensic|incident|threat|malware/, "https://cdn.simpleicons.org/virustotal/394EFF"],
  ];
  for (const [re, url] of map) {
    if (re.test(text)) return url;
  }
  return null;
}

async function cmdNpxAdd(args: string[]): Promise<number> {
  const addArgs = args.slice(1); // skip "add"
  const repo = addArgs.find((a) => !a.startsWith("-") && !["claude-code", "codex", "*"].includes(a));

  // #6: If -y/--yes without --skill, inject --skill "*" to skip npx's interactive picker
  // (strip our own --allow-unsafe so it isn't forwarded to `npx skills add`).
  const allowUnsafe = args.includes("--allow-unsafe");
  const passedArgs = args.filter((a) => a !== "--allow-unsafe");
  const hasYes = passedArgs.includes("-y") || passedArgs.includes("--yes");
  const hasSkill = passedArgs.includes("-s") || passedArgs.includes("--skill");
  if (hasYes && !hasSkill) {
    passedArgs.push("--skill", "*");
  }

  // Snapshot before
  const before = getInstalledSkills();

  // Always use inherit so npx's interactive picker works on TTY
  const res = spawnSync("npx", ["skills", ...passedArgs], {
    stdio: "inherit",
    encoding: "utf8",
  });

  if (res.status !== 0) return res.status ?? 1;

  // Detect new skills by diffing before/after
  const after = getInstalledSkills();
  let newSkills = [...after].filter((s) => !before.has(s));

  // If no new skills (re-install), check if a profile for this repo already exists
  // and offer to update it, or use the installed skills that match the repo name
  let isReinstall = false;
  if (newSkills.length === 0 && repo) {
    isReinstall = true;
    // Use the profile name we'd infer to find matching skills already on disk
    const profileSlug = inferProfileName(repo);
    // Check if profile exists
    const profileYaml = join(PROFILES_DIR, profileSlug, "profile.yaml");
    if (existsSync(profileYaml)) {
      // Profile exists — read its skills as the "new" skills for update flow
      const content = readFileSync(profileYaml, "utf8");
      const skillMatches = content.match(/^\s{4}-\s+(.+)$/gm);
      if (skillMatches) {
        newSkills = skillMatches.map((l) => l.replace(/^\s+-\s+/, "").trim());
      }
    }
    // If profile doesn't exist or has no skills, scan disk for repo's skills
    if (newSkills.length === 0) {
      // All skills currently on disk that weren't in "before" snapshot of profiles
      newSkills = [...after];
    }
  }

  // If still nothing, the install was likely cancelled — don't trigger hook
  if (newSkills.length === 0) return 0;

  // Security gate: scan freshly-fetched skills before the profile hook below
  // registers any into profile.yaml. Block criticals (SEC1-3) unless
  // --allow-unsafe; flagged skills stay on disk but are dropped from the set.
  {
    const blocked: string[] = [];
    for (const slug of newSkills) {
      const gate = gateFreshSkill(slug, { allowUnsafe });
      if (!gate.ok) {
        blocked.push(slug);
        process.stderr.write(`🔴 BLOCKED ${slug}: ${gate.critical.length} critical security finding(s)\n`);
        for (const c of gate.critical) {
          process.stderr.write(`   [${c.code}] ${c.message}${c.line ? ` (line ${c.line})` : ""}\n`);
        }
      } else if (!gate.scanned) {
        process.stderr.write(`⚠️  ${slug}: no SKILL.md found to scan — review manually.\n`);
      }
    }
    if (blocked.length > 0) {
      newSkills = newSkills.filter((s) => !blocked.includes(s));
      process.stderr.write(`   ${blocked.length} skill(s) left on disk but NOT registered. Re-run with --allow-unsafe to register anyway.\n`);
      if (newSkills.length === 0) return 1;
    }
  }

  // #7: Fetch GitHub repo description
  let repoDescription = "";
  if (repo) {
    try {
      const apiRes = spawnSync("curl", ["-fsSL", `https://api.github.com/repos/${repo}`], {
        stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 5000,
      });
      if (apiRes.status === 0 && apiRes.stdout) {
        const data = JSON.parse(apiRes.stdout);
        if (data.description) repoDescription = data.description;
      }
    } catch {}
  }

  // #8: Dedup — check which skills already exist in other profiles (direct only, not inherited)
  const existingMap = new Map<string, string[]>(); // skill → [profile names]
  try {
    const allProfiles = await listProfiles();
    for (const pName of allProfiles) {
      try {
        const yamlContent = readFileSync(join(PROFILES_DIR, pName, "profile.yaml"), "utf8");
        // Extract skill slugs directly from YAML (lines like "    - category/skill" or "    - skill")
        const skillMatches = yamlContent.match(/^\s{4}-\s+(.+)$/gm);
        if (!skillMatches) continue;
        for (const line of skillMatches) {
          const sid = line.replace(/^\s+-\s+/, "").trim();
          const slug = sid.split("/").pop() ?? sid;
          if (newSkills.includes(slug)) {
            const list = existingMap.get(slug) ?? [];
            list.push(pName);
            existingMap.set(slug, list);
          }
        }
      } catch {}
    }
  } catch {}

  // --- Post-install profile hook ---
  p.intro(isReinstall ? "🔄 Skills already installed" : "🎉 Skills installed successfully");
  p.log.info(`${newSkills.length} skills from ${repo ?? "install"}`);

  // Show dedup warning (skip for re-installs since we already know)
  if (!isReinstall && existingMap.size > 0) {
    const dupCount = existingMap.size;
    const examples = [...existingMap.entries()].slice(0, 5)
      .map(([skill, profiles]) => `  ${skill} → ${profiles.join(", ")}`)
      .join("\n");
    p.log.warning(`${dupCount} skill(s) already in other profiles:\n${examples}${dupCount > 5 ? `\n  … +${dupCount - 5} more` : ""}`);
  }

  // Check if a profile for this repo already exists
  const inferredName = repo ? inferProfileName(repo) : null;
  const existingProfilePath = inferredName ? join(PROFILES_DIR, inferredName, "profile.yaml") : null;
  const profileExists = existingProfilePath && existsSync(existingProfilePath);

  // Compute diff stats for update hint
  let diffHint = "sync skills list";
  let currentProfileSkills: string[] = [];
  if (profileExists && existingProfilePath) {
    try {
      const content = readFileSync(existingProfilePath, "utf8");
      const matches = content.match(/^\s{4}-\s+(.+)$/gm);
      if (matches) {
        currentProfileSkills = matches.map((l) => l.replace(/^\s+-\s+/, "").trim());
      }
      const currentSet = new Set(currentProfileSkills);
      const newSet = new Set(newSkills);
      const added = newSkills.filter((s) => !currentSet.has(s));
      const removed = currentProfileSkills.filter((s) => !newSet.has(s));
      const parts: string[] = [];
      if (added.length > 0) parts.push(`\x1b[32m+${added.length} new\x1b[0m`);
      if (removed.length > 0) parts.push(`\x1b[31m-${removed.length} removed\x1b[0m`);
      if (added.length === 0 && removed.length === 0) parts.push("no changes");
      diffHint = parts.join(", ");
    } catch {}
  }

  const action = await p.select({
    message: profileExists
      ? `Profile "${inferredName}" already exists. What to do?`
      : "Add these skills to a cue profile?",
    options: [
      ...(profileExists ? [{ value: "update", label: `Update "${inferredName}" profile`, hint: diffHint }] : []),
      { value: "create", label: "Create a new profile", hint: !profileExists && repo ? inferProfileName(repo) : undefined },
      { value: "existing", label: "Add to a different profile" },
      { value: "skip", label: "Skip" },
    ],
  });
  if (p.isCancel(action) || action === "skip") {
    p.outro("Done. Run `cue list` to see profiles.");
    return 0;
  }

  // Handle "update" — overwrite skills in existing profile
  if (action === "update" && existingProfilePath && inferredName) {
    const content = await readFile(existingProfilePath, "utf8");
    const currentSet = new Set(currentProfileSkills);
    const newSet = new Set(newSkills);
    const added = newSkills.filter((s) => !currentSet.has(s));
    const removed = currentProfileSkills.filter((s) => !newSet.has(s));

    // Replace the entire skills.local section
    const skillLines = newSkills.map((s) => `    - ${s}`).join("\n");
    let updated: string;
    if (content.includes("  local:")) {
      const lines = content.split("\n");
      const localIdx = lines.findIndex((l) => l.match(/^\s+local:/));
      let endIdx = localIdx + 1;
      while (endIdx < lines.length && lines[endIdx]?.match(/^\s{4}-\s/)) endIdx++;
      lines.splice(localIdx + 1, endIdx - localIdx - 1, ...newSkills.map((s) => `    - ${s}`));
      updated = lines.join("\n");
    } else if (content.includes("skills:")) {
      updated = content.replace(/^(skills:)\s*$/m, `$1\n  local:\n${skillLines}`);
    } else {
      updated = content.trimEnd() + `\nskills:\n  local:\n${skillLines}\n`;
    }
    await writeFile(existingProfilePath, updated);

    const parts: string[] = [`${newSkills.length} total`];
    if (added.length > 0) parts.push(`+${added.length} new`);
    if (removed.length > 0) parts.push(`-${removed.length} removed`);
    p.outro(`Updated "${inferredName}" — ${parts.join(", ")}`);
    return 0;
  }

  // #3: Smart subset — group by prefix
  let selectedSkills = newSkills;
  if (newSkills.length > 10) {
    const scope = await p.select({
      message: `Include all ${newSkills.length} skills or pick a subset?`,
      options: [
        { value: "all", label: `All ${newSkills.length} skills` },
        { value: "groups", label: "Select by category/group" },
        { value: "individual", label: "Pick individual skills" },
      ],
    });
    if (p.isCancel(scope)) { p.cancel("cancelled"); return 130; }

    if (scope === "groups") {
      // Group skills by their first word/prefix (e.g. "analyzing-*", "testing-*", "securing-*")
      const groups = new Map<string, string[]>();
      for (const s of newSkills) {
        const prefix = s.split("-").slice(0, 1).join("-");
        const list = groups.get(prefix) ?? [];
        list.push(s);
        groups.set(prefix, list);
      }
      // Sort groups by size descending
      const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

      const chosenGroups = await p.multiselect({
        message: "Select skill groups (space to toggle)",
        options: sortedGroups.map(([prefix, skills]) => ({
          value: prefix,
          label: `${prefix}-* (${skills.length} skills)`,
          hint: skills.slice(0, 3).join(", ") + (skills.length > 3 ? " …" : ""),
        })),
        required: true,
      });
      if (p.isCancel(chosenGroups)) { p.cancel("cancelled"); return 130; }
      const selectedPrefixes = new Set(chosenGroups as string[]);
      selectedSkills = newSkills.filter((s) => selectedPrefixes.has(s.split("-").slice(0, 1).join("-")));
      p.log.info(`Selected ${selectedSkills.length} skills from ${selectedPrefixes.size} groups`);
    } else if (scope === "individual") {
      const chosen = await p.multiselect({
        message: "Select skills (space to toggle)",
        options: newSkills.map((s) => ({ value: s, label: s })),
        required: true,
      });
      if (p.isCancel(chosen)) { p.cancel("cancelled"); return 130; }
      selectedSkills = chosen as string[];
    }
  }

  if (action === "create") {
    const suggested = repo ? inferProfileName(repo) : "new-profile";
    const name = await p.text({
      message: "Profile name",
      placeholder: suggested,
      initialValue: suggested,
      validate: (v) => { if (!/^[a-z][a-z0-9-]{1,63}$/.test(v ?? "")) return "Must be kebab-case"; },
    });
    if (p.isCancel(name)) { p.cancel("cancelled"); return 130; }

    // Icon: emoji or image
    const iconType = await p.select({
      message: "Profile icon",
      options: [
        { value: "emoji", label: "Emoji", hint: "type or paste an emoji" },
        { value: "image", label: "Image file", hint: "paste path to .png/.jpg" },
      ],
    });
    if (p.isCancel(iconType)) { p.cancel("cancelled"); return 130; }

    let icon = "🔒";
    let iconImagePath: string | null = null;

    if (iconType === "emoji") {
      const suggestedEmoji = inferEmoji(repo ?? "", name as string);
      const emojiInput = await p.text({ message: "Icon emoji", placeholder: suggestedEmoji, initialValue: suggestedEmoji });
      if (p.isCancel(emojiInput)) { p.cancel("cancelled"); return 130; }
      icon = emojiInput as string;
    } else {
      // #4: GitHub avatar as fallback
      const suggestedUrl = inferImageUrl(repo ?? "", name as string);
      const ghAvatar = repo ? `https://github.com/${repo.split("/")[0]}.png?size=128` : null;
      const imgSource = await p.select({
        message: "Image source",
        options: [
          ...(suggestedUrl ? [{ value: "suggested", label: "Download suggested icon", hint: suggestedUrl }] : []),
          ...(ghAvatar ? [{ value: "avatar", label: "GitHub avatar", hint: ghAvatar }] : []),
          { value: "url", label: "Download from URL" },
          { value: "local", label: "Local file path" },
        ],
      });
      if (p.isCancel(imgSource)) { p.cancel("cancelled"); return 130; }

      if (imgSource === "suggested" || imgSource === "url" || imgSource === "avatar") {
        let url = imgSource === "suggested" ? (suggestedUrl ?? "") : imgSource === "avatar" ? (ghAvatar ?? "") : "";
        if (imgSource === "url") {
          const urlInput = await p.text({ message: "Image URL", placeholder: "https://..." });
          if (p.isCancel(urlInput)) { p.cancel("cancelled"); return 130; }
          url = urlInput as string;
        }
        const { mkdtempSync } = await import("node:fs");
        const { tmpdir } = await import("node:os");
        const tmpDir = mkdtempSync(join(tmpdir(), "cue-icon-"));
        const ext = url.match(/\.(png|jpg|jpeg|svg|webp)/i)?.[0] ?? ".png";
        const tmpFile = join(tmpDir, `logo${ext}`);
        const dlRes = spawnSync("curl", ["-fsSL", "-o", tmpFile, url], { stdio: "pipe", encoding: "utf8" });
        if (dlRes.status === 0 && existsSync(tmpFile)) {
          iconImagePath = tmpFile;
          p.log.success(`Downloaded icon`);
        } else {
          p.log.warning(`Download failed. Using emoji fallback.`);
          icon = inferEmoji(repo ?? "", name as string);
        }
      } else {
        const imgInput = await p.text({
          message: "Image path",
          placeholder: "/path/to/logo.png",
          validate: (v) => {
            if (!v) return "Path required";
            if (!existsSync(v)) return `Not found: ${v}`;
            if (!/\.(png|jpg|jpeg|svg|webp)$/i.test(v)) return "Must be .png, .jpg, .svg, or .webp";
          },
        });
        if (p.isCancel(imgInput)) { p.cancel("cancelled"); return 130; }
        iconImagePath = imgInput as string;
      }
    }

    // Description — use GitHub repo description as default
    const defaultDesc = repoDescription || `Skills from ${repo ?? "install"}`;
    const desc = await p.text({
      message: "Description",
      placeholder: defaultDesc,
      initialValue: defaultDesc,
    });
    if (p.isCancel(desc)) { p.cancel("cancelled"); return 130; }

    // #1: Preview card before confirm
    const previewIcon = iconImagePath ? `${icon} + logo image` : icon;
    p.log.message(`\n┌─ Profile Preview ─────────────────────\n│  Name:        ${name}\n│  Icon:        ${previewIcon}\n│  Description: ${(desc as string).slice(0, 60)}\n│  Skills:      ${selectedSkills.length}\n│  Inherits:    core\n└───────────────────────────────────────`);

    const confirm = await p.confirm({ message: "Create this profile?" });
    if (p.isCancel(confirm) || !confirm) { p.cancel("cancelled"); return 130; }

    // Create profile
    const { run: createProfile } = await import("./create-profile");
    const code = await createProfile([
      name as string, "--icon", icon, "--description", desc as string,
      "--skills", selectedSkills.join(","),
    ]);

    // Copy image if provided
    if (code === 0 && iconImagePath) {
      const profileDir = join(PROFILES_DIR, name as string);
      const ext = iconImagePath.match(/\.\w+$/)?.[0] ?? ".png";
      const destName = `logo${ext}`;
      copyFileSync(iconImagePath, join(profileDir, destName));
      const yaml = await readFile(join(profileDir, "profile.yaml"), "utf8");
      await writeFile(join(profileDir, "profile.yaml"), yaml.replace(/^(icon:.*\n)/m, `$1iconImage: "${destName}"\n`));
    }

    if (code !== 0) return code;

    // #2: Auto-pin option
    const pin = await p.confirm({ message: `Pin "${name}" to current directory?`, initialValue: true });
    if (!p.isCancel(pin) && pin) {
      await writeFile(join(process.cwd(), ".cue.profile"), `${name}\n`);
      p.log.success(`Pinned → .cue.profile`);
    }

    // #10: Post-create launch prompt
    const launch = await p.confirm({ message: `Launch claude with "${name}" now?`, initialValue: false });
    if (!p.isCancel(launch) && launch) {
      p.outro(`Launching claude with profile "${name}"…`);
      const { execSync } = await import("node:child_process");
      execSync("claude", { stdio: "inherit", env: { ...process.env } });
    } else {
      p.outro(`Profile "${name}" created with ${selectedSkills.length} skills. Run \`cue use ${name}\` to activate.`);
    }
    return 0;
  }

  if (action === "existing") {
    const profiles = await listProfiles();
    if (profiles.length === 0) { p.log.error("No profiles found."); return 1; }

    // Build profile options with skill counts
    const profileOptions = profiles.map((n) => {
      let skillCount = 0;
      try {
        const content = readFileSync(join(PROFILES_DIR, n, "profile.yaml"), "utf8");
        const matches = content.match(/^\s{4}-\s+/gm);
        if (matches) skillCount = matches.length;
      } catch {}
      return { value: n, label: `${n} (${skillCount} skills)` };
    });

    const target = await p.select({
      message: "Which profile?",
      options: profileOptions,
    });
    if (p.isCancel(target)) { p.cancel("cancelled"); return 130; }

    // #8: Show dedup for the target profile specifically
    const targetYamlPath = join(PROFILES_DIR, target as string, "profile.yaml");
    const content = await readFile(targetYamlPath, "utf8");
    const alreadyInTarget = selectedSkills.filter((s) => content.includes(s));
    if (alreadyInTarget.length > 0) {
      p.log.warning(`${alreadyInTarget.length} skill(s) already in "${target}", will skip duplicates`);
      selectedSkills = selectedSkills.filter((s) => !content.includes(s));
      if (selectedSkills.length === 0) {
        p.outro(`All skills already in "${target}". Nothing to add.`);
        return 0;
      }
    }

    const skillLines = selectedSkills.map((s) => `    - ${s}`);

    let updated: string;
    if (content.includes("  local:")) {
      const lines = content.split("\n");
      const localIdx = lines.findIndex((l) => l.match(/^\s+local:/));
      let insertIdx = localIdx + 1;
      while (insertIdx < lines.length && lines[insertIdx]?.match(/^\s{4}-\s/)) insertIdx++;
      lines.splice(insertIdx, 0, ...skillLines);
      updated = lines.join("\n");
    } else if (content.includes("skills:")) {
      updated = content.replace(/^(skills:)\s*$/m, `$1\n  local:\n${skillLines.join("\n")}`);
    } else {
      updated = content.trimEnd() + `\nskills:\n  local:\n${skillLines.join("\n")}\n`;
    }

    await writeFile(targetYamlPath, updated);
    p.outro(`Added ${selectedSkills.length} skills to "${target}".`);
    return 0;
  }

  return 0;
}

// ---------------------------------------------------------------------------
// `cue skills rank` — ranked list of skills by usage
// ---------------------------------------------------------------------------

async function cmdRank(args: string[]): Promise<number> {
  const limit = parseInt(args.find((a) => /^\d+$/.test(a)) ?? "30", 10);
  const projectsDir = join(homedir(), ".claude", "projects");

  // Scan session transcripts for skill reads
  const usage = new Map<string, number>();
  try {
    const res = spawnSync("grep", ["-roh", "--include=*.jsonl", "-m", "500", "skills/[a-z][a-z0-9-]*/SKILL.md", projectsDir], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 3000,
    });
    if (res.status === 0 && res.stdout) {
      for (const line of res.stdout.split("\n")) {
        const match = line.match(/skills\/([a-z][a-z0-9-]*)\/SKILL\.md/);
        if (match) {
          const skill = match[1]!;
          usage.set(skill, (usage.get(skill) ?? 0) + 1);
        }
      }
    }
  } catch {}

  if (usage.size === 0) {
    process.stdout.write("No usage data found. Skills are tracked when agents read SKILL.md files.\n");
    return 0;
  }

  const sorted = [...usage.entries()].sort((a, b) => b[1] - a[1]);
  const maxCount = sorted[0]![1];
  const barMax = 20;

  process.stdout.write(`\n  📊 Skill Usage Ranking (${sorted.length} skills tracked)\n\n`);
  process.stdout.write(`  ${"#".padEnd(4)}${"Skill".padEnd(40)}${"Uses".padStart(6)}  Graph\n`);
  process.stdout.write(`  ${"─".repeat(4)}${"─".repeat(40)}${"─".repeat(6)}  ${"─".repeat(barMax)}\n`);

  for (let i = 0; i < Math.min(limit, sorted.length); i++) {
    const [skill, count] = sorted[i]!;
    const barLen = Math.max(1, Math.round((count / maxCount) * barMax));
    const bar = "█".repeat(barLen) + "░".repeat(barMax - barLen);
    const rank = `${i + 1}.`.padEnd(4);
    process.stdout.write(`  ${rank}${skill.padEnd(40)}${String(count).padStart(6)}  ${bar}\n`);
  }

  if (sorted.length > limit) {
    process.stdout.write(`\n  … ${sorted.length - limit} more (use \`cue skills rank ${sorted.length}\` to show all)\n`);
  }

  process.stdout.write("\n");
  return 0;
}

// ---------------------------------------------------------------------------
// `cue skills triggers [<skill>]` — show the user prompts that historically
// fired a given skill (or top skills+their top prompt with no arg).
//
// Source: ~/.config/cue/analytics.jsonl. The skill-fire-tracker Stop hook
// embeds a `first_prompt` field on each `skill_hit` event so callers here
// can see *which user prompts actually triggered which skills* — the input
// description-optimizer needs.
// ---------------------------------------------------------------------------

interface SkillHitEvent {
  event?: string;
  skill?: string;
  first_prompt?: string;
  profile?: string;
  session_id?: string;
}

function readAnalyticsHits(): SkillHitEvent[] {
  const path = join(homedir(), ".config", "cue", "analytics.jsonl");
  if (!existsSync(path)) return [];
  const out: SkillHitEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const ev = JSON.parse(trimmed) as SkillHitEvent;
      if (ev.event === "skill_hit" && ev.skill) out.push(ev);
    } catch { /* skip malformed */ }
  }
  return out;
}

async function cmdTriggers(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const skill = args.find((a) => a !== "--json" && !a.startsWith("-"));
  const hits = readAnalyticsHits();

  if (hits.length === 0) {
    process.stdout.write(
      "No skill_hit events found in ~/.config/cue/analytics.jsonl yet.\n" +
      "Trigger data accumulates as the skill-fire-tracker Stop hook runs.\n",
    );
    return 0;
  }

  if (skill) {
    // Show prompts that fired this specific skill, grouped by prompt text.
    const matching = hits.filter((h) => h.skill === skill);
    if (matching.length === 0) {
      process.stdout.write(`No triggers recorded for skill "${skill}".\n`);
      return 0;
    }
    const promptCounts = new Map<string, number>();
    let missingPromptCount = 0;
    for (const h of matching) {
      const p = (h.first_prompt ?? "").trim();
      if (!p) { missingPromptCount++; continue; }
      promptCounts.set(p, (promptCounts.get(p) ?? 0) + 1);
    }

    if (json) {
      const sortedJson = [...promptCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([prompt, count]) => ({ prompt, count }));
      process.stdout.write(JSON.stringify({
        skill,
        total_fires: matching.length,
        prompts_without_capture: missingPromptCount,
        prompts: sortedJson,
      }, null, 2) + "\n");
      return 0;
    }

    process.stdout.write(`\n  🎯 Triggers for "${skill}" (${matching.length} fires)\n\n`);
    if (promptCounts.size === 0) {
      process.stdout.write(`  No first_prompt data yet — fires recorded before the analytics-fidelity upgrade.\n`);
      process.stdout.write(`  New fires from now on will include the user prompt that triggered them.\n\n`);
      return 0;
    }
    const sorted = [...promptCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [prompt, count] of sorted.slice(0, 20)) {
      const preview = prompt.length > 100 ? prompt.slice(0, 97) + "..." : prompt;
      process.stdout.write(`  ${String(count).padStart(3)}×  ${preview}\n`);
    }
    if (missingPromptCount > 0) {
      process.stdout.write(`\n  (${missingPromptCount} legacy fires without prompt-capture)\n`);
    }
    process.stdout.write("\n");
    return 0;
  }

  // No skill arg: top-10 skills with their most common triggering prompt.
  const bySkill = new Map<string, { fires: number; prompts: Map<string, number> }>();
  for (const h of hits) {
    if (!h.skill) continue;
    let bucket = bySkill.get(h.skill);
    if (!bucket) { bucket = { fires: 0, prompts: new Map() }; bySkill.set(h.skill, bucket); }
    bucket.fires++;
    const p = (h.first_prompt ?? "").trim();
    if (p) bucket.prompts.set(p, (bucket.prompts.get(p) ?? 0) + 1);
  }

  const ranked = [...bySkill.entries()]
    .map(([skillId, b]) => {
      const topPrompt = [...b.prompts.entries()].sort((a, b) => b[1] - a[1])[0];
      return { skill: skillId, fires: b.fires, top_prompt: topPrompt?.[0] ?? null, top_prompt_count: topPrompt?.[1] ?? 0 };
    })
    .sort((a, b) => b.fires - a.fires);

  if (json) {
    process.stdout.write(JSON.stringify(ranked, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(`\n  🎯 Top skills by fires + their top triggering prompt\n\n`);
  for (const r of ranked.slice(0, 15)) {
    const promptPreview = r.top_prompt
      ? (r.top_prompt.length > 70 ? r.top_prompt.slice(0, 67) + "..." : r.top_prompt)
      : "(no prompt data yet)";
    process.stdout.write(`  ${String(r.fires).padStart(3)}×  ${r.skill.padEnd(40)} ← ${promptPreview}\n`);
  }
  process.stdout.write(`\n  Run \`cue skills triggers <skill>\` for the full prompt list for a single skill.\n\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// #12: Skill ratings
// ---------------------------------------------------------------------------

async function cmdRate(id: string, vote: string): Promise<number> {
  if (!id || !["up", "down"].includes(vote)) {
    process.stderr.write("Usage: cue skills rate <skill-id> up|down\n");
    return 1;
  }
  const { rateSkill, getRating } = await import("../lib/ratings");
  rateSkill(id, vote === "up");
  const r = getRating(id);
  process.stdout.write(`${vote === "up" ? "👍" : "👎"} Rated "${id}" — score: ${(r?.up ?? 0) - (r?.down ?? 0)} (${r?.up ?? 0}↑ ${r?.down ?? 0}↓)\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// #14: Skill outdated check
// ---------------------------------------------------------------------------

async function cmdOutdated(json: boolean): Promise<number> {
  const ids = await getActiveProfileSkillIds();
  if (!ids.length) { process.stderr.write("No skills in active profile.\n"); return 1; }

  const results: { id: string; lastModified: string; daysOld: number }[] = [];
  const now = Date.now();

  for (const id of ids) {
    const skillPath = join(SKILLS_ROOT, id, "SKILL.md");
    try {
      const { statSync } = require("node:fs");
      const stat = statSync(skillPath);
      const daysOld = Math.floor((now - stat.mtimeMs) / 86400000);
      results.push({ id, lastModified: stat.mtime.toISOString().slice(0, 10), daysOld });
    } catch { /* skip */ }
  }

  const outdated = results.filter(r => r.daysOld > 30).sort((a, b) => b.daysOld - a.daysOld);

  if (json) {
    process.stdout.write(JSON.stringify({ total: results.length, outdated }, null, 2) + "\n");
    return 0;
  }

  if (outdated.length === 0) {
    process.stdout.write("✅ All skills updated within the last 30 days.\n");
    return 0;
  }

  process.stdout.write(`⚠️  ${outdated.length} skill(s) outdated (>30 days since last update):\n\n`);
  for (const r of outdated) {
    process.stdout.write(`  ${r.id.padEnd(40)} ${r.lastModified}  (${r.daysOld} days)\n`);
  }
  process.stdout.write(`\nRun \`cue update --skills\` to sync from upstream.\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// `cue skills why <id>` — explain why a skill is included via dependency paths
// ---------------------------------------------------------------------------

async function cmdWhy(id: string): Promise<number> {
  if (!id) {
    process.stderr.write("Usage: cue skills why <skill-id>\n");
    return 1;
  }
  const { buildDependencyGraph, explainWhy } = await import("../lib/skill-deps");
  const ids = await getActiveProfileSkillIds();
  if (!ids.length) { process.stderr.write("No skills in active profile.\n"); return 1; }

  const graph = buildDependencyGraph(ids);
  const paths = explainWhy(id, graph);

  if (paths.length === 0) {
    process.stdout.write(`"${id}" is not reachable from any skill in the active profile.\n`);
    return 0;
  }

  process.stdout.write(`"${id}" is included because:\n\n`);
  for (const path of paths) {
    if (path.length === 1) {
      process.stdout.write(`  • directly listed in profile\n`);
    } else {
      process.stdout.write(`  • ${path.join(" → ")}\n`);
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// `cue skills upgrade` — upgrade outdated skills from lockfile
// ---------------------------------------------------------------------------

async function cmdUpgrade(args: string[]): Promise<number> {
  const { findOutdated, recordInstall } = await import("../lib/skills-lock");
  process.stdout.write("Checking for outdated skills...\n");
  const outdated = findOutdated();
  if (outdated.length === 0) {
    process.stdout.write("✅ All locked skills are up to date.\n");
    return 0;
  }
  process.stdout.write(`Found ${outdated.length} outdated skill(s):\n\n`);
  for (const o of outdated) {
    process.stdout.write(`  ${o.id.padEnd(35)} ${o.current.slice(0, 7)} → ${o.latest.slice(0, 7)}  (${o.repo})\n`);
  }
  if (!args.includes("--yes")) {
    process.stdout.write(`\nRe-run with --yes to upgrade.\n`);
    return 0;
  }
  for (const o of outdated) {
    recordInstall(o.id, o.repo, o.latest);
    process.stdout.write(`  ✅ ${o.id} → ${o.latest.slice(0, 7)}\n`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// `cue skills update` — re-fetch companion files for installed skills
// ---------------------------------------------------------------------------

async function cmdUpdate(args: string[]): Promise<number> {
  const targetId = args.find(a => !a.startsWith("-"));
  const all = args.includes("--all");

  if (!targetId && !all) {
    process.stdout.write(`cue skills update — re-fetch companion files for skills

Usage:
  cue skills update <skill-id>   Re-fetch companions for one skill
  cue skills update --all        Re-fetch companions for all incomplete skills

Examples:
  cue skills update content/pdf
  cue skills update --all
`);
    return 0;
  }

  if (targetId) {
    // Update a single skill
    const skillDir = join(SKILLS_ROOT, targetId);
    if (!existsSync(skillDir)) {
      process.stderr.write(`Skill "${targetId}" not found at ${skillDir}\n`);
      return 1;
    }

    const source = readSourceFile(skillDir);
    if (!source) {
      process.stderr.write(`No .source file for "${targetId}". Cannot determine origin repo.\n`);
      process.stderr.write(`Hint: create ${join(skillDir, ".source")} with content: owner/repo::path/to/skill\n`);
      return 1;
    }

    process.stdout.write(`Updating "${targetId}" from ${source.repo}::${source.skillPath}...\n`);
    const result = fetchCompanionFiles(source.repo, source.skillPath, skillDir, {
      ref: source.ref,
      writeSource: true,
    });

    if (result.fetched.length > 0) {
      process.stdout.write(`  ✅ Fetched: ${result.fetched.join(", ")}\n`);
    } else {
      process.stdout.write(`  ✅ Already up to date.\n`);
    }
    if (result.errors.length > 0) {
      process.stdout.write(`  ⚠️  Errors: ${result.errors.join(", ")}\n`);
    }
    return result.errors.length > 0 ? 1 : 0;
  }

  // --all: find and fix all incomplete skills
  const incomplete = findIncompleteSkills(SKILLS_ROOT);
  if (incomplete.length === 0) {
    process.stdout.write("✅ All skills are complete. Nothing to update.\n");
    return 0;
  }

  process.stdout.write(`Found ${incomplete.length} incomplete skill(s):\n\n`);
  let updated = 0;
  let failed = 0;

  for (const skill of incomplete) {
    const source = readSourceFile(skill.dir);
    if (!source) {
      process.stdout.write(`  ⏭  ${skill.id} — no .source file, skipping\n`);
      continue;
    }

    process.stdout.write(`  ⏳ ${skill.id} (missing: ${skill.missing.join(", ")})...\n`);
    const result = fetchCompanionFiles(source.repo, source.skillPath, skill.dir, {
      ref: source.ref,
      writeSource: true,
    });

    if (result.fetched.length > 0) {
      process.stdout.write(`     ✅ Fetched: ${result.fetched.join(", ")}\n`);
      updated++;
    }
    if (result.errors.length > 0) {
      process.stdout.write(`     ⚠️  Errors: ${result.errors.join(", ")}\n`);
      failed++;
    }
  }

  process.stdout.write(`\nDone: ${updated} updated, ${failed} failed, ${incomplete.length - updated - failed} skipped.\n`);
  return failed > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// `cue skills sandbox [--profile <name>]` — sandbox report
// ---------------------------------------------------------------------------

async function cmdSandbox(args: string[]): Promise<number> {
  const { generateSandboxReport } = await import("../lib/skill-sandbox");
  const profileIdx = args.indexOf("--profile");
  let ids: string[];

  if (profileIdx >= 0 && args[profileIdx + 1]) {
    try {
      const profile = await loadProfile(args[profileIdx + 1]!);
      ids = profile.skills.local.map(s => s.id);
    } catch (e: any) {
      process.stderr.write(`Failed to load profile: ${e.message}\n`);
      return 1;
    }
  } else {
    ids = await getActiveProfileSkillIds();
    if (!ids.length) {
      process.stderr.write("No skills in active profile. Use --profile <name>.\n");
      return 1;
    }
  }

  process.stdout.write(generateSandboxReport(ids) + "\n");
  return 0;
}

// ---------------------------------------------------------------------------
// `cue skills score <id>` / `cue skills score --all` — quality scoring
// ---------------------------------------------------------------------------

async function cmdScore(args: string[]): Promise<number> {
  const { scoreSkillQuality, formatScoreCard } = await import("../lib/skill-quality");
  const all = args.includes("--all");

  if (all) {
    const ids = await getActiveProfileSkillIds();
    if (!ids.length) {
      const allIds = await listAllSkillIds();
      if (!allIds.length) { process.stderr.write("No skills found.\n"); return 1; }
      for (const id of allIds.slice(0, 30)) {
        const result = scoreSkillQuality(id);
        const grade = result.score >= 80 ? "A" : result.score >= 60 ? "B" : result.score >= 40 ? "C" : result.score >= 20 ? "D" : "F";
        process.stdout.write(`  ${grade} ${String(result.score).padStart(3)}/100  ${id}\n`);
      }
      return 0;
    }
    for (const id of ids) {
      const result = scoreSkillQuality(id);
      const grade = result.score >= 80 ? "A" : result.score >= 60 ? "B" : result.score >= 40 ? "C" : result.score >= 20 ? "D" : "F";
      process.stdout.write(`  ${grade} ${String(result.score).padStart(3)}/100  ${id}\n`);
    }
    return 0;
  }

  const id = args.find(a => !a.startsWith("-"));
  if (!id) {
    process.stderr.write("Usage: cue skills score <skill-id> | cue skills score --all\n");
    return 1;
  }

  const result = scoreSkillQuality(id);
  process.stdout.write(`\n${id}\n${formatScoreCard(result)}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue skills — manage skills in profiles

Usage: cue skills <subcommand> [args]

Subcommands:
  list                 Skills in active profile
  available            Skills NOT in active profile
  search <query>       Fuzzy search all skills
  add-to-profile <id>  Add skill to active profile
  remove-from-profile  Remove skill from active profile
  rank [limit]         Usage leaderboard
  triggers [<skill>]   Show prompts that historically fired a skill
  audit                Find unused skills
  conflicts            Detect contradicting skills
  lint <id>|--all      Quality check
  test <id>|--all      Run skill tests
  new <cat/name>       Scaffold a new skill
  pin/rollback/unpin   Version pinning
  changelog <id>       Show version history
  rate <id> up|down    Rate a skill
  outdated             Show stale skills
  upgrade [--yes]      Upgrade outdated locked skills
  why <id>             Explain why a skill is included (dependency paths)
  update <id>|--all    Re-fetch companion files (scripts, docs)
  sandbox [--profile]  Sandbox report: allowed-tools and risk levels
  score <id>|--all     Quality score (0-100) with breakdown

Examples:
  cue skills search "review"
  cue skills add-to-profile review/code-review
  cue skills rank 20
`);
    return 0;
  }

  const sub = args[0] ?? "list";
  const json = args.includes("--json");
  const rest = args.filter(a => a !== "--json");

  switch (sub) {
    case "list":
      return cmdList(json);
    case "available":
      return cmdAvailable(json);
    case "search":
      return cmdSearch(rest.slice(1).join(" ") || "", json);
    case "add-to-profile":
      return cmdAddToProfile(rest[1] ?? "", args.includes("--preview"));
    case "remove-from-profile":
      return cmdRemoveFromProfile(rest[1] ?? "");
    case "audit":
      return cmdAudit(json);
    case "conflicts":
      return cmdConflicts(json, args.includes("--resolve"), args.includes("--apply"));
    case "changelog":
      return cmdChangelog(rest[1] ?? "");
    case "test": {
      const { run: runTest } = await import("./skills-test");
      return runTest(rest.slice(1));
    }
    case "lint": {
      const { run: runLint } = await import("./skills-lint");
      return runLint(rest.slice(1));
    }
    case "new": {
      const { run: runNew } = await import("./skills-new");
      return runNew(rest.slice(1));
    }
    case "pin":
    case "rollback":
    case "unpin": {
      const { run: runPin } = await import("./skills-pin");
      return runPin(rest);
    }
    case "rank":
      return cmdRank(rest.slice(1));
    case "triggers":
      return cmdTriggers(rest.slice(1));
    case "rate":
      return cmdRate(rest[1] ?? "", rest[2] ?? "");
    case "outdated":
      return cmdOutdated(json);
    case "upgrade":
      return cmdUpgrade(rest.slice(1));
    case "why":
      return cmdWhy(rest[1] ?? "");
    case "add":
      return cmdNpxAdd(args);
    case "update":
      return cmdUpdate(rest.slice(1));
    case "sandbox":
      return cmdSandbox(rest.slice(1));
    case "score":
      return cmdScore(rest.slice(1));
    default:
      return cmdNpxAdd(args);
  }
}

// ---------------------------------------------------------------------------
// #10: Skill audit — effectiveness scoring
// ---------------------------------------------------------------------------

async function cmdAudit(json: boolean): Promise<number> {
  const { scoreSkills } = await import("../lib/skill-scorer");
  const ids = await getActiveProfileSkillIds();
  if (ids.length === 0) {
    process.stderr.write("No skills in active profile.\n");
    return 1;
  }

  const results = scoreSkills(ids);

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    return 0;
  }

  const profileName = await getActiveProfileName();
  process.stdout.write(`Skill usage audit for "${profileName}" (last 20 sessions):\n\n`);
  for (const r of results) {
    const icon = r.references === 0 ? "❌" : r.references < 3 ? "⚠️" : "✅";
    process.stdout.write(`  ${icon} ${r.id}  — ${r.references} references\n`);
  }
  const dead = results.filter(r => r.references === 0);
  if (dead.length) {
    process.stdout.write(`\n  ${dead.length} unused skill(s) — candidates for removal.\n`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// #18: Skill conflict detection
// ---------------------------------------------------------------------------

async function cmdConflicts(json: boolean, resolveFlag = false, applyFlag = false): Promise<number> {
  const { detectConflicts, suggestResolutions } = await import("../lib/conflict-detector");
  const ids = await getActiveProfileSkillIds();
  const conflicts = detectConflicts(ids);

  if (json && !resolveFlag) {
    process.stdout.write(JSON.stringify(conflicts, null, 2) + "\n");
    return 0;
  }

  if (conflicts.length === 0) {
    process.stdout.write("✅ No skill conflicts detected.\n");
    return 0;
  }

  if (resolveFlag) {
    const resolutions = suggestResolutions(conflicts);
    if (json) {
      process.stdout.write(JSON.stringify(resolutions, null, 2) + "\n");
      return 0;
    }
    process.stdout.write(`⚠️  ${conflicts.length} conflict(s) with suggested resolutions:\n\n`);
    for (const r of resolutions) {
      process.stdout.write(`  ${r.conflict.skillA} vs ${r.conflict.skillB}\n`);
      process.stdout.write(`    "${r.conflict.directiveA}"\n`);
      process.stdout.write(`    conflicts with: "${r.conflict.directiveB}"\n`);
      process.stdout.write(`    → suggestion: ${r.suggestion} (${r.reason})\n\n`);
    }
    if (applyFlag) {
      // Apply: remove lower-priority skills from profile
      const profileName = await getActiveProfileName();
      if (!profileName) { process.stderr.write("No active profile.\n"); return 1; }
      const toRemove = new Set<string>();
      for (const r of resolutions) {
        if (r.suggestion === "remove-b" || r.suggestion === "prioritize-a") {
          toRemove.add(r.conflict.skillB);
        } else {
          toRemove.add(r.conflict.skillA);
        }
      }
      if (toRemove.size > 0) {
        process.stdout.write(`  Removing ${toRemove.size} lower-priority skill(s): ${[...toRemove].join(", ")}\n`);
        for (const id of toRemove) {
          await cmdRemoveFromProfile(id);
        }
      }
    }
    return 0;
  }

  process.stdout.write(`⚠️  ${conflicts.length} potential conflict(s):\n\n`);
  for (const c of conflicts) {
    process.stdout.write(`  ${c.skillA} vs ${c.skillB}\n`);
    process.stdout.write(`    "${c.directiveA}"\n`);
    process.stdout.write(`    conflicts with: "${c.directiveB}"\n\n`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// #13: Skill changelog
// ---------------------------------------------------------------------------

function cmdChangelog(id: string): number {
  if (!id) {
    process.stderr.write("Usage: cue skills changelog <skill-id>\n");
    return 1;
  }

  const skillPath = join(SKILLS_ROOT, id, "SKILL.md");
  try {
    const content = readFileSync(skillPath, "utf8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) { process.stdout.write("No frontmatter found.\n"); return 0; }

    const versionMatch = fmMatch[1]!.match(/^version:\s*(.+)$/m);
    const version = versionMatch?.[1] ?? "unknown";

    // Extract changelog entries
    const changelogMatch = fmMatch[1]!.match(/^changelog:\s*\n((?:\s+-\s+.+\n?)*)/m);

    process.stdout.write(`${id} v${version}\n\n`);
    if (changelogMatch) {
      const entries = changelogMatch[1]!.match(/^\s+-\s+"?(.+?)"?\s*$/gm);
      if (entries) {
        for (const e of entries) {
          process.stdout.write(`  ${e.trim()}\n`);
        }
      }
    } else {
      process.stdout.write("  No changelog entries.\n");
    }
  } catch {
    process.stderr.write(`Skill "${id}" not found.\n`);
    return 1;
  }
  return 0;
}
