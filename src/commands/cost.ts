/**
 * `cue cost [profile]` — estimate token budget for a profile.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadProfile, listProfiles } from "../lib/profile-loader";
import { resolveProfileForCwd } from "../lib/cwd-resolver";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_ROOT = join(REPO_ROOT, "resources", "skills", "skills");

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
const MCP_CONFIGS_DIR = join(REPO_ROOT, "resources", "mcps", "configs");

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function getSkillTokens(id: string): number {
  const path = join(SKILLS_ROOT, id, "SKILL.md");
  try { return estimateTokens(readFileSync(path, "utf8")); } catch { return 0; }
}

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
      const skillTokens = skillIds.reduce((sum: number, id: string) => sum + getSkillTokens(id), 0);
      const mcpIds = profile.mcps.map((m: any) => m.id);
      const mcpToolCount = mcpIds.reduce((sum: number, id: string) => sum + getMcpToolCount(id), 0);
      const total = skillTokens + (mcpToolCount * 50) + 200;
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
    try { profileName = await resolveProfileForCwd(process.cwd()); } catch {
      process.stderr.write("No active profile. Specify one: cue cost <profile>\n");
      return 1;
    }
  }

  const profile = await loadProfile(profileName!);

  // Skills cost
  const skillIds = expandSkillIds(profile.skills.local.map(s => s.id));
  const skillTokens = skillIds.reduce((sum, id) => sum + getSkillTokens(id), 0);

  // MCP cost (tool descriptions)
  const mcpIds = profile.mcps.map(m => m.id);
  const mcpToolCount = mcpIds.reduce((sum, id) => sum + getMcpToolCount(id), 0);
  const mcpTokens = mcpToolCount * 50; // ~50 tokens per tool description

  // CLAUDE.md cost (stamp + shared layers)
  const claudeMdTokens = estimateTokens(
    `Profile: ${profile.name}\n${profile.description}\n`
  ) + 200; // approximate shared claude-md layers

  const total = skillTokens + mcpTokens + claudeMdTokens;

  const result = {
    profile: profileName,
    skills: { count: skillIds.length, tokens: skillTokens },
    mcps: { count: mcpIds.length, tools: mcpToolCount, tokens: mcpTokens },
    claude_md: { tokens: claudeMdTokens },
    total_tokens: total,
  };

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  // Color-coded level
  const level = total > 20000 ? "🔴" : total > 8000 ? "🟡" : "🟢";
  const costPerMsg = (total * 0.000003).toFixed(4); // ~$3/1M input tokens for Sonnet
  const costPer100 = (total * 0.000003 * 100).toFixed(2);

  process.stdout.write(`${level} Token budget for "${profileName}":\n\n`);
  process.stdout.write(`  Skills:    ~${skillTokens.toLocaleString()} tokens (${skillIds.length} skills)\n`);
  process.stdout.write(`  MCPs:      ~${mcpTokens.toLocaleString()} tokens (${mcpToolCount} tools across ${mcpIds.length} servers)\n`);
  process.stdout.write(`  CLAUDE.md: ~${claudeMdTokens.toLocaleString()} tokens\n`);
  process.stdout.write(`  ─────────────────────────────────\n`);
  process.stdout.write(`  Total:     ~${total.toLocaleString()} tokens\n`);
  process.stdout.write(`  Cost:      ~$${costPerMsg}/message, ~$${costPer100}/100 messages\n\n`);

  // Per-skill breakdown (top 5 heaviest)
  const perSkill: { id: string; tokens: number }[] = [];
  for (const id of skillIds) {
    perSkill.push({ id, tokens: getSkillTokens(id) });
  }
  perSkill.sort((a, b) => b.tokens - a.tokens);

  if (perSkill.length > 0) {
    process.stdout.write(`  Heaviest skills:\n`);
    for (const s of perSkill.slice(0, 5)) {
      const pct = total > 0 ? Math.round((s.tokens / total) * 100) : 0;
      const bar = "█".repeat(Math.max(1, Math.round(pct / 5))) + "░".repeat(Math.max(0, 20 - Math.round(pct / 5)));
      process.stdout.write(`    ${s.id.padEnd(35)} ${String(s.tokens).padStart(5)} tok  ${bar} ${pct}%\n`);
    }
    if (perSkill.length > 5) {
      process.stdout.write(`    ... +${perSkill.length - 5} more\n`);
    }
    process.stdout.write("\n");
  }

  // Optimization tips
  if (total > 20000) {
    process.stdout.write(`  💡 Optimization tips:\n`);
    process.stdout.write(`     • Run \`cue skills audit\` to find unused skills\n`);
    process.stdout.write(`     • Remove the heaviest skill: \`cue skills remove-from-profile ${perSkill[0]?.id}\`\n`);
    process.stdout.write(`     • Split into focused sub-profiles that inherit from core\n`);
  } else if (total > 8000) {
    process.stdout.write(`  ℹ️  Moderate overhead. Run \`cue skills audit\` to check for dead weight.\n`);
  } else {
    process.stdout.write(`  ✅ Lean profile. Good token efficiency.\n`);
  }

  return 0;
}
