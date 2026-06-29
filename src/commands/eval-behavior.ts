/**
 * `cue eval-behavior [profile]` — structural eval harness.
 *
 * Reads `resources/evals/<scenario>.md` files referenced from each profile's
 * `evals:` field, parses each scenario's required + recommended capabilities,
 * and scores the profile by whether it actually has those skills/commands/
 * playbooks/gates loaded.
 *
 * This is a STRUCTURAL eval — it doesn't run an LLM. It answers "is this
 * profile equipped to handle scenario X?", not "did it do well at X?". That's
 * Phase 5 territory and needs LLM-in-the-loop.
 *
 * Output: per-scenario pass/fail + a single summary score per profile.
 */

import { readFileSync, } from "node:fs";
import { join, isAbsolute } from "node:path";
import { homedir } from "node:os";

import { loadProfile, listProfiles } from "../lib/profile-loader";
import { resolveProfileForCwd } from "../lib/cwd-resolver";
import type { ResolvedProfile } from "../../profiles/_types";
import { repoRoot } from "../lib/repo-root";

const EVALS_ROOT = join(repoRoot(), "resources", "evals");

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

interface EvalScenario {
  name: string;
  description: string;
  requiredSkills: string[];
  oneOfCommands: string[];        // any one satisfies
  recommendedPlaybooks: string[];
  recommendedGates: string[];
  triggerPhrases: string[];
}

function parseScenario(path: string): EvalScenario | null {
  let raw: string;
  try { raw = readFileSync(path, "utf8"); } catch { return null; }
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  const name = fm?.[1]?.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? path;
  const description = fm?.[1]?.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";

  const section = (heading: string): string[] => {
    const re = new RegExp(`^##\\s+${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "m");
    const m = raw.match(re);
    if (!m) return [];
    return m[1]!.split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).split("#")[0]!.trim())
      .filter(Boolean);
  };

  return {
    name,
    description,
    requiredSkills: section("Skills"),
    oneOfCommands: section("Commands"),
    recommendedPlaybooks: section("Playbooks"),
    recommendedGates: section("Quality gates"),
    triggerPhrases: section("Trigger phrases"),
  };
}

interface ScenarioResult {
  scenario: string;
  score: number;
  max: number;
  passed: boolean;
  missing: string[];      // human-readable list of what's lacking
}

function scoreScenario(profile: ResolvedProfile, scenario: EvalScenario): ScenarioResult {
  const skillSlugs = new Set(profile.skills.local.map((s) => s.id));
  const commandSet = new Set((profile.commands ?? []).map((c) => c.replace(/\.md$/, "")));
  const playbookSet = new Set(((profile as any).playbooks ?? []).map((p: string) => p.replace(/\.md$/, "")));
  const gateSet = new Set(((profile as any).qualityGates ?? []));

  let score = 0;
  let max = 0;
  const missing: string[] = [];

  for (const req of scenario.requiredSkills) {
    max += 1;
    if (skillSlugs.has(req)) score += 1;
    else missing.push(`skill: ${req}`);
  }

  if (scenario.oneOfCommands.length > 0) {
    max += 1;
    if (scenario.oneOfCommands.some((c) => commandSet.has(c))) score += 1;
    else missing.push(`commands: need any of [${scenario.oneOfCommands.join(", ")}]`);
  }

  for (const pb of scenario.recommendedPlaybooks) {
    max += 1;
    if (playbookSet.has(pb)) score += 1;
    else missing.push(`playbook: ${pb}`);
  }

  for (const gate of scenario.recommendedGates) {
    max += 1;
    if (gateSet.has(gate)) score += 1;
    else missing.push(`quality-gate: ${gate}`);
  }

  // Pass at >= 50%. If max is 0 (scenario declared nothing), trivially passes.
  const passed = max === 0 || score >= Math.ceil(max / 2);
  return { scenario: scenario.name, score, max, passed, missing };
}

async function evalProfile(name: string): Promise<{ profile: string; results: ScenarioResult[] }> {
  const profile = await loadProfile(name);
  const evalRefs = ((profile as any).evals ?? []) as string[];
  const results: ScenarioResult[] = [];
  for (const ref of evalRefs) {
    const path = isAbsolute(ref) ? ref : join(EVALS_ROOT, ref.endsWith(".md") ? ref : `${ref}.md`);
    const scenario = parseScenario(path);
    if (!scenario) {
      results.push({ scenario: ref, score: 0, max: 0, passed: false, missing: [`scenario file not found: ${path}`] });
      continue;
    }
    results.push(scoreScenario(profile, scenario));
  }
  return { profile: name, results };
}

export async function run(args: string[]): Promise<number> {
  const asJson = args.includes("--json");
  const all = args.includes("--all");

  let profiles: string[];
  if (all) {
    profiles = await listProfiles();
  } else {
    const explicit = args.find((a) => !a.startsWith("-"));
    if (explicit) profiles = [explicit];
    else {
      try {
        const r = await resolveProfileForCwd({ cwd: process.cwd(), homeDir: homedir(), configDir: join(homedir(), ".config", "cue") });
        if (r.source === "none") {
          process.stderr.write("Usage: cue eval-behavior [profile] | --all\n");
          return 1;
        }
        profiles = [(r as any).profile];
      } catch {
        process.stderr.write("Usage: cue eval-behavior [profile] | --all\n");
        return 1;
      }
    }
  }

  const reports = await Promise.all(profiles.map(evalProfile));

  if (asJson) {
    process.stdout.write(JSON.stringify(reports, null, 2) + "\n");
    return 0;
  }

  let anyFail = 0;
  for (const r of reports) {
    if (r.results.length === 0) {
      process.stdout.write(`\n  ${dim("·")} ${r.profile} ${dim("(no evals declared)")}\n`);
      continue;
    }
    const passed = r.results.filter((s) => s.passed).length;
    const total = r.results.length;
    const tag = passed === total ? green(`PASS ${passed}/${total}`) : red(`FAIL ${passed}/${total}`);
    process.stdout.write(`\n  ${bold(r.profile)}  ${tag}\n`);
    for (const sc of r.results) {
      const mark = sc.passed ? green("✓") : red("✗");
      const pct = sc.max > 0 ? `(${sc.score}/${sc.max})` : "(no checks)";
      process.stdout.write(`    ${mark} ${sc.scenario.padEnd(20)} ${dim(pct)}\n`);
      if (!sc.passed && sc.missing.length > 0) {
        for (const m of sc.missing.slice(0, 5)) process.stdout.write(`        ${yellow("→")} ${m}\n`);
      }
    }
    if (passed < total) anyFail++;
  }
  process.stdout.write("\n");
  return anyFail > 0 ? 1 : 0;
}
