/**
 * `cue optimizer` — review each profile's skills, MCPs, and CLIs.
 *
 * Shows a dashboard per profile with:
 *   - Skills count
 *   - MCPs count and names
 *   - CLIs extracted from skills (tags, allowed-tools, Prerequisites, skill name)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

import { listProfiles, loadProfile } from "../lib/profile-loader";
import { isKittyTerminal, transmitKittyImage, kittyPlaceholderLabel } from "../lib/kitty-image";
import { getSkillIcon, getMcpIcon, getRepoIcon, getCliIcon } from "../lib/brand-icons";
import { repoRoot } from "../lib/repo-root";
import { extractCLIsFromSkill, expandSkillGlob } from "../lib/skill-parser";

// ---------------------------------------------------------------------------
// Re-exports for back-compat — callers that imported these from optimizer.ts
// continue to work without changes.
// ---------------------------------------------------------------------------
export type { SkillMetadata } from "../lib/skill-parser";
export { parseMetadataFromContent, parseCLIsFromContent, extractCLIsFromSkill } from "../lib/skill-parser";

const PROFILES_DIR = process.env.CUE_PROFILES_DIR ?? join(repoRoot(), "profiles");

// ---------------------------------------------------------------------------
// Usage tracking — scan session transcripts for skill file reads
// ---------------------------------------------------------------------------

function getSkillUsage(): Map<string, number> {
  const usage = new Map<string, number>();
  const projectsDir = join(homedir(), ".claude", "projects");
  try {
    // Use grep to scan all session jsonl files for SKILL.md reads
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
  return usage;
}

interface ProfileReport {
  name: string;
  icon: string;
  skills: string[];
  mcps: string[];
  clis: Map<string, string[]>; // cli → [skills that use it]
}

/**
 * Read the core profile's skill list once and return their slugs (basename
 * after the last "/") as a Set. Used by the dashboard renderer to separate
 * built-in (core-inherited) skills from profile-specific ones.
 * Reads core/profile.yaml once per run — NOT once per profile in the loop.
 */
