/**
 * `cue eval [profile] [--breakdown] [--compare a b] [--json]`
 *
 * Measures the per-message token overhead a profile drops into context.
 *
 * Honest math (after the followup refactor):
 *   - **perMessage**: what Claude actually sees on every turn — skill
 *     descriptions (frontmatter only), the list of rule/command names from the
 *     CLAUDE.md stamp, and a tiny constant for hooks (the matcher block in
 *     settings.json, NOT the script body which runs server-side).
 *   - **onDemand**: lazy-loaded bodies — full skill content, full rule files,
 *     full command files. Read only when the model invokes them.
 *
 * The old combined "total" lives on as `bytesOnDisk` for context, but the
 * cost-per-message and the score now use perMessage so they reflect reality.
 */

import { join, isAbsolute } from "node:path";
import { readFileSync, } from "node:fs";
import { homedir } from "node:os";

import { loadProfile, listProfiles } from "../lib/profile-loader";
import { resolveProfileForCwd } from "../lib/cwd-resolver";
import { computeStats } from "../lib/analytics";
import type { ResolvedProfile } from "../../profiles/_types";
import { repoRoot } from "../lib/repo-root";

const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");
const RULES_ROOT = join(repoRoot(), "resources", "rules");
const COMMANDS_ROOT = join(repoRoot(), "resources", "commands");
const HOOKS_ROOT = join(repoRoot(), "resources", "hooks");

// Approximate fixed per-message cost of one hook entry in settings.json
// (matcher + command path + description). Hook scripts themselves never enter
// the model's context.
const HOOK_PER_MSG_TOKENS = 30;

interface Bucket {
  perMessage: number;
  onDemand: number;
}

interface Breakdown {
  skills: Bucket;
  rules: Bucket;
  commands: Bucket;
  hooks: Bucket;
  perMessageTotal: number;
  onDemandTotal: number;
}

function bytesToTokens(n: number): number { return Math.ceil(n / 4); }

