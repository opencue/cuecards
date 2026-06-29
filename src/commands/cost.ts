/**
 * `cue cost [profile]` — estimate token budget for a profile.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { loadProfile, listProfiles } from "../lib/profile-loader";
import { resolveActiveProfile } from "../lib/cwd-resolver";
import { repoRoot } from "../lib/repo-root";
import {
  skillAlwaysOnTokens,
  skillBodyTokens,
  materializedClaudeMdTokens,
  SKILLS_ROOT,
} from "../lib/profile-metrics";


// Expand wildcard (*/*) to all actual skill IDs on disk.
function expandSkillIds(ids: string[]): string[] {
  const result: string[] = [];
  for (const id of ids) {
    if (id === "*/*") {
      try {
        const cats = readdirSync(SKILLS_ROOT, { withFileTypes: true }).filter(d => d.isDirectory());
        for (const cat of cats) {
          const skills = readdirSync(join(SKILLS_ROOT, cat.name), { withFileTypes: true }).filter(d => d.isDirectory());
          for (const s of skills) {
            if (existsSync(join(SKILLS_ROOT, cat.name, s.name, "SKILL.md"))) {
              result.push(`${cat.name}/${s.name}`);
            }
          }
        }
      } catch {}
    } else if (!id.includes("*")) {
      result.push(id);
    }
  }
  return result;
}
const MCP_CONFIGS_DIR = join(repoRoot(), "resources", "mcps", "configs");

// Baseline always-on CLAUDE.md cost for a profile that hasn't been materialized
// yet. Dominated by the shared `core` persona + integrity protocol, so it's
// roughly constant across profiles. Used only as a fallback when the runtime
// CLAUDE.md can't be measured directly.
const BASE_CLAUDE_MD_TOKENS = 7000;

function getMcpToolCount(id: string): number {
  // Each MCP tool description ≈ 50 tokens
  // We estimate based on the config entry complexity
  for (const file of ["claude_runtime.sanitized.json", "claude.sanitized.json"]) {
    try {
      const raw = JSON.parse(readFileSync(join(MCP_CONFIGS_DIR, file), "utf8"));
      if (raw.servers?.[id]) {
        const entry = JSON.stringify(raw.servers[id]);
        return Math.max(1, Math.ceil(entry.length / 200)); // rough tool count estimate
      }
    } catch { /* skip */ }
  }
  return 1;
}

async function runCompare(json: boolean): Promise<number> {
  const profiles = await listProfiles();
  const results: { name: string; skills: number; mcps: number; tokens: number; cost100: string }[] = [];

  for (const name of profiles) {
    try {
      const profile = await loadProfile(name);
      const skillIds = expandSkillIds(profile.skills.local.map((s: any) => s.id));
      // Always-on cost: skill descriptions (not lazy bodies) + MCP tool
      // descriptions + the materialized CLAUDE.md (or a baseline estimate when
      // the profile hasn't been launched yet).
      const skillTokens = skillIds.reduce((sum: number, id: string) => sum + skillAlwaysOnTokens(id), 0);
      const mcpIds = profile.mcps.map((m: any) => m.id);
      const mcpToolCount = mcpIds.reduce((sum: number, id: string) => sum + getMcpToolCount(id), 0);
      const claudeMd = materializedClaudeMdTokens(name) ?? BASE_CLAUDE_MD_TOKENS;
      const total = skillTokens + (mcpToolCount * 50) + claudeMd;
      results.push({
        name,
        skills: skillIds.length,
        mcps: mcpIds.length,
        tokens: total,
        cost100: (total * 0.000003 * 100).toFixed(2),
      });
    } catch { /* skip broken profiles */ }
  }

  results.sort((a, b) => a.tokens - b.tokens);

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    return 0;
  }

  const maxTokens = results[results.length - 1]?.tokens ?? 1;

  process.stdout.write("📊 Token budget comparison (all profiles)\n\n");
  process.stdout.write(`  ${"Profile".padEnd(20)} ${"Skills".padStart(6)} ${"MCPs".padStart(5)} ${"Tokens".padStart(8)} ${"$/100msg".padStart(8)}  Budget\n`);
  process.stdout.write(`  ${"─".repeat(20)} ${"─".repeat(6)} ${"─".repeat(5)} ${"─".repeat(8)} ${"─".repeat(8)}  ${"─".repeat(20)}\n`);

  for (const r of results) {
    const barLen = Math.max(1, Math.round((r.tokens / maxTokens) * 20));
    const bar = "█".repeat(barLen) + "░".repeat(20 - barLen);
    const level = r.tokens > 20000 ? "🔴" : r.tokens > 8000 ? "🟡" : "🟢";
    process.stdout.write(`  ${r.name.padEnd(20)} ${String(r.skills).padStart(6)} ${String(r.mcps).padStart(5)} ${r.tokens.toLocaleString().padStart(8)} ${"$" + r.cost100.padStart(7)}  ${bar} ${level}\n`);
  }

  process.stdout.write(`\n  ${results.length} profiles compared. Cheapest: ${results[0]?.name}, most expensive: ${results[results.length - 1]?.name}\n`);
  return 0;
}

