/**
 * `cue benchmark` — measure profile efficiency: token usage, skill coverage,
 * and tool selection accuracy from session transcripts.
 *
 * Usage:
 *   cue benchmark                    # benchmark active profile
 *   cue benchmark --profile backend  # benchmark specific profile
 *   cue benchmark --all              # compare all profiles
 *   cue benchmark --json             # machine-readable output
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { resolveProfileForCwd } from "../lib/cwd-resolver";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface BenchmarkResult {
  profile: string;
  sessions: number;
  totalTokensIn: number;
  totalTokensOut: number;
  avgTokensPerSession: number;
  skillHits: number;
  skillMisses: number;
  hitRate: number;
  topSkills: { name: string; count: number }[];
  unusedSkills: string[];
  estimatedCost: number;
}

function scanSessions(profileName: string): BenchmarkResult {
  const projectsDir = join(homedir(), ".claude", "projects");
  const result: BenchmarkResult = {
    profile: profileName,
    sessions: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    avgTokensPerSession: 0,
    skillHits: 0,
    skillMisses: 0,
    hitRate: 0,
    topSkills: [],
    unusedSkills: [],
    estimatedCost: 0,
  };

  if (!existsSync(projectsDir)) return result;

  const skillUsage = new Map<string, number>();
  const toolCalls = new Map<string, number>();

  // Scan all session files
  const projectDirs = readdirSync(projectsDir).filter(d => {
    const p = join(projectsDir, d);
    try { return statSync(p).isDirectory(); } catch { return false; }
  });

  for (const dir of projectDirs) {
    const fullDir = join(projectsDir, dir);
    const sessions = readdirSync(fullDir).filter(f => f.endsWith(".jsonl"));

    for (const sess of sessions.slice(-10)) { // only last 10 sessions per project
      const sessPath = join(fullDir, sess);
      let content: string;
      try {
        // Read only first 20KB — enough for profile stamp + token usage lines
        const fd = require("node:fs").openSync(sessPath, "r");
        const buf = Buffer.alloc(20_000);
        const n = require("node:fs").readSync(fd, buf, 0, 20_000, 0);
        require("node:fs").closeSync(fd);
        content = buf.toString("utf8", 0, n);
      } catch { continue; }

      const lines = content.split("\n").filter(Boolean);

      let hasProfile = false;
      let sessionTokensIn = 0;
      let sessionTokensOut = 0;

      for (const line of lines) {
        try {
          const msg = JSON.parse(line);

          // Check if this session used our profile
          if (msg.type === "system" && msg.message?.content) {
            const content = typeof msg.message.content === "string"
              ? msg.message.content
              : JSON.stringify(msg.message.content);
            if (content.includes(`profile=${profileName}`)) hasProfile = true;
          }

          // Count tokens
          if (msg.usage) {
            sessionTokensIn += msg.usage.input_tokens ?? 0;
            sessionTokensOut += msg.usage.output_tokens ?? 0;
          }

          // Track tool usage
          if (msg.type === "assistant" && msg.message?.content) {
            const content = Array.isArray(msg.message.content) ? msg.message.content : [];
            for (const block of content) {
              if (block.type === "tool_use") {
                const name = block.name ?? "unknown";
                toolCalls.set(name, (toolCalls.get(name) ?? 0) + 1);
              }
            }
          }

          // Track skill references
          if (msg.type === "assistant" || msg.type === "user") {
            const text = typeof msg.message?.content === "string"
              ? msg.message.content
              : JSON.stringify(msg.message?.content ?? "");
            const skillRefs = text.match(/skills\/[a-z][a-z0-9-]*\/SKILL\.md/g);
            if (skillRefs) {
              for (const ref of skillRefs) {
                const name = ref.replace("skills/", "").replace("/SKILL.md", "");
                skillUsage.set(name, (skillUsage.get(name) ?? 0) + 1);
              }
            }
          }
        } catch {}
      }

      if (hasProfile || profileName === "__all") {
        result.sessions++;
        result.totalTokensIn += sessionTokensIn;
        result.totalTokensOut += sessionTokensOut;
      }
    }
  }

  // Compute metrics
  result.avgTokensPerSession = result.sessions > 0
    ? Math.round((result.totalTokensIn + result.totalTokensOut) / result.sessions)
    : 0;

  // Sonnet pricing: $3/M input, $15/M output
  result.estimatedCost = (result.totalTokensIn * 3 + result.totalTokensOut * 15) / 1_000_000;

  // Skill hit rate
  result.topSkills = [...skillUsage.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  result.skillHits = [...skillUsage.values()].reduce((a, b) => a + b, 0);

  // Load profile to find unused skills
  try {
    const profilePath = join(REPO_ROOT, "profiles", profileName, "profile.yaml");
    if (existsSync(profilePath)) {
      const prof = parseYaml(readFileSync(profilePath, "utf8"));
      const declared = (prof.skills?.local ?? []).map((s: string | { id: string }) =>
        typeof s === "string" ? s.split("/").pop() : s.id.split("/").pop()
      );
      result.unusedSkills = declared.filter((s: string) => !skillUsage.has(s));
    }
  } catch {}

  return result;
}

function formatResult(r: BenchmarkResult): string {
  const lines: string[] = [];
  lines.push(`\x1b[1m${r.profile}\x1b[0m`);
  lines.push(`  Sessions analyzed: ${r.sessions}`);
  lines.push(`  Tokens: ${(r.totalTokensIn / 1000).toFixed(1)}k in / ${(r.totalTokensOut / 1000).toFixed(1)}k out`);
  lines.push(`  Avg per session: ${(r.avgTokensPerSession / 1000).toFixed(1)}k tokens`);
  lines.push(`  Estimated cost: $${r.estimatedCost.toFixed(2)}`);

  if (r.topSkills.length > 0) {
    lines.push(`  Top skills:`);
    for (const s of r.topSkills.slice(0, 5)) {
      lines.push(`    ${s.name} (${s.count}×)`);
    }
  }

  if (r.unusedSkills.length > 0) {
    lines.push(`  Unused skills (${r.unusedSkills.length}): ${r.unusedSkills.slice(0, 5).join(", ")}${r.unusedSkills.length > 5 ? " ..." : ""}`);
  }

  if (r.sessions === 0) {
    lines.push(`  ⚠️  No sessions found for this profile. Use it first, then benchmark.`);
  }

  return lines.join("\n");
}

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue benchmark — measure profile efficiency from session transcripts

Usage:
  cue benchmark                    Benchmark active profile
  cue benchmark --profile <name>   Benchmark specific profile
  cue benchmark --all              Compare all profiles
  cue benchmark --json             Machine-readable output

Metrics:
  - Token usage (input/output per session)
  - Skill hit rate (which skills are actually used)
  - Unused skills (loaded but never triggered)
  - Estimated API cost (Sonnet pricing)
`);
    return 0;
  }

  const json = args.includes("--json");
  const all = args.includes("--all");
  const profileIdx = args.indexOf("--profile");
  let profileName: string | null = profileIdx >= 0 ? args[profileIdx + 1] ?? null : null;

  if (!profileName && !all) {
    try { profileName = await resolveProfileForCwd(process.cwd()); } catch {}
    if (!profileName) {
      process.stderr.write("No active profile. Use --profile <name> or --all.\n");
      return 1;
    }
  }

  if (all) {
    const profilesDir = join(REPO_ROOT, "profiles");
    const profiles = readdirSync(profilesDir)
      .filter(d => !d.startsWith("_") && existsSync(join(profilesDir, d, "profile.yaml")));

    const results = profiles.map(p => scanSessions(p)).filter(r => r.sessions > 0);
    results.sort((a, b) => a.avgTokensPerSession - b.avgTokensPerSession);

    if (json) {
      process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    } else {
      process.stdout.write("🏁 Profile Benchmark (sorted by efficiency)\n\n");
      for (const r of results) {
        process.stdout.write(formatResult(r) + "\n\n");
      }
      if (results.length === 0) {
        process.stdout.write("No session data found. Use profiles first, then benchmark.\n");
      }
    }
  } else {
    const result = scanSessions(profileName!);
    if (json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stdout.write("🏁 Profile Benchmark\n\n");
      process.stdout.write(formatResult(result) + "\n");
    }
  }

  return 0;
}
