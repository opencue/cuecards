/**
 * `cue diff <profileA> <profileB>` — compare two profiles.
 * `cue diff --live <target>` — show impact of switching from current to target.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadProfile } from "../lib/profile-loader";
import { resolveProfileForCwd } from "../lib/cwd-resolver";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_ROOT = join(REPO_ROOT, "resources", "skills", "skills");

function estimateTokens(text: string): number { return Math.ceil(text.length / 4); }
function getSkillTokens(id: string): number {
  try { return estimateTokens(readFileSync(join(SKILLS_ROOT, id, "SKILL.md"), "utf8")); } catch { return 0; }
}

export async function run(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const live = args.includes("--live");
  const names = args.filter(a => !a.startsWith("-"));

  if (live) {
    return runLive(names[0], json);
  }

  if (names.length < 2) {
    process.stderr.write("Usage: cue diff <profileA> <profileB>\n");
    return 1;
  }

  const [nameA, nameB] = names;
  let profileA, profileB;
  try { profileA = await loadProfile(nameA!); } catch (e) { process.stderr.write(`${e}\n`); return 1; }
  try { profileB = await loadProfile(nameB!); } catch (e) { process.stderr.write(`${e}\n`); return 1; }

  const skillsA = new Set(profileA.skills.local.map(s => s.id));
  const skillsB = new Set(profileB.skills.local.map(s => s.id));
  const mcpsA = new Set(profileA.mcps.map(m => m.id));
  const mcpsB = new Set(profileB.mcps.map(m => m.id));
  const pluginsA = new Set(profileA.plugins.map(p => p.id));
  const pluginsB = new Set(profileB.plugins.map(p => p.id));

  const diff = {
    skills: {
      onlyA: [...skillsA].filter(s => !skillsB.has(s)),
      onlyB: [...skillsB].filter(s => !skillsA.has(s)),
      both: [...skillsA].filter(s => skillsB.has(s)),
    },
    mcps: {
      onlyA: [...mcpsA].filter(m => !mcpsB.has(m)),
      onlyB: [...mcpsB].filter(m => !mcpsA.has(m)),
      both: [...mcpsA].filter(m => mcpsB.has(m)),
    },
    plugins: {
      onlyA: [...pluginsA].filter(p => !pluginsB.has(p)),
      onlyB: [...pluginsB].filter(p => !pluginsA.has(p)),
      both: [...pluginsA].filter(p => pluginsB.has(p)),
    },
    env: {
      onlyA: Object.keys(profileA.env).filter(k => !(k in profileB.env)),
      onlyB: Object.keys(profileB.env).filter(k => !(k in profileA.env)),
      different: Object.keys(profileA.env).filter(k => k in profileB.env && profileA.env[k] !== profileB.env[k]),
    },
  };

  if (json) {
    process.stdout.write(JSON.stringify(diff, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(`Comparing: ${nameA} ↔ ${nameB}\n\n`);

  // Skills
  process.stdout.write("Skills:\n");
  for (const s of diff.skills.onlyA) process.stdout.write(`  - ${s}  (only in ${nameA})\n`);
  for (const s of diff.skills.onlyB) process.stdout.write(`  + ${s}  (only in ${nameB})\n`);
  if (diff.skills.both.length) process.stdout.write(`  = ${diff.skills.both.length} shared\n`);
  if (!diff.skills.onlyA.length && !diff.skills.onlyB.length) process.stdout.write("  (identical)\n");

  // MCPs
  process.stdout.write("\nMCPs:\n");
  for (const m of diff.mcps.onlyA) process.stdout.write(`  - ${m}  (only in ${nameA})\n`);
  for (const m of diff.mcps.onlyB) process.stdout.write(`  + ${m}  (only in ${nameB})\n`);
  if (diff.mcps.both.length) process.stdout.write(`  = ${diff.mcps.both.length} shared\n`);
  if (!diff.mcps.onlyA.length && !diff.mcps.onlyB.length) process.stdout.write("  (identical)\n");

  // Plugins
  process.stdout.write("\nPlugins:\n");
  for (const p of diff.plugins.onlyA) process.stdout.write(`  - ${p}  (only in ${nameA})\n`);
  for (const p of diff.plugins.onlyB) process.stdout.write(`  + ${p}  (only in ${nameB})\n`);
  if (!diff.plugins.onlyA.length && !diff.plugins.onlyB.length) process.stdout.write("  (identical)\n");

  // Env
  if (diff.env.onlyA.length || diff.env.onlyB.length || diff.env.different.length) {
    process.stdout.write("\nEnv:\n");
    for (const k of diff.env.onlyA) process.stdout.write(`  - ${k}=${profileA.env[k]}  (only in ${nameA})\n`);
    for (const k of diff.env.onlyB) process.stdout.write(`  + ${k}=${profileB.env[k]}  (only in ${nameB})\n`);
    for (const k of diff.env.different) process.stdout.write(`  ~ ${k}: "${profileA.env[k]}" → "${profileB.env[k]}"\n`);
  }

  return 0;
}

async function runLive(target: string | undefined, json: boolean): Promise<number> {
  let current: string;
  try {
    const result = await resolveProfileForCwd({ cwd: process.cwd(), homeDir: require("node:os").homedir(), configDir: join(require("node:os").homedir(), ".config", "cue") });
    if (result.source === "none") throw new Error("none");
    current = result.profile;
  } catch {
    process.stderr.write("No active profile. Use: cue diff <current> <target>\n");
    return 1;
  }
  if (!target) {
    process.stderr.write("Usage: cue diff --live <target-profile>\n");
    return 1;
  }

  let profileA, profileB;
  try { profileA = await loadProfile(current); } catch (e) { process.stderr.write(`${e}\n`); return 1; }
  try { profileB = await loadProfile(target); } catch (e) { process.stderr.write(`${e}\n`); return 1; }

  const skillsA = new Set(profileA.skills.local.map(s => s.id));
  const skillsB = new Set(profileB.skills.local.map(s => s.id));
  const mcpsA = new Set(profileA.mcps.map(m => m.id));
  const mcpsB = new Set(profileB.mcps.map(m => m.id));

  const removed = [...skillsA].filter(s => !skillsB.has(s));
  const added = [...skillsB].filter(s => !skillsA.has(s));
  const mcpsRemoved = [...mcpsA].filter(m => !mcpsB.has(m));
  const mcpsAdded = [...mcpsB].filter(m => !mcpsA.has(m));

  const tokensA = [...skillsA].reduce((sum, id) => sum + getSkillTokens(id), 0) + 200;
  const tokensB = [...skillsB].reduce((sum, id) => sum + getSkillTokens(id), 0) + 200;
  const tokenDiff = tokensB - tokensA;
  const costDiff = (tokenDiff * 0.000003 * 100); // per 100 messages

  if (json) {
    process.stdout.write(JSON.stringify({
      from: current, to: target,
      skills: { removed, added, removedCount: removed.length, addedCount: added.length },
      mcps: { removed: mcpsRemoved, added: mcpsAdded },
      tokens: { from: tokensA, to: tokensB, diff: tokenDiff },
      costPer100: costDiff,
    }, null, 2) + "\n");
    return 0;
  }

  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

  process.stdout.write(`\n  Switching: ${bold(current)} → ${bold(target)}\n\n`);

  // Summary line
  const parts: string[] = [];
  if (removed.length) parts.push(red(`-${removed.length} skills`));
  if (added.length) parts.push(green(`+${added.length} skills`));
  if (mcpsRemoved.length) parts.push(red(`-${mcpsRemoved.length} MCPs`));
  if (mcpsAdded.length) parts.push(green(`+${mcpsAdded.length} MCPs`));
  process.stdout.write(`  ${parts.join(", ")}\n`);

  // Token impact
  const arrow = tokenDiff < 0 ? green(`↓ saves ${Math.abs(tokenDiff).toLocaleString()} tokens/session`) :
    tokenDiff > 0 ? red(`↑ adds ${tokenDiff.toLocaleString()} tokens/session`) : "no change";
  process.stdout.write(`  ${arrow}\n`);

  if (tokenDiff !== 0) {
    const costStr = costDiff < 0 ? green(`saves $${Math.abs(costDiff).toFixed(2)}`) : red(`costs $${costDiff.toFixed(2)} more`);
    process.stdout.write(`  ${costStr} per 100 messages\n`);
  }

  // Details
  if (removed.length > 0) {
    process.stdout.write(`\n  ${red("Removed skills:")}\n`);
    for (const s of removed.slice(0, 10)) process.stdout.write(`    - ${s}\n`);
    if (removed.length > 10) process.stdout.write(`    ${dim(`...+${removed.length - 10} more`)}\n`);
  }
  if (added.length > 0) {
    process.stdout.write(`\n  ${green("Added skills:")}\n`);
    for (const s of added.slice(0, 10)) process.stdout.write(`    + ${s}\n`);
    if (added.length > 10) process.stdout.write(`    ${dim(`...+${added.length - 10} more`)}\n`);
  }

  process.stdout.write(`\n  ${dim("Apply with:")} cue use ${target}\n\n`);
  return 0;
}