export async function run(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const compare = args.includes("--compare");
  let profileName = args.find(a => !a.startsWith("-"));

  if (compare) {
    return runCompare(json);
  }

  if (!profileName) {
    profileName = (await resolveActiveProfile()) ?? undefined;
    if (!profileName) {
      process.stderr.write("No active profile. Specify one: cue cost <profile>\n");
      return 1;
    }
  }

  const profile = await loadProfile(profileName);

  // Skills: descriptions are always-on; bodies are lazy (loaded on invoke).
  const skillIds = expandSkillIds(profile.skills.local.map(s => s.id));
  const skillDescTokens = skillIds.reduce((sum, id) => sum + skillAlwaysOnTokens(id), 0);
  const skillLazyTokens = skillIds.reduce((sum, id) => sum + skillBodyTokens(id), 0);

  // MCP cost (tool descriptions, always-on)
  const mcpIds = profile.mcps.map(m => m.id);
  const mcpToolCount = mcpIds.reduce((sum, id) => sum + getMcpToolCount(id), 0);
  const mcpTokens = mcpToolCount * 50; // ~50 tokens per tool description

  // CLAUDE.md: the dominant always-on cost. Measure the materialized runtime
  // when present; otherwise fall back to the shared baseline.
  const claudeMdTokens = materializedClaudeMdTokens(profileName) ?? BASE_CLAUDE_MD_TOKENS;

  const total = skillDescTokens + mcpTokens + claudeMdTokens; // always-on per message

  const result = {
    profile: profileName,
    always_on: {
      skills_desc: skillDescTokens,
      mcps: mcpTokens,
      claude_md: claudeMdTokens,
      total,
    },
    lazy: { skill_bodies: skillLazyTokens, skill_count: skillIds.length },
    skills: { count: skillIds.length },
    mcps: { count: mcpIds.length, tools: mcpToolCount },
    total_tokens: total,
  };

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  // Color-coded level (always-on budget)
  const level = total > 14000 ? "🔴" : total > 9000 ? "🟡" : "🟢";
  const costPerMsg = (total * 0.000003).toFixed(4); // ~$3/1M input tokens for Sonnet
  const costPer100 = (total * 0.000003 * 100).toFixed(2);

  process.stdout.write(`${level} Token budget for "${profileName}":\n\n`);
  process.stdout.write(`  Always-on (every message):\n`);
  process.stdout.write(`    CLAUDE.md:        ~${claudeMdTokens.toLocaleString()} tokens\n`);
  process.stdout.write(`    Skill descriptions: ~${skillDescTokens.toLocaleString()} tokens (${skillIds.length} skills)\n`);
  process.stdout.write(`    MCP tools:        ~${mcpTokens.toLocaleString()} tokens (${mcpToolCount} tools across ${mcpIds.length} servers)\n`);
  process.stdout.write(`    ─────────────────────────────────\n`);
  process.stdout.write(`    Total:            ~${total.toLocaleString()} tokens\n`);
  process.stdout.write(`    Cost:             ~$${costPerMsg}/message, ~$${costPer100}/100 messages\n\n`);
  process.stdout.write(`  Lazy (loaded only when a skill is invoked):\n`);
  process.stdout.write(`    Skill bodies:     ~${skillLazyTokens.toLocaleString()} tokens across ${skillIds.length} skills\n\n`);

  // Per-skill breakdown — by lazy body weight (what you pay when you invoke).
  const perSkill = skillIds.map(id => ({ id, tokens: skillBodyTokens(id) }));
  perSkill.sort((a, b) => b.tokens - a.tokens);

  if (perSkill.length > 0) {
    process.stdout.write(`  Heaviest skill bodies (lazy):\n`);
    for (const s of perSkill.slice(0, 5)) {
      const pct = skillLazyTokens > 0 ? Math.round((s.tokens / skillLazyTokens) * 100) : 0;
      const bar = "█".repeat(Math.max(1, Math.round(pct / 5))) + "░".repeat(Math.max(0, 20 - Math.round(pct / 5)));
      process.stdout.write(`    ${s.id.padEnd(35)} ${String(s.tokens).padStart(5)} tok  ${bar} ${pct}%\n`);
    }
    if (perSkill.length > 5) {
      process.stdout.write(`    ... +${perSkill.length - 5} more\n`);
    }
    process.stdout.write("\n");
  }

  // Optimization tips (based on always-on budget)
  if (total > 14000) {
    process.stdout.write(`  💡 Optimization tips:\n`);
    process.stdout.write(`     • The CLAUDE.md persona/protocol blocks are the biggest always-on cost — trim those first\n`);
    process.stdout.write(`     • Run \`cue skills audit\` to find skills you can drop (frees description tokens + declutters)\n`);
  } else if (total > 9000) {
    process.stdout.write(`  ℹ️  Moderate always-on overhead, mostly CLAUDE.md. Skill bodies above are lazy and don't count per message.\n`);
  } else {
    process.stdout.write(`  ✅ Lean always-on budget. Skill bodies are lazy-loaded, so the catalog size is essentially free.\n`);
  }

  return 0;
}