function loadCoreSkillSlugs(profilesDir: string): Set<string> {
  const slugs = new Set<string>();
  try {
    const yaml = readFileSync(join(profilesDir, "core", "profile.yaml"), "utf8");
    const matches = yaml.match(/^\s{4}-\s+(.+)$/gm);
    if (matches) {
      for (const m of matches) {
        const id = m.replace(/^\s+-\s+/, "").trim().replace(/['"]/g, "");
        slugs.add(id.split("/").pop() ?? id);
      }
    }
  } catch { /* core profile not found — skip */ }
  return slugs;
}

async function parseProfile(name: string): Promise<ProfileReport> {
  let icon = "  ";
  let skills: string[] = [];
  let mcps: string[] = [];

  try {
    // loadProfile resolves the full inheritance chain (not just one level),
    // handles object-form skill refs, schema validation, and wildcard
    // de-scoping — replacing ~80 lines of hand-rolled YAML regex logic.
    const p = await loadProfile(name);
    icon = p.icon ?? "  ";

    // Expand any wildcard skill IDs (e.g. "*/*") to concrete IDs on disk.
    const rawSkills = p.skills.local.map((r) => r.id);
    if (rawSkills.some((id) => id.includes("*"))) {
      const expanded = rawSkills.flatMap(expandSkillGlob);
      // Deduplicate while preserving order
      const seen = new Set<string>();
      skills = expanded.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
    } else {
      skills = rawSkills;
    }

    mcps = p.mcps.map((r) => r.id);
  } catch { /* profile not found or invalid — return empty report */ }

  // Extract CLIs from each skill
  const clis = new Map<string, string[]>();
  for (const skill of skills) {
    const slug = skill.split("/").pop() ?? skill;
    const skillClis = extractCLIsFromSkill(slug);
    for (const cli of skillClis) {
      const list = clis.get(cli) ?? [];
      list.push(slug);
      clis.set(cli, list);
    }
  }

  return { name, icon, skills, mcps, clis };
}

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue optimizer — visual dashboard of all profiles

Usage: cue optimizer [profile] [--expand]

Shows per profile: skills (with usage stats), MCPs, required CLIs
(with install status), GitHub sources, and brand icons in Kitty.

Flags:
  --expand, -e    Show all skill groups expanded
  <profile>       Show only one profile

Examples:
  cue optimizer              # all profiles
  cue optimizer backend      # just backend
  cue optimizer --expand     # expand grouped skills
`);
    return 0;
  }

  const expand = args.includes("--expand") || args.includes("-e");
  const filteredArgs = args.filter((a) => a !== "--expand" && a !== "-e");
  const filterProfile = filteredArgs[0];
  const profiles = await listProfiles();

  // Load usage data from session transcripts
  const usage = getSkillUsage();

  const reports: ProfileReport[] = [];
  for (const name of profiles) {
    if (filterProfile && name !== filterProfile) continue;
    reports.push(await parseProfile(name));
  }

  if (reports.length === 0) {
    process.stderr.write(filterProfile
      ? `Profile "${filterProfile}" not found.\n`
      : "No profiles found.\n");
    return 1;
  }

  // CLI category icons
  const cliIcons: Record<string, string> = {
    python: "🐍", pip: "🐍", uv: "🐍", uvx: "🐍",
    node: "💛", npm: "💛", npx: "💛", bun: "💛", pnpm: "💛", yarn: "💛", deno: "💛",
    docker: "🐳", kubectl: "☸️", helm: "☸️",
    terraform: "🏗️", ansible: "🏗️", vagrant: "🏗️",
    aws: "☁️", gcloud: "☁️", az: "☁️",
    git: "🐙", gh: "🐙", glab: "🐙",
    rust: "🦀", cargo: "🦀", rustc: "🦀",
    go: "🔷", golang: "🔷",
    nmap: "🔍", wireshark: "🔍", tcpdump: "🔍", scapy: "🔍", zeek: "🔍",
    splunk: "📊", elastic: "📊", kibana: "📊", logstash: "📊",
    burpsuite: "🕷️", nikto: "🕷️", sqlmap: "🕷️", zap: "🕷️", nuclei: "🕷️",
    metasploit: "💀", hydra: "💀", hashcat: "💀", john: "💀",
    volatility: "🧠", autopsy: "🧠", ghidra: "🧠", radare2: "🧠", binwalk: "🧠",
    yara: "🛡️", clamav: "🛡️", snort: "🛡️", suricata: "🛡️",
    curl: "🌐", wget: "🌐", httpx: "🌐",
    openssl: "🔐", ssh: "🔐", testssl: "🔐", sslscan: "🔐",
    shodan: "🌍", censys: "🌍", amass: "🌍", subfinder: "🌍", maltego: "🌍",
    dd: "💾", dcfldd: "💾", foremost: "💾", sleuthkit: "💾",
    apktool: "📱", jadx: "📱", frida: "📱", objection: "📱",
    jq: "⚙️", yq: "⚙️", make: "⚙️", cmake: "⚙️", gcc: "⚙️",
    coolify: "🚀", medusa: "🐍", higgsfield: "🎬", colony: "🐝", gx: "🐝",
  };

  // Render dashboard — connected left border style
  const kitty = isKittyTerminal();
  const SKILLS_LOCK_PATH = join(homedir(), "skills-lock.json");
  let skillsLock: Record<string, { source: string }> = {};
  try {
    const lockData = JSON.parse(readFileSync(SKILLS_LOCK_PATH, "utf8"));
    skillsLock = lockData.skills ?? {};
  } catch { /* no lock file */ }

  // Kitty placeholder mode: transmit images first, then use placeholder chars
  // This makes images scroll with text instead of staying stuck on screen
  let nextImageId = 1;
  const imageIdMap = new Map<string, number>(); // path → imageId

  function getOrTransmitImage(path: string): number {
    if (imageIdMap.has(path)) return imageIdMap.get(path)!;
    if (nextImageId > 255) return 0; // max 255 images
    const id = nextImageId++;
    imageIdMap.set(path, id);
    transmitKittyImage(path, id, 2, 1);
    return id;
  }

  // Helper: render inline kitty icon or empty string
  function skillIcon(slug: string): string {
    if (!kitty) return "";
    const path = getSkillIcon(slug);
    if (!path) return "";
    const id = getOrTransmitImage(path);
    if (!id) return "";
    return kittyPlaceholderLabel(id, 2, 1) + " ";
  }

  function mcpIcon(id: string): string {
    if (!kitty) return "";
    const path = getMcpIcon(id);
    if (!path) return "";
    const imgId = getOrTransmitImage(path);
    if (!imgId) return "";
    return kittyPlaceholderLabel(imgId, 2, 1) + " ";
  }

  // Load core skill slugs once — used in each profile row to separate
  // built-in skills (inherited from core) from profile-specific ones.
  // Previously read and regex-parsed twice per profile inside the loop.
  const coreSkillSlugs = loadCoreSkillSlugs(PROFILES_DIR);

  for (let i = 0; i < reports.length; i++) {
    const r = reports[i]!;
    const cliCount = r.clis.size;

    // Profile header
    const profileLogoPath = join(PROFILES_DIR, r.name, "logo.png");
    let profileLogo = "";
    if (kitty && existsSync(profileLogoPath)) {
      const id = getOrTransmitImage(profileLogoPath);
      if (id) profileLogo = kittyPlaceholderLabel(id, 2, 1) + " ";
    }
    const iconDisplay = profileLogo ? profileLogo : (r.icon + "  ");
    process.stdout.write(`\n${i === 0 ? "╭" : "├"}── ${iconDisplay}${r.name}\n`);
    process.stdout.write(`│\n`);
    // Show profile-specific skill count (exclude built-ins from the number)
    const profileSkillCount = r.name === "core" ? r.skills.length : r.skills.filter(s => !coreSkillSlugs.has(s.split("/").pop() ?? s)).length;
    process.stdout.write(`│   📦 Skills: ${profileSkillCount}     🔌 MCPs: ${r.mcps.length}     🖥️  CLIs: ${cliCount}\n`);
    process.stdout.write(`│\n`);

    // Skills list (grouped by prefix, show first 15 or all if small)
    if (r.skills.length > 0) {
      process.stdout.write(`│   ┌─ 📦 Skills\n`);

      // Calculate total usage for this profile
      const profileUsage = r.skills.reduce((sum, s) => {
        const slug = (s.split("/").pop() ?? s);
        return sum + (usage.get(slug) ?? 0);
      }, 0);
      if (profileUsage > 0) {
        process.stdout.write(`│   │  📊 Total usage: ${profileUsage} reads across sessions\n│   │\n`);
      }

      if (r.skills.length <= 30) {
        // Show built-in section first
        const builtIn = r.skills.filter(s => coreSkillSlugs.has(s.split("/").pop() ?? s));
        const custom = r.skills.filter(s => !coreSkillSlugs.has(s.split("/").pop() ?? s));

        if (builtIn.length > 0 && custom.length > 0 && r.name !== "core") {
          // Just reference built-ins, don't list them again
          process.stdout.write(`│   │  \x1b[2m+ ${builtIn.length} built-in skills (cue builtin)\x1b[0m\n`);
          process.stdout.write(`│   │\n`);
          for (const s of custom) {
            const slug = s.split("/").pop() ?? s;
            const count = usage.get(slug) ?? 0;
            const bar = count > 0 ? ` ${"█".repeat(Math.min(10, Math.ceil(count / 50)))}░ ${count}×` : "";
            const icon = skillIcon(slug);
            process.stdout.write(`│   │  ${icon}${slug}${bar}\n`);
          }
        } else {
          for (const s of r.skills) {
            const slug = s.split("/").pop() ?? s;
            const count = usage.get(slug) ?? 0;
            const bar = count > 0 ? ` ${"█".repeat(Math.min(10, Math.ceil(count / 50)))}░ ${count}×` : "";
            const icon = skillIcon(slug);
            process.stdout.write(`│   │  ${icon}${slug}${bar}\n`);
          }
        }
      } else {
        // Group by first word prefix
        const groups = new Map<string, string[]>();
        for (const s of r.skills) {
          const slug = s.split("/").pop() ?? s;
          const prefix = slug.split("-")[0]!;
          const list = groups.get(prefix) ?? [];
          list.push(slug);
          groups.set(prefix, list);
        }
        const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

        if (expand) {
          // Show all groups with their skills + usage
          for (const [prefix, skills] of sorted) {
            const groupUsage = skills.reduce((s, sk) => s + (usage.get(sk) ?? 0), 0);
            const usageHint = groupUsage > 0 ? `  📊 ${groupUsage}×` : "";
            process.stdout.write(`│   │  ▸ ${prefix}-* (${skills.length})${usageHint}\n`);
            for (const s of skills) {
              const count = usage.get(s) ?? 0;
              const bar = count > 0 ? ` █${"█".repeat(Math.min(8, Math.ceil(count / 50)))}░ ${count}×` : "";
              process.stdout.write(`│   │      ${s}${bar}\n`);
            }
          }
        } else {
          for (const [prefix, skills] of sorted.slice(0, 15)) {
            const groupUsage = skills.reduce((s, sk) => s + (usage.get(sk) ?? 0), 0);
            const usageHint = groupUsage > 0 ? `  📊 ${groupUsage}×` : "";
            process.stdout.write(`│   │  ${prefix}-* (${skills.length})${usageHint}\n`);
          }
          if (sorted.length > 15) {
            process.stdout.write(`│   │  … +${sorted.length - 15} more groups (use --expand to show all)\n`);
          }
        }
      }
      process.stdout.write(`│   └\n`);
      process.stdout.write(`│\n`);
    }

    // MCPs
    if (r.mcps.length > 0) {
      process.stdout.write(`│   ┌─ 🔌 MCP Servers\n`);
      for (const mcp of r.mcps) {
        const icon = mcpIcon(mcp);
        process.stdout.write(`│   │  ${icon}${mcp}\n`);
      }
      process.stdout.write(`│   └\n`);
      process.stdout.write(`│\n`);
    }

    // CLIs — show ALL of them with install status
    if (cliCount > 0) {
      const { spawnSync } = await import("node:child_process");
      const sorted = [...r.clis.entries()].sort((a, b) => b[1].length - a[1].length);

      // Check which CLIs are installed
      let installedCount = 0;
      const cliStatus = new Map<string, boolean>();
      for (const [cli] of sorted) {
        const res = spawnSync("which", [cli], { encoding: "utf8", timeout: 1000 });
        const installed = res.status === 0;
        cliStatus.set(cli, installed);
        if (installed) installedCount++;
      }

      const missingCount = cliCount - installedCount;
      const statusStr = missingCount === 0
        ? `✅ ${installedCount}/${cliCount} all installed`
        : `✅ ${installedCount} installed · ❌ ${missingCount} missing`;

      process.stdout.write(`│\n`);
      process.stdout.write(`│   ┌─────────────────────────────────────────────\n`);
      process.stdout.write(`│   │  🖥️  \x1b[1mRequired CLIs\x1b[0m (${cliCount} tools)\n`);
      process.stdout.write(`│   │  ${statusStr}\n`);
      process.stdout.write(`│   ├─────────────────────────────────────────────\n`);

      for (const [cli, skills] of sorted) {
        let iconStr = "";
        if (kitty) {
          const iconPath = getCliIcon(cli);
          if (iconPath) {
            const id = getOrTransmitImage(iconPath);
            if (id) iconStr = kittyPlaceholderLabel(id, 2, 1) + " ";
          }
        }
        const emojiIcon = iconStr ? "" : ((cliIcons[cli] ?? "▪️") + " ");
        const installed = cliStatus.get(cli);
        const status = installed ? "✅" : "❌";
        const skillList = !installed && skills.length <= 3
          ? `  (${skills.join(", ")})`
          : "";
        process.stdout.write(`│   │  ${status} ${iconStr}${emojiIcon}${cli.padEnd(15)} — ${skills.length} skill${skills.length > 1 ? "s" : ""}${skillList}\n`);
      }
      process.stdout.write(`│   └─────────────────────────────────────────────\n`);
    }

    // GitHub Sources — show which repos provide skills for this profile
    const repoSkillMap = new Map<string, number>();
    for (const s of r.skills) {
      const slug = s.split("/").pop() ?? s;
      const lockEntry = skillsLock[slug];
      if (lockEntry) {
        repoSkillMap.set(lockEntry.source, (repoSkillMap.get(lockEntry.source) ?? 0) + 1);
      }
    }
    // Always count local skills
    const localCount = r.skills.length - [...repoSkillMap.values()].reduce((a, b) => a + b, 0);
    if (repoSkillMap.size > 0 || localCount > 0) {
      process.stdout.write(`│\n│   ┌─ 🐙 Sources\n`);
      if (localCount > 0) {
        process.stdout.write(`│   │  📁 opencue/cuecards (${localCount} skills)\n`);
      }
      for (const [repo, count] of [...repoSkillMap.entries()].sort((a, b) => b[1] - a[1])) {
        let repoIconStr = "";
        if (kitty) {
          const p = getRepoIcon(repo);
          if (p) { const id = getOrTransmitImage(p); if (id) repoIconStr = kittyPlaceholderLabel(id, 2, 1) + " "; }
        }
        process.stdout.write(`│   │  ${repoIconStr}📦 ${repo} (${count} skills)\n`);
      }
      process.stdout.write(`│   └\n`);
    }

    process.stdout.write(`│\n`);
  }
  process.stdout.write(`╰──\n`);

  // Summary
  if (reports.length > 1) {
    process.stdout.write("\n");
    const totalSkills = reports.reduce((s, r) => s + r.skills.length, 0);
    const totalMcps = new Set(reports.flatMap((r) => r.mcps)).size;
    const totalClis = new Set(reports.flatMap((r) => [...r.clis.keys()])).size;
    process.stdout.write(`  📊 ${reports.length} profiles  ·  📦 ${totalSkills} skills  ·  🔌 ${totalMcps} MCPs  ·  🖥️  ${totalClis} CLIs\n\n`);
  }

  return 0;
}
