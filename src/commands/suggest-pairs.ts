/**
 * `cue suggest-pairs` — surface "you usually pair X with Y" from local
 * session history. Read-only inspection of the same data that the picker
 * uses to pre-check companions in the combine multiselect.
 *
 * Flags:
 *   --profile <name>     Show partners for just this profile.
 *   --min-count <n>      Minimum joint occurrences (default 2).
 *   --min-affinity <f>   Minimum P(partner | profile) in 0..1 (default 0.5).
 *   --limit <n>          Cap per-profile partner list (default 5).
 *   --json               Emit machine-readable JSON instead of the table.
 */

import {
  computeAffinityMap,
  suggestionsByProfile,
  suggestPartnersFor,
  type PartnerSuggestion,
  type ProfileAffinity,
  type SuggestPartnersOptions,
} from "../lib/pair-suggestions";

/**
 * One rendered line-group: a profile, its partners, and whether that pairing
 * was learned in the current repository or somewhere else. The picker only
 * acts on `here` rows, so the split is what makes the table match behavior.
 */
export interface PairRow {
  profile: string;
  partners: PartnerSuggestion[];
  scope: "here" | "elsewhere";
}

interface ParsedArgs {
  profile: string | null;
  minCount: number;
  minAffinity: number;
  limit: number;
  json: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    profile: null,
    minCount: 2,
    minAffinity: 0.5,
    limit: 5,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--profile") out.profile = argv[++i] ?? null;
    else if (a === "--min-count") out.minCount = Math.max(1, Number(argv[++i] ?? "2") || 2);
    else if (a === "--min-affinity") {
      const v = Number(argv[++i] ?? "0.5");
      out.minAffinity = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
    } else if (a === "--limit") out.limit = Math.max(1, Number(argv[++i] ?? "5") || 5);
  }
  return out;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/**
 * Split pair history into what was learned in this repository and what was
 * learned elsewhere.
 *
 * A partner already shown under `here` is dropped from that profile's
 * `elsewhere` list — repeating it would imply two separate pieces of evidence
 * when there's one. Local rows sort first, since those are the only ones the
 * picker acts on.
 */
export function buildRows(
  here: Map<string, ProfileAffinity>,
  global: Map<string, ProfileAffinity>,
  opts: SuggestPartnersOptions,
  profile: string | null,
): PairRow[] {
  const only = (map: Map<string, ProfileAffinity>): Map<string, PartnerSuggestion[]> => {
    if (!profile) return suggestionsByProfile(map, opts);
    const partners = suggestPartnersFor(profile, map, opts);
    return partners.length > 0 ? new Map([[profile, partners]]) : new Map();
  };
  const localByProfile = only(here);
  const rows: PairRow[] = [];
  for (const [name, partners] of [...localByProfile].sort((a, b) => a[0].localeCompare(b[0]))) {
    rows.push({ profile: name, partners, scope: "here" });
  }
  for (const [name, partners] of [...only(global)].sort((a, b) => a[0].localeCompare(b[0]))) {
    const known = new Set((localByProfile.get(name) ?? []).map((p) => p.name));
    const rest = partners.filter((p) => !known.has(p.name));
    if (rest.length > 0) rows.push({ profile: name, partners: rest, scope: "elsewhere" });
  }
  return rows;
}

export function renderTable(rows: ReadonlyArray<PairRow>): string {
  if (rows.length === 0) {
    return [
      "No pair suggestions yet.",
      "",
      "cue mines composite picks (e.g. `medusa-vite+backend`) from your local",
      "session log. Once you start combining profiles via the picker, this table",
      "fills in. Telemetry must be enabled: `cue telemetry status`.",
    ].join("\n");
  }
  const lines: string[] = [];
  const section = (scope: PairRow["scope"], heading: string): void => {
    const group = rows.filter((r) => r.scope === scope);
    if (group.length === 0) return;
    lines.push(heading);
    lines.push("");
    for (const r of group) {
      lines.push(`  ${r.profile}`);
      for (const p of r.partners) {
        const a = pct(p.affinity);
        lines.push(`    + ${p.name.padEnd(28)} ${a.padStart(4)} (${p.count}× together)`);
      }
      lines.push("");
    }
  };
  section("here", "Pairs you made in this repository:");
  section("elsewhere", "Pairs you made in your other projects:");
  lines.push("Picker behavior: only the pairings from this repository are");
  lines.push("pre-checked in the combine multiselect.");
  return lines.join("\n");
}

export async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.help) {
    process.stdout.write(
      [
        "cue suggest-pairs — show \"you usually pair X with Y\" from local session history",
        "",
        "Usage:",
        "  cue suggest-pairs [--profile <name>] [--min-count <n>] [--min-affinity <f>] [--limit <n>] [--json]",
        "",
        "Defaults: --min-count 2  --min-affinity 0.5  --limit 5",
        "",
        "The same data drives picker pre-checking in the combine multiselect.",
        "",
      ].join("\n"),
    );
    return 0;
  }

  const opts = {
    minCount: args.minCount,
    minAffinity: args.minAffinity,
    limit: args.limit,
  };

  // Same two views the picker sees: what this repo taught cue, and everything.
  const rows = buildRows(
    computeAffinityMap(undefined, { cwd: process.cwd() }),
    computeAffinityMap(),
    opts,
    args.profile,
  );

  if (args.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(renderTable(rows) + "\n");
  return 0;
}
