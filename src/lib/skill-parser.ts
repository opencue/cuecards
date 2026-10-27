/**
 * Pure text parsers for SKILL.md content.
 *
 * These helpers are used by skill-linter, skill-subset, and cli-extractor —
 * all lib-layer modules. They live here rather than in commands/optimizer so
 * that the lib layer does not depend on the commands layer, avoiding an
 * inverted dependency (lib → commands) and the circular-dependency risk it
 * creates.
 *
 * No I/O beyond skill file reads. No network.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { repoRoot } from "./repo-root";

export const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");
export const HOME_SKILLS = join(homedir(), ".claude", "skills");

// Known CLI tools that appear in skill tags/names.
// Exported so commands/optimizer can re-export it for back-compat.
export const KNOWN_CLIS = new Set([
  "nmap", "scapy", "wireshark", "tcpdump", "burpsuite", "metasploit", "hydra",
  "nikto", "sqlmap", "gobuster", "dirb", "ffuf", "hashcat", "john",
  "volatility", "autopsy", "binwalk", "ghidra", "radare2", "gdb",
  "apktool", "jadx", "androguard", "frida", "objection",
  "docker", "kubectl", "helm", "terraform", "ansible", "vagrant",
  "aws", "gcloud", "az", "curl", "wget", "jq", "yq",
  "git", "gh", "glab", "npm", "npx", "bun", "pnpm", "yarn",
  "python", "pip", "uv", "uvx", "node", "deno",
  "go", "cargo", "rustc", "rustup", "clippy", "rustfmt", "gcc", "make", "cmake",
  "cargo-watch", "cargo-nextest", "cargo-edit", "cargo-expand", "cargo-machete",
  "cargo-outdated", "cargo-udeps", "cargo-audit", "cargo-deny", "cargo-geiger",
  "cargo-vet", "cargo-crev", "cargo-flamegraph", "cargo-criterion", "cargo-bloat",
  "bacon", "sccache", "wasm-pack", "trunk", "dioxus", "tauri",
  "sqlx", "sea-orm-cli", "diesel", "mdbook", "cross", "just",
  "tokio-console", "cargo-insta", "cargo-fuzz", "cargo-hack", "cargo-mutants",
  "release-plz", "typos", "cargo-chef", "cargo-msrv", "cargo-readme",
  "maturin", "napi", "uniffi-bindgen", "bindgen", "cbindgen",
  "probe-rs", "cargo-embed", "cargo-binutils", "chisel",
  "chromium", "chrome", "google-chrome", "microsoft-edge", "ego-browser",
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

/**
 * Pure parser: extract metadata (domain, tags, one-line description) from a
 * SKILL.md's frontmatter. Used by marketplace discover to suggest which cue
 * profile a repo would fit and what it's good for.
 */
export interface SkillMetadata {
  description: string;  // one-line summary
  domain: string;       // top-level category (e.g. "cybersecurity", "marketing")
  tags: string[];       // free-form tag list
  category: string;     // legacy alias for domain
  name: string;
}

export function parseMetadataFromContent(content: string): SkillMetadata {
  const empty: SkillMetadata = { description: "", domain: "", tags: [], category: "", name: "" };
  if (!content) return empty;
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return empty;
  const yaml = fm[1]!;

  const get = (key: string): string => {
    const m = yaml.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
    return m ? m[1]!.replace(/^["'>|]\s*/, "").replace(/["']$/, "").trim() : "";
  };

  // Tags can be either inline `tags: [a, b]` or YAML list `tags:\n  - a\n  - b`.
  let tags: string[] = [];
  const inline = yaml.match(/^tags:\s*\[([^\]]*)\]/m);
  if (inline) {
    tags = inline[1]!.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  } else {
    const block = yaml.match(/^tags:\s*\n((?:\s+-\s+.+\n?)+)/m);
    if (block) {
      tags = block[1]!.split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    }
  }

  // Multi-line description: handle `description: >-\n  text\n  more text` and `description: |`.
  let description = get("description");
  if (!description) {
    const multi = yaml.match(/^description:\s*[>|]-?\s*\n((?:\s+.+\n?)+)/m);
    if (multi) description = multi[1]!.split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
  }

  return {
    description: description.slice(0, 200),
    domain: get("domain") || get("category"),
    category: get("category") || get("domain"),
    tags,
    name: get("name"),
  };
}

/**
 * Pure parser: extract CLI names from a SKILL.md's raw text. Used by both
 * disk-loading callers and network-fetched content (marketplace discover).
 */
export function parseCLIsFromContent(content: string): string[] {
  const clis: Set<string> = new Set();
  if (!content) return [];

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1]!;
    const toolsMatch = fm.match(/^allowed-tools:\s*(.+)$/m);
    if (toolsMatch) {
      const tools = toolsMatch[1]!;
      const bashTools = tools.match(/Bash\(([^:)]+)/g);
      if (bashTools) {
        for (const bt of bashTools) {
          // Preserve case — Linux binary names are case-sensitive (e.g. `Xvfb`,
          // not `xvfb`). Lowercasing here used to surface false-negatives.
          const cli = bt.replace("Bash(", "").trim().split(" ")[0]!;
          if (cli && cli.toLowerCase() !== "bash") clis.add(cli);
        }
      }
    }
  }

  const prereqMatch = content.match(/## Prerequisites\n([\s\S]*?)(?=\n##|\n$)/);
  if (prereqMatch) {
    const prereqs = prereqMatch[1]!;
    const lines = prereqs.split("\n").filter((l) => l.startsWith("-") || l.startsWith("*"));
    for (const line of lines) {
      const lower = line.toLowerCase();
      for (const cli of KNOWN_CLIS) {
        const re = new RegExp(`\\b${cli}\\b`);
        if (re.test(lower)) clis.add(cli);
      }
    }
  }

  return [...clis];
}

export function extractCLIsFromSkill(skillSlug: string): string[] {
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

  return parseCLIsFromContent(content);
}

/**
 * Expand wildcard skill IDs (containing `*`) to concrete skill IDs on disk.
 * A non-wildcard ID is returned unchanged in a one-element array.
 */
export function expandSkillGlob(id: string): string[] {
  if (!id.includes("*")) return [id];
  const out: string[] = [];
  try {
    for (const cat of readdirSync(SKILLS_ROOT)) {
      const catPath = join(SKILLS_ROOT, cat);
      try {
        for (const skill of readdirSync(catPath)) {
          if (existsSync(join(catPath, skill, "SKILL.md"))) {
            out.push(`${cat}/${skill}`);
          }
        }
      } catch {}
    }
  } catch {}
  try {
    for (const skill of readdirSync(HOME_SKILLS)) {
      if (!out.some((e) => e.endsWith(`/${skill}`))) out.push(skill);
    }
  } catch {}
  return out;
}
