/**
 * `cue cost [profile]` — estimate token budget for a profile.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { loadProfile, listProfiles } from "../lib/profile-loader";
import { resolveActiveProfile } from "../lib/cwd-resolver";
import {
  skillAlwaysOnTokens,
  skillBodyTokens,
  materializedClaudeMdTokens,
  SKILLS_ROOT,
} from "../lib/profile-metrics";
import {
  loadMcpEstimates,
  sumMcpTokens,
  budgetExceeded,
} from "../lib/mcp-token-estimate";

/**
 * Parse `--budget N` / `--budget=N`. Returns the value (0 = gate off when
 * absent/invalid) and the arg index the value was consumed from (-1 for the
 * `=` form or none), so the caller can exclude a space-separated value from
 * profile-name detection — `Number("0")||0` is falsy, so matching by string
 * would misread `--budget 0 myprofile` as profile "0".
 */
function parseBudget(args: string[]): { value: number; valueIdx: number } {
  const toNum = (raw: string): number => {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  };
  const eq = args.find((a) => a.startsWith("--budget="));
  if (eq) return { value: toNum(eq.slice("--budget=".length)), valueIdx: -1 };
  const i = args.indexOf("--budget");
  // The value must be a number; a following flag (e.g. `--budget --json`) is not.
  if (i >= 0 && i + 1 < args.length && !args[i + 1].startsWith("-")) {
    return { value: toNum(args[i + 1]), valueIdx: i + 1 };
  }
  return { value: 0, valueIdx: -1 };
}

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
// Baseline always-on CLAUDE.md cost for a profile that hasn't been materialized
// yet. Dominated by the shared `core` persona + integrity protocol, so it's
// roughly constant across profiles. Used only as a fallback when the runtime
// CLAUDE.md can't be measured directly.
const BASE_CLAUDE_MD_TOKENS = 7000;

async function runCompare(json: boolean, budget: number): Promise<number> {
  const mcpCache = loadMcpEstimates();
  const profiles = await listProfiles();
  const results: { name: string; skills: number; mcps: number; tokens: number; cost100: string; over_budget?: boolean }[] = [];

  for (const name of profiles) {
    try {
      const profile = await loadProfile(name);
      const skillIds = expandSkillIds(profile.skills.local.map((s: any) => s.id));
      // Always-on cost: skill descriptions (not lazy bodies) + MCP tool
      // descriptions + the materialized CLAUDE.md (or a baseline estimate when
      // the profile hasn't been launched yet).
      const skillTokens = skillIds.reduce((sum: number, id: string) => sum + skillAlwaysOnTokens(id), 0);
      const mcpIds = profile.mcps.map((m: any) => m.id);
      const mcpTokens = sumMcpTokens(mcpIds, mcpCache).total;
      const claudeMd = materializedClaudeMdTokens(name) ?? BASE_CLAUDE_MD_TOKENS;
      const total = skillTokens + mcpTokens + claudeMd;
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

  // The budget gate applies to both human and --json output so CI can use either.
  // Annotate each row with over_budget (when a budget is set) so a --json consumer
  // can identify which profiles tripped the gate, not just read the exit code.
  if (budget > 0) {
    for (const r of results) r.over_budget = budgetExceeded(r.tokens, budget);
  }
  const overBudget = results.filter((r) => r.over_budget);

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    return overBudget.length > 0 ? 1 : 0;
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

  if (budget > 0) {
    if (overBudget.length > 0) {
      process.stderr.write(
        `\n  ❌ ${overBudget.length} profile(s) over the ${budget.toLocaleString()}-token budget: ` +
          `${overBudget.map((r) => `${r.name} (${r.tokens.toLocaleString()})`).join(", ")}\n`,
      );
      return 1;
    }
    process.stdout.write(`\n  ✅ All ${results.length} profiles within the ${budget.toLocaleString()}-token budget.\n`);
  }
  return 0;
}

export async function run(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const compare = args.includes("--compare");
  // A space-separated `--budget N` consumes args[valueIdx]; exclude that exact
  // index from profile-name detection (string-matching breaks when N is "0").
  const { value: budget, valueIdx: budgetValueIdx } = parseBudget(args);
  let profileName = args.find((a, idx) => !a.startsWith("-") && idx !== budgetValueIdx);

  if (compare) {
    return runCompare(json, budget);
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

  // MCP cost: tool schemas injected into the system prompt, always-on. Real
  // sizes live in each server's tools/list, which cue can't read statically, so
  // this is cache-backed (seed estimates → probed measurements override).
  const mcpIds = profile.mcps.map(m => m.id);
  const mcpCache = loadMcpEstimates();
  const mcp = sumMcpTokens(mcpIds, mcpCache);
  const mcpTokens = mcp.total;

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
    mcps: {
      count: mcpIds.length,
      tokens: mcpTokens,
      measured: mcp.measured.length,
      estimated: mcp.estimated.length,
      unknown: mcp.unknown.length,
    },
    total_tokens: total,
    budget: budget > 0 ? { limit: budget, over: budgetExceeded(total, budget) } : undefined,
  };

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return budgetExceeded(total, budget) ? 1 : 0;
  }

  // Color-coded level (always-on budget)
  const level = total > 14000 ? "🔴" : total > 9000 ? "🟡" : "🟢";
  const costPerMsg = (total * 0.000003).toFixed(4); // ~$3/1M input tokens for Sonnet
  const costPer100 = (total * 0.000003 * 100).toFixed(2);

  process.stdout.write(`${level} Token budget for "${profileName}":\n\n`);
  process.stdout.write(`  Always-on (every message):\n`);
  process.stdout.write(`    CLAUDE.md:        ~${claudeMdTokens.toLocaleString()} tokens\n`);
  process.stdout.write(`    Skill descriptions: ~${skillDescTokens.toLocaleString()} tokens (${skillIds.length} skills)\n`);
  const mcpProvenance = mcp.unknown.length > 0
    ? ` — ${mcp.unknown.length} unmeasured, run \`cue cost --probe-mcp\``
    : mcp.measured.length === 0 ? " — estimated" : "";
  process.stdout.write(`    MCP tools:        ~${mcpTokens.toLocaleString()} tokens (${mcpIds.length} servers${mcpProvenance})\n`);
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

  if (budget > 0) {
    if (budgetExceeded(total, budget)) {
      process.stderr.write(`\n  ❌ Over budget: ${total.toLocaleString()} > ${budget.toLocaleString()} tokens\n`);
      return 1;
    }
    process.stdout.write(`\n  ✅ Within budget: ${total.toLocaleString()} ≤ ${budget.toLocaleString()} tokens\n`);
  }

  return 0;
}
