/**
 * `cue stats` — profile usage analytics dashboard.
 */

import { computeStats } from "../lib/analytics";
import { readProfileSuggestionQuality } from "../lib/profile-choice-feedback";

function parseSince(args: string[]): Date | undefined {
  const idx = args.indexOf("--since");
  if (idx < 0) return undefined;
  const val = args[idx + 1];
  if (!val) return undefined;
  const match = val.match(/^(\d+)([dhw])$/);
  if (!match) return new Date(val); // try ISO parse
  const n = parseInt(match[1]!, 10);
  const unit = match[2]!;
  const ms = unit === "d" ? n * 86400000 : unit === "h" ? n * 3600000 : n * 604800000;
  return new Date(Date.now() - ms);
}

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function formatPercent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function clipSelector(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`;
}

function runSuggestionStats(args: string[]): number {
  const json = args.includes("--json");
  const allRepositories = args.includes("--all");
  const quality = readProfileSuggestionQuality(
    undefined,
    allRepositories ? {} : { cwd: process.cwd() },
  );

  if (json) {
    process.stdout.write(`${JSON.stringify(quality, null, 2)}\n`);
    return 0;
  }
  if (quality.choices === 0) {
    process.stdout.write(
      "No profile suggestion feedback yet. Choose a profile from the picker first.\n",
    );
    return 0;
  }

  const scope = allRepositories ? "all repositories" : "this repository";
  process.stdout.write(`Profile Suggestion Quality (${scope}):\n\n`);
  process.stdout.write(`  Choices recorded    ${quality.choices}\n`);
  process.stdout.write(`  Suggestions scored  ${quality.compared}\n`);
  process.stdout.write(`  Top accepted        ${quality.topAccepted}\n`);
  process.stdout.write(`  Top overridden      ${quality.topOverridden}\n`);
  process.stdout.write(
    `  Acceptance rate    ${formatPercent(quality.topAcceptanceRate)}\n`,
  );

  if (quality.selectors.length > 0) {
    process.stdout.write("\n  Top selector                     Shown  Accepted  Overridden  Rate\n");
    process.stdout.write("  ───────────────────────────────  ─────  ────────  ──────────  ──────\n");
    for (const item of quality.selectors.slice(0, 10)) {
      process.stdout.write(
        `  ${clipSelector(item.selector, 31).padEnd(31)}  ${String(item.shownFirst).padStart(5)}  ${String(item.accepted).padStart(8)}  ${String(item.overridden).padStart(10)}  ${formatPercent(item.acceptanceRate).padStart(6)}\n`,
      );
    }
  }
  process.stdout.write("\n");
  return 0;
}

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue stats — local profile and suggestion analytics

Usage:
  cue stats [--since 7d] [--profile <name>] [--json]
  cue stats --suggestions [--all] [--json]

Options:
  --suggestions  Report how often the picker top suggestion was accepted
  --all          Include suggestion feedback from every local repository
  --since <age>  Filter profile usage (for example 24h, 7d, 4w)
  --profile <n>  Filter profile usage by name
  --json         Machine-readable output
`);
    return 0;
  }
  if (args.includes("--suggestions")) return runSuggestionStats(args);

  const json = args.includes("--json");
  const since = parseSince(args);
  const profileFilter = args.indexOf("--profile") >= 0 ? args[args.indexOf("--profile") + 1] : null;

  let stats = computeStats(since);
  if (profileFilter) stats = stats.filter(s => s.profile === profileFilter);

  if (json) {
    process.stdout.write(JSON.stringify(stats, null, 2) + "\n");
    return 0;
  }

  if (stats.length === 0) {
    process.stdout.write("No usage data yet. Stats are recorded after your next `claude` launch via cue.\n");
    return 0;
  }

  const sinceStr = since ? ` (since ${since.toISOString().slice(0, 10)})` : "";
  process.stdout.write(`Profile Usage${sinceStr}:\n\n`);
  process.stdout.write("  Profile            Sessions   Avg Duration   Last Used\n");
  process.stdout.write("  ─────────────────  ────────   ────────────   ─────────\n");

  for (const s of stats) {
    const name = s.profile.padEnd(17);
    const sess = String(s.sessions).padStart(8);
    const avg = formatDuration(s.avg_duration_s).padStart(12);
    const last = s.last_used ? new Date(s.last_used).toLocaleDateString() : "never";
    process.stdout.write(`  ${name}  ${sess}   ${avg}   ${last}\n`);
  }

  process.stdout.write(`\n  Total: ${stats.reduce((a, s) => a + s.sessions, 0)} sessions across ${stats.length} profiles\n`);
  return 0;
}
