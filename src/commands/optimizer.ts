/**
 * `cue optimizer` — review each profile's skills, MCPs, and CLIs.
 *
 * Shows a dashboard per profile with:
 *   - Skills count
 *   - MCPs count and names
 *   - CLIs extracted from skills (tags, allowed-tools, Prerequisites, skill name)
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

import { listProfiles } from "../lib/profile-loader";
import { isKittyTerminal, transmitKittyImage, kittyPlaceholderLabel } from "../lib/kitty-image";
import { getSkillIcon, getMcpIcon, getRepoIcon, getCliIcon } from "../lib/brand-icons";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROFILES_DIR = process.env.CUE_PROFILES_DIR ?? join(REPO_ROOT, "profiles");
const SKILLS_ROOT = join(REPO_ROOT, "resources", "skills", "skills");
const HOME_SKILLS = join(homedir(), ".claude", "skills");

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

// Known CLI tools that appear in skill tags/names
const KNOWN_CLIS = new Set([
  "nmap", "scapy", "wireshark", "tcpdump", "burpsuite", "metasploit", "hydra",
  "nikto", "sqlmap", "gobuster", "dirb", "ffuf", "hashcat", "john",
  "volatility", "autopsy", "binwalk", "ghidra", "radare2", "gdb",
  "apktool", "jadx", "androguard", "frida", "objection",
  "docker", "kubectl", "helm", "terraform", "ansible", "vagrant",
  "aws", "gcloud", "az", "curl", "wget", "jq", "yq",
  "git", "gh", "glab", "npm", "npx", "bun", "pnpm", "yarn",
  "python", "pip", "uv", "uvx", "node", "deno",
  "go", "cargo", "rustc", "gcc", "make", "cmake",
  "openssl", "ssh", "ncat", "netcat", "socat",
  "splunk", "elastic", "kibana", "logstash",
  "peepdf", "pdfid", "pdf-parser", "olevba", "oletools",
  "yara", "clamav", "snort", "suricata", "zeek",
  "aircrack-ng", "reaver", "wifite", "kismet",
  "maltego", "shodan", "censys", "amass", "subfinder", "httpx",
  "nuclei", "zap", "wpscan", "testssl", "sslscan",
  "dd", "dcfldd", "foremost", "scalpel", "sleuthkit",
  "cuckoo", "remnux", "floss", "strings", "strace", "ltrace",
  "medusa", "coolify", "higgsfield", "colony", "gx",
]);

interface ProfileReport {
  name: string;
  icon: string;
  skills: string[];
  mcps: string[];
  clis: Map<string, string[]>; // cli → [skills that use it]
}

function extractCLIsFromSkill(skillSlug: string): string[] {
  const clis: Set<string> = new Set();

  // Try to read SKILL.md from resources or ~/.claude/skills
  let content = "";
  const paths = [
    join(HOME_SKILLS, skillSlug, "SKILL.md"),
    // Try all category subdirs in resources
    ...(() => {
      try {
        return readdirSync(SKILLS_ROOT)
          .map((cat) => join(SKILLS_ROOT, cat, skillSlug, "SKILL.md"));
      } catch { return []; }
    })(),
  ];

  for (const p of paths) {
    try { content = readFileSync(p, "utf8"); break; } catch {}
  }

  if (!content) {
    return [...clis];
  }

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1]!;

    // Extract from allowed-tools (actual runtime CLI dependencies)
    const toolsMatch = fm.match(/^allowed-tools:\s*(.+)$/m);
    if (toolsMatch) {
      const tools = toolsMatch[1]!;
      // Parse Bash(aws:*), Bash(curl:*), Bash(npx medusa ...) etc.
      const bashTools = tools.match(/Bash\(([^:)]+)/g);
      if (bashTools) {
        for (const bt of bashTools) {
          const cli = bt.replace("Bash(", "").trim().split(" ")[0]!.toLowerCase();
          if (cli && cli !== "bash") clis.add(cli);
        }
      }
    }
  }

  // Extract from Prerequisites section (lists what needs to be installed)
  const prereqMatch = content.match(/## Prerequisites\n([\s\S]*?)(?=\n##|\n$)/);
  if (prereqMatch) {
    const prereqs = prereqMatch[1]!;
    // Match lines like "- Nmap 7.90+ installed" or "- apktool (for ...)"
    const lines = prereqs.split("\n").filter((l) => l.startsWith("-") || l.startsWith("*"));
    for (const line of lines) {
      const lower = line.toLowerCase();
      for (const cli of KNOWN_CLIS) {
        // Only match if CLI appears as a word boundary (not substring of another word)
        const re = new RegExp(`\\b${cli}\\b`);
        if (re.test(lower)) clis.add(cli);
      }
    }
  }

  return [...clis];
}

function parseProfile(name: string): ProfileReport {
  const yamlPath = join(PROFILES_DIR, name, "profile.yaml");
  let icon = "  ";
  let skills: string[] = [];
  let mcps: string[] = [];

  try {
    const content = readFileSync(yamlPath, "utf8");

    // Icon
    const iconMatch = content.match(/^icon:\s*["']?(.+?)["']?\s*$/m);
    if (iconMatch) icon = iconMatch[1]!;

    // Skills
    const skillMatches = content.match(/^\s{4}-\s+(.+)$/gm);
    if (skillMatches) {
      skills = skillMatches.map((l) => l.replace(/^\s+-\s+/, "").trim().replace(/['"]/g, ""));
    }

    // Resolve wildcard "*/*" or "*" — expand to all skills on disk
    if (skills.some((s) => s.includes("*"))) {
      const expanded: string[] = [];
      try {
        // Scan resources/skills/skills/<category>/<skill>/
        for (const cat of readdirSync(SKILLS_ROOT)) {
          const catPath = join(SKILLS_ROOT, cat);
          try {
            for (const skill of readdirSync(catPath)) {
              if (existsSync(join(catPath, skill, "SKILL.md"))) {
                expanded.push(`${cat}/${skill}`);
              }
            }
          } catch {}
        }
      } catch {}
      // Also include skills from ~/.claude/skills/
      try {
        for (const skill of readdirSync(HOME_SKILLS)) {
          if (!expanded.some((e) => e.endsWith(`/${skill}`))) {
            expanded.push(skill);
          }
        }
      } catch {}
      skills = expanded;
    }

    // MCPs
    const mcpSection = content.match(/^mcps:\n((?:\s+-\s+.+\n)*)/m);
    if (mcpSection) {
      const mcpLines = mcpSection[1]!.match(/^\s+-\s+(.+)$/gm);
      if (mcpLines) {
        mcps = mcpLines.map((l) => l.replace(/^\s+-\s+/, "").trim());
      }
    }

    // Resolve inheritance — prepend parent skills
    const inheritsMatch = content.match(/^inherits:\s*(.+)$/m);
    if (inheritsMatch && name !== "core") {
      const parent = inheritsMatch[1]!.trim();
      try {
        const parentYaml = readFileSync(join(PROFILES_DIR, parent, "profile.yaml"), "utf8");
        const parentSkills = parentYaml.match(/^\s{4}-\s+(.+)$/gm);
        if (parentSkills) {
          const parentIds = parentSkills.map(l => l.replace(/^\s+-\s+/, "").trim().replace(/['"]/g, ""));
          // Prepend parent skills (deduped)
          const existing = new Set(skills);
          const inherited = parentIds.filter(s => !existing.has(s) && !s.startsWith("#"));
          skills = [...inherited, ...skills];
        }
        // Also inherit MCPs
        const parentMcpSection = parentYaml.match(/^mcps:\n((?:\s+-\s+.+\n)*)/m);
        if (parentMcpSection) {
          const parentMcpLines = parentMcpSection[1]!.match(/^\s+-\s+(.+)$/gm);
          if (parentMcpLines) {
            const parentMcps = parentMcpLines.map(l => l.replace(/^\s+-\s+/, "").trim());
            const existingMcps = new Set(mcps);
            mcps = [...parentMcps.filter(m => !existingMcps.has(m)), ...mcps];
          }
        }
      } catch { /* parent not found */ }
    }
  } catch {}

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
    reports.push(parseProfile(name));
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

  for (let i = 0; i < reports.length; i++) {
    const r = reports[i]!;
    const cliCount = r.clis.size;
    const isLast = i === reports.length - 1;
    const connector = isLast ? "╰" : "├";
    const pipe = isLast ? " " : "│";

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
    const coreSkillsForCount = new Set<string>();
    try {
      const coreYamlForCount = readFileSync(join(PROFILES_DIR, "core", "profile.yaml"), "utf8");
      const coreMatchesForCount = coreYamlForCount.match(/^\s{4}-\s+(.+)$/gm);
      if (coreMatchesForCount) {
        for (const m of coreMatchesForCount) {
          const id = m.replace(/^\s+-\s+/, "").trim().replace(/['"]/g, "");
          coreSkillsForCount.add(id.split("/").pop() ?? id);
        }
      }
    } catch { /* skip */ }
    const profileSkillCount = r.name === "core" ? r.skills.length : r.skills.filter(s => !coreSkillsForCount.has(s.split("/").pop() ?? s)).length;
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

      // Load core skills to identify built-ins
      const coreSkills = new Set<string>();
      try {
        const coreYaml = readFileSync(join(PROFILES_DIR, "core", "profile.yaml"), "utf8");
        const coreMatches = coreYaml.match(/^\s{4}-\s+(.+)$/gm);
        if (coreMatches) {
          for (const m of coreMatches) {
            const id = m.replace(/^\s+-\s+/, "").trim().replace(/['"]/g, "");
            coreSkills.add(id.split("/").pop() ?? id);
          }
        }
      } catch { /* skip */ }

      if (r.skills.length <= 30) {
        // Show built-in section first
        const builtIn = r.skills.filter(s => coreSkills.has(s.split("/").pop() ?? s));
        const custom = r.skills.filter(s => !coreSkills.has(s.split("/").pop() ?? s));

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
        process.stdout.write(`│   │  📁 recodeee/cue (${localCount} skills)\n`);
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