function readFileSafe(path: string): string | null {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

/**
 * SKILL.md description: yaml frontmatter at the top. That's all the model
 * needs to know whether to invoke the skill. The rest is read on demand.
 */
function skillDescriptionTokens(skillId: string): { perMsg: number; onDemand: number } {
  const body = readFileSafe(join(SKILLS_ROOT, skillId, "SKILL.md"));
  if (!body) return { perMsg: 0, onDemand: 0 };
  // Frontmatter is between the first two `---` lines.
  const fm = body.match(/^---\n([\s\S]*?)\n---/);
  const perMsg = fm ? bytesToTokens(fm[0].length) : bytesToTokens(Math.min(body.length, 200));
  const onDemand = Math.max(0, bytesToTokens(body.length) - perMsg);
  return { perMsg, onDemand };
}

function resolveRef(ref: string, base: string, addExt: boolean): string {
  const withExt = addExt && !ref.endsWith(".md") ? `${ref}.md` : ref;
  return isAbsolute(withExt) ? withExt : join(base, withExt);
}

/**
 * Per-rule and per-command per-message cost: just the index line we write
 * into CLAUDE.md (e.g. `- \`rules/security.md\``). Conservative estimate.
 */
const RULE_INDEX_LINE_TOKENS = 12;
const COMMAND_INDEX_LINE_TOKENS = 6;

function computeBreakdown(p: ResolvedProfile): Breakdown {
  let skillsPerMsg = 0, skillsOnDemand = 0;
  for (const s of p.skills.local) {
    if (s.id.includes("*")) continue;
    const { perMsg, onDemand } = skillDescriptionTokens(s.id);
    skillsPerMsg += perMsg;
    skillsOnDemand += onDemand;
  }
  let rulesPerMsg = 0, rulesOnDemand = 0;
  for (const r of (p.rules ?? [])) {
    rulesPerMsg += RULE_INDEX_LINE_TOKENS;
    const body = readFileSafe(resolveRef(r, RULES_ROOT, true));
    if (body) rulesOnDemand += bytesToTokens(body.length);
  }
  let cmdsPerMsg = 0, cmdsOnDemand = 0;
  for (const c of (p.commands ?? [])) {
    cmdsPerMsg += COMMAND_INDEX_LINE_TOKENS;
    const body = readFileSafe(resolveRef(c, COMMANDS_ROOT, true));
    if (body) cmdsOnDemand += bytesToTokens(body.length);
  }
  let hooksPerMsg = 0, hooksOnDemand = 0;
  for (const h of (p.hooks ?? [])) {
    hooksPerMsg += HOOK_PER_MSG_TOKENS;
    const body = readFileSafe(resolveRef(h, HOOKS_ROOT, false));
    if (body) hooksOnDemand += bytesToTokens(body.length);
  }
  const perMessageTotal = skillsPerMsg + rulesPerMsg + cmdsPerMsg + hooksPerMsg;
  const onDemandTotal = skillsOnDemand + rulesOnDemand + cmdsOnDemand + hooksOnDemand;
  return {
    skills:   { perMessage: skillsPerMsg, onDemand: skillsOnDemand },
    rules:    { perMessage: rulesPerMsg,  onDemand: rulesOnDemand },
    commands: { perMessage: cmdsPerMsg,   onDemand: cmdsOnDemand },
    hooks:    { perMessage: hooksPerMsg,  onDemand: hooksOnDemand },
    perMessageTotal, onDemandTotal,
  };
}

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function fmtTok(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;
}
function cost(n: number): string { return `$${((n / 1000) * 0.003).toFixed(4)}`; }

function scoreOf(p: ResolvedProfile, b: Breakdown, fullPerMsg: number, sessions: number): number {
  const savings = fullPerMsg > 0 ? Math.max(0, Math.round((1 - b.perMessageTotal / fullPerMsg) * 100)) : 0;
  return Math.min(100, Math.round(
    (savings * 0.4) +
    (Math.min(sessions, 20) / 20 * 30) +
    (p.mcps.length > 0 ? 15 : 0) +
    (p.plugins.length > 0 ? 15 : 0)
  ));
}

function grade(score: number): { letter: string; color: (s: string) => string } {
  if (score >= 90) return { letter: "A", color: green };
  if (score >= 75) return { letter: "B", color: green };
  if (score >= 60) return { letter: "C", color: yellow };
  if (score >= 40) return { letter: "D", color: yellow };
  return { letter: "F", color: red };
}

async function fullProfilePerMessage(): Promise<number> {
  try {
    const full = await loadProfile("full");
    return computeBreakdown(full).perMessageTotal;
  } catch { return 0; }
}

function sessionsFor(name: string): number {
  return computeStats().find((s) => s.profile === name)?.sessions ?? 0;
}

async function renderOne(name: string, showBreakdown: boolean, asJson: boolean): Promise<number> {
  const profile = await loadProfile(name);
  const b = computeBreakdown(profile);
  const sessions = sessionsFor(name);
  const fullPerMsg = await fullProfilePerMessage();
  const savings = fullPerMsg > 0 ? Math.max(0, Math.round((1 - b.perMessageTotal / fullPerMsg) * 100)) : 0;
  const score = scoreOf(profile, b, fullPerMsg, sessions);
  const g = grade(score);

  if (asJson) {
    process.stdout.write(JSON.stringify({
      profile: name,
      counts: {
        skills: profile.skills.local.length + profile.skills.npx.length,
        rules: (profile.rules ?? []).length,
        commands: (profile.commands ?? []).length,
        hooks: (profile.hooks ?? []).length,
        mcps: profile.mcps.length,
        plugins: profile.plugins.length,
      },
      tokens: {
        perMessage: b.perMessageTotal,
        onDemand: b.onDemandTotal,
        bySource: {
          skills:   b.skills,
          rules:    b.rules,
          commands: b.commands,
          hooks:    b.hooks,
        },
      },
      fullPerMessage: fullPerMsg,
      savingsPct: savings,
      costPerMessage: cost(b.perMessageTotal),
      sessions,
      score,
      grade: g.letter,
    }, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(`\n  ${bold("Profile Eval:")} ${name}\n\n`);
  process.stdout.write(`  ${bold("Loadout")}\n`);
  process.stdout.write(`    Skills: ${profile.skills.local.length}  Rules: ${(profile.rules ?? []).length}  Commands: ${(profile.commands ?? []).length}  Hooks: ${(profile.hooks ?? []).length}  MCPs: ${profile.mcps.length}  Plugins: ${profile.plugins.length}\n`);
  process.stdout.write(`    Per-message: ${green(fmtTok(b.perMessageTotal))} tokens  (${cost(b.perMessageTotal)}/msg)\n`);
  process.stdout.write(`    On-demand:   ${dim(fmtTok(b.onDemandTotal) + " tokens (lazy — only when invoked)")}\n\n`);

  if (showBreakdown) {
    process.stdout.write(`  ${bold("Breakdown (per-message tokens)")}\n`);
    const rows: [string, Bucket][] = [
      ["skills",   b.skills],
      ["rules",    b.rules],
      ["commands", b.commands],
      ["hooks",    b.hooks],
    ];
    const max = Math.max(1, ...rows.map(([, v]) => v.perMessage));
    for (const [label, bucket] of rows) {
      const pct = b.perMessageTotal > 0 ? Math.round((bucket.perMessage / b.perMessageTotal) * 100) : 0;
      const bar = "█".repeat(Math.round((bucket.perMessage / max) * 20));
      const ondem = bucket.onDemand > 0 ? dim(`  (+${fmtTok(bucket.onDemand)} on-demand)`) : "";
      process.stdout.write(`    ${label.padEnd(9)} ${fmtTok(bucket.perMessage).padStart(6)}  ${dim(`${pct}%`)}  ${bar}${ondem}\n`);
    }
    process.stdout.write(`    ${dim("on-demand bodies stay resident for the rest of the session once read")}\n\n`);
  }

  process.stdout.write(`  ${bold("Efficiency vs full")}\n`);
  process.stdout.write(`    This: ${fmtTok(b.perMessageTotal)}    Full: ${fmtTok(fullPerMsg)}    ${green(`Savings: ${savings}%`)}\n\n`);

  process.stdout.write(`  ${bold("Usage")}  Sessions: ${sessions}\n`);
  process.stdout.write(`\n  ${bold("Score:")} ${g.color(`${score}/100 (${g.letter})`)}\n`);
  process.stdout.write(`  ${dim("40% savings + 30% usage + 15% MCPs + 15% plugins")}\n\n`);
  return 0;
}

async function renderCompare(a: string, b: string, asJson: boolean): Promise<number> {
  const [pa, pb] = await Promise.all([loadProfile(a), loadProfile(b)]);
  const [ba, bb] = [computeBreakdown(pa), computeBreakdown(pb)];
  const fullPerMsg = await fullProfilePerMessage();
  const [sa, sb] = [sessionsFor(a), sessionsFor(b)];
  const [scA, scB] = [scoreOf(pa, ba, fullPerMsg, sa), scoreOf(pb, bb, fullPerMsg, sb)];

  if (asJson) {
    process.stdout.write(JSON.stringify({
      a: { profile: a, tokens: { perMessage: ba.perMessageTotal, onDemand: ba.onDemandTotal }, sessions: sa, score: scA },
      b: { profile: b, tokens: { perMessage: bb.perMessageTotal, onDemand: bb.onDemandTotal }, sessions: sb, score: scB },
      delta: { perMessage: bb.perMessageTotal - ba.perMessageTotal, score: scB - scA },
    }, null, 2) + "\n");
    return 0;
  }

  const fmtRow = (label: string, va: string, vb: string) =>
    `    ${label.padEnd(14)} ${va.padStart(10)}    ${vb.padStart(10)}\n`;

  process.stdout.write(`\n  ${bold("Compare:")} ${a}  vs  ${b}\n\n`);
  process.stdout.write(`    ${"".padEnd(14)} ${a.padStart(10)}    ${b.padStart(10)}\n`);
  process.stdout.write(`    ${"".padEnd(14)} ${"-".repeat(10)}    ${"-".repeat(10)}\n`);
  process.stdout.write(fmtRow("skills",     String(pa.skills.local.length), String(pb.skills.local.length)));
  process.stdout.write(fmtRow("rules",      String((pa.rules ?? []).length),    String((pb.rules ?? []).length)));
  process.stdout.write(fmtRow("commands",   String((pa.commands ?? []).length), String((pb.commands ?? []).length)));
  process.stdout.write(fmtRow("hooks",      String((pa.hooks ?? []).length),    String((pb.hooks ?? []).length)));
  process.stdout.write(fmtRow("mcps",       String(pa.mcps.length),         String(pb.mcps.length)));
  process.stdout.write(fmtRow("per-msg",    fmtTok(ba.perMessageTotal),     fmtTok(bb.perMessageTotal)));
  process.stdout.write(fmtRow("on-demand",  fmtTok(ba.onDemandTotal),       fmtTok(bb.onDemandTotal)));
  process.stdout.write(fmtRow("cost/msg",   cost(ba.perMessageTotal),       cost(bb.perMessageTotal)));
  process.stdout.write(fmtRow("sessions",   String(sa),                     String(sb)));
  const ga = grade(scA), gb = grade(scB);
  process.stdout.write(fmtRow("score",      ga.color(`${scA} (${ga.letter})`), gb.color(`${scB} (${gb.letter})`)));
  const delta = bb.perMessageTotal - ba.perMessageTotal;
  const arrow = delta > 0 ? red(`+${fmtTok(delta)}`) : delta < 0 ? green(`-${fmtTok(-delta)}`) : dim("0");
  process.stdout.write(`\n  ${dim(`${b} uses ${arrow} tokens per message vs ${a}`)}\n\n`);
  return 0;
}

async function renderAll(asJson: boolean): Promise<number> {
  const names = await listProfiles();
  const fullPerMsg = await fullProfilePerMessage();
  const rows = await Promise.all(names.map(async (n) => {
    try {
      const p = await loadProfile(n);
      const b = computeBreakdown(p);
      const sessions = sessionsFor(n);
      const score = scoreOf(p, b, fullPerMsg, sessions);
      return { name: n, perMessage: b.perMessageTotal, onDemand: b.onDemandTotal, sessions, score, ok: true as const };
    } catch (e) {
      return { name: n, perMessage: 0, onDemand: 0, sessions: 0, score: 0, ok: false as const, error: String(e) };
    }
  }));
  // Sort by per-message ascending — leanest first.
  rows.sort((a, b) => a.perMessage - b.perMessage);

  if (asJson) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(`\n  ${bold("All Profiles")} (sorted by per-message tokens)\n\n`);
  process.stdout.write(`    ${"profile".padEnd(20)}  ${"per-msg".padStart(8)}  ${"on-demand".padStart(10)}  ${"sessions".padStart(8)}  ${"score".padStart(7)}\n`);
  process.stdout.write(`    ${"-".repeat(20)}  ${"-".repeat(8)}  ${"-".repeat(10)}  ${"-".repeat(8)}  ${"-".repeat(7)}\n`);
  for (const r of rows) {
    if (!r.ok) {
      process.stdout.write(`    ${r.name.padEnd(20)}  ${red("error".padStart(8))}\n`);
      continue;
    }
    const g = grade(r.score);
    process.stdout.write(
      `    ${r.name.padEnd(20)}  ` +
      `${fmtTok(r.perMessage).padStart(8)}  ` +
      `${dim(fmtTok(r.onDemand).padStart(10))}  ` +
      `${String(r.sessions).padStart(8)}  ` +
      `${g.color(`${r.score} (${g.letter})`.padStart(7))}\n`
    );
  }
  process.stdout.write("\n");
  return 0;
}

export async function run(args: string[]): Promise<number> {
  const asJson = args.includes("--json");
  const breakdown = args.includes("--breakdown");
  const all = args.includes("--all");
  const compareIdx = args.indexOf("--compare");
  const positional = args.filter((a) => !a.startsWith("-"));

  if (all) return renderAll(asJson);

  if (compareIdx >= 0) {
    const a = args[compareIdx + 1];
    const b = args[compareIdx + 2];
    if (!a || !b || a.startsWith("-") || b.startsWith("-")) {
      process.stderr.write("Usage: cue eval --compare <profile-a> <profile-b>\n");
      return 1;
    }
    return renderCompare(a, b, asJson);
  }

  let profileName = positional[0];
  if (!profileName) {
    try {
      const resolved = await resolveProfileForCwd({ cwd: process.cwd(), homeDir: homedir(), configDir: join(homedir(), ".config", "cue") });
      if (resolved.source !== "none") profileName = (resolved as any).profile;
    } catch {}
  }
  if (!profileName) {
    process.stderr.write("Usage: cue eval [profile] [--breakdown] [--all] [--compare a b] [--json]\n");
    return 1;
  }
  return renderOne(profileName, breakdown, asJson);
}
