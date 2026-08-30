/**
 * `cue skill-report` — show which skills are actually firing.
 *
 * Reads telemetry (skill_hit + skill_invoked events) from the local analytics
 * log and joins them against the resolved profile's declared skills. Zombies
 * (0 hits in window) are flagged for `cue prune --dead`.
 *
 * Usage:
 *   cue skill-report [--profile <name>] [--since <days>] [--json]
 *   cue skill-report --all          # every profile that has telemetry data
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadProfile, listProfiles } from "../lib/profile-loader";
import {
  computeSkillUsage,
  estimateTokenSavings,
  zombieSkills,
  type SkillUsageRow,
} from "../lib/skill-report";
import { isEnabled as telemetryEnabled } from "../lib/telemetry-consent";

const REPO_ROOT = resolve(new URL(import.meta.url).pathname, "..", "..", "..");
const SKILLS_ROOT = join(REPO_ROOT, "resources", "skills", "skills");

interface ParsedArgs {
  profile: string | null;
  sinceDays: number;
  json: boolean;
  all: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    profile: null,
    sinceDays: 30,
    json: false,
    all: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--all") out.all = true;
    else if (a === "--profile") out.profile = argv[++i] ?? null;
    else if (a === "--since") {
      const v = argv[++i] ?? "30";
      const m = v.match(/^(\d+)\s*d?$/);
      out.sinceDays = m ? Math.max(1, parseInt(m[1]!, 10)) : 30;
    }
  }
  return out;
}

function helpText(): string {
  return [
    "cue skill-report — show which skills actually fire under a profile",
    "",
    "Usage:",
    "  cue skill-report [--profile <name>] [--since <days>] [--json]",
    "  cue skill-report --all           # every profile that has telemetry data",
    "",
    "Defaults: --since 30",
    "",
    "Telemetry must be enabled (`cue telemetry status`). Zombies (0 hits in window)",
    "are flagged and can be removed via `cue prune --dead --profile <name>`.",
    "",
  ].join("\n");
}

function resolveActiveProfile(explicit: string | null): string | null {
  if (explicit) return explicit;
  const pin = join(process.cwd(), ".cue.profile");
  if (existsSync(pin)) {
    try {
      const txt = readFileSync(pin, "utf8").trim().split("\n")[0]?.trim();
      if (txt) return txt;
    } catch { /* ignore */ }
  }
  return process.env.CUE_PROFILE ?? null;
}

/**
 * Find SKILL.md on disk for size reporting. Tries the canonical
 * `<category>/<slug>` layout, then falls back to a single-segment slug.
 * Returns null when nothing matches — caller falls back to the constant
 * estimate from estimateTokenSavings.
 */
function skillBytes(id: string): number | null {
  const direct = join(SKILLS_ROOT, id, "SKILL.md");
  if (existsSync(direct)) {
    try { return statSync(direct).size; } catch { return null; }
  }
  return null;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function fmtAgo(iso: string | null, now: Date): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "never";
  const days = Math.floor((now.getTime() - then) / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return iso.slice(0, 10);
}

function renderRows(
  profileName: string,
  rows: SkillUsageRow[],
  windowDays: number,
  now: Date,
): string {
  if (rows.length === 0) {
    return `No skills declared by "${profileName}" — nothing to report.`;
  }
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

  const out: string[] = [];
  out.push(`Skill activation for "${profileName}" (last ${windowDays}d):`);
  out.push("");

  const active = rows.filter((r) => !r.zombie);
  const zombies = rows.filter((r) => r.zombie);

  if (active.length > 0) {
    out.push(`  ${green("●")} Active (${active.length}):`);
    for (const r of active.slice(0, 20)) {
      const last = fmtAgo(r.lastUsed, now);
      out.push(`    ${r.hits.toString().padStart(4)}×  ${r.id.padEnd(40)} ${dim(last)}`);
    }
    if (active.length > 20) {
      out.push(`    ${dim(`…and ${active.length - 20} more`)}`);
    }
    out.push("");
  }

  if (zombies.length > 0) {
    let knownBytes = 0;
    let knownCount = 0;
    for (const r of zombies) {
      const b = skillBytes(r.id);
      if (b !== null) { knownBytes += b; knownCount++; }
    }
    const estTokens = knownCount === zombies.length
      ? Math.round(knownBytes / 4)
      : estimateTokenSavings(zombies.length);
    out.push(`  ${red("✗")} Zombie (${zombies.length}, ~${estTokens.toLocaleString()} tokens):`);
    for (const r of zombies.slice(0, 20)) {
      const sizeNote = (() => {
        const b = skillBytes(r.id);
        return b !== null ? dim(`  ${fmtBytes(b)}`) : "";
      })();
      out.push(`    ${dim("   0×")}  ${r.id.padEnd(40)}${sizeNote}`);
    }
    if (zombies.length > 20) {
      out.push(`    ${dim(`…and ${zombies.length - 20} more`)}`);
    }
    out.push("");
    out.push(`  ${yellow("→")} ${dim(`prune them: cue prune --dead --profile ${profileName}`)}`);
  } else {
    out.push(`  ${green("✓")} no zombies — every declared skill fired in the window.`);
  }

  return out.join("\n");
}

export async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(helpText());
    return 0;
  }

  if (!telemetryEnabled()) {
    process.stderr.write(
      "cue skill-report: telemetry is disabled. Enable with `cue telemetry enable` so events get recorded.\n",
    );
    return 1;
  }

  const now = new Date();

  const targets: string[] = args.all
    ? await listProfiles()
    : (() => {
        const p = resolveActiveProfile(args.profile);
        if (!p) {
          process.stderr.write(
            "cue skill-report: no profile pinned and --profile not given (try --all)\n",
          );
          return [];
        }
        return [p];
      })();

  if (targets.length === 0) return 1;

  const allReports: { profile: string; rows: SkillUsageRow[] }[] = [];
  for (const name of targets) {
    try {
      const loaded = await loadProfile(name);
      const rows = computeSkillUsage(loaded, { windowDays: args.sinceDays, now });
      allReports.push({ profile: name, rows });
    } catch (err) {
      if (!args.all) {
        process.stderr.write(`cue skill-report: cannot load "${name}": ${(err as Error).message}\n`);
        return 1;
      }
    }
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(
      allReports.map((r) => ({
        profile: r.profile,
        windowDays: args.sinceDays,
        rows: r.rows,
        zombies: zombieSkills(r.rows),
      })),
      null,
      2,
    ) + "\n");
    return 0;
  }

  for (let i = 0; i < allReports.length; i++) {
    const r = allReports[i]!;
    if (args.all) {
      const zCount = r.rows.filter((row) => row.zombie).length;
      if (zCount === 0 && r.rows.length > 0) continue; // hide clean profiles in --all
    }
    process.stdout.write(renderRows(r.profile, r.rows, args.sinceDays, now) + "\n");
    if (i < allReports.length - 1) process.stdout.write("\n");
  }
  return 0;
}
