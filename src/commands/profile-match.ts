/**
 * `cue profile match [dir]` — why does this directory suggest these profiles?
 *
 * The picker shows an answer; this shows the reasoning. When a repo suggests
 * something silly, the fix is almost always one line — a stopword, a metadata
 * key, a marker file — but only if you can see which term did it and where the
 * term came from. Guessing at that from the suggestion alone is how the
 * matcher's early versions stayed wrong for as long as they did.
 *
 * Flags:
 *   --deep       run the LLM reranking pass (cached per repo shape)
 *   --explain    show the evidence behind each match, and the unmatched terms
 *   --json       machine-readable
 *   --no-cache   force a fresh model call rather than a cached answer
 *   --limit N    cap results (default 8)
 */

import {
  MATCH_MIN_STRENGTH,
  loadProfileDocs,
  matchProfiles,
  repoEvidence,
} from "../lib/profile-match";
import { deepMatchDisabled, deepMatchProfiles } from "../lib/profile-match-llm";

interface Options {
  cwd: string;
  deep: boolean;
  explain: boolean;
  json: boolean;
  noCache: boolean;
  limit: number;
}

function parseArgs(args: string[]): Options {
  const opts: Options = {
    cwd: process.cwd(),
    deep: false,
    explain: false,
    json: false,
    noCache: false,
    limit: 8,
  };
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    switch (a) {
      case "--deep": opts.deep = true; break;
      case "--explain": opts.explain = true; break;
      case "--json": opts.json = true; break;
      case "--no-cache": opts.noCache = true; break;
      case "--limit": opts.limit = Number(args[++i]) || opts.limit; break;
      default:
        if (!a.startsWith("-")) positional.push(a);
        break;
    }
  }
  if (positional[0]) opts.cwd = positional[0];
  return opts;
}

function usage(): void {
  process.stdout.write(`cue profile match [dir] — show why a directory matches the profiles it does

  --deep        rerank with the model (cached per repo shape)
  --explain     show the evidence behind each match
  --json        machine-readable output
  --no-cache    force a fresh model call
  --limit N     cap results (default 8)
`);
}

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    usage();
    return 0;
  }
  const opts = parseArgs(args);

  const docs = loadProfileDocs();
  if (docs.length === 0) {
    process.stderr.write("No profiles found. Is CUE_REPO_ROOT set correctly?\n");
    return 1;
  }

  const evidence = repoEvidence(opts.cwd);
  const lexical = matchProfiles(evidence, docs);

  let matches = lexical;
  let note = "";
  if (opts.deep) {
    const deep = await deepMatchProfiles({ evidence, docs, lexical, noCache: opts.noCache });
    matches = deep.matches;
    note = deep.classified
      ? `model: ${deep.reason}${deep.cached ? " (cached)" : ""}`
      : `lexical only — ${deep.reason}`;
  }
  const shown = matches.slice(0, opts.limit);

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          cwd: opts.cwd,
          deep: opts.deep,
          note,
          evidence: [...evidence.terms.entries()].map(([term, weight]) => ({
            term,
            weight,
            source: evidence.sources.get(term),
            reason: evidence.reasons.get(term),
          })),
          matches: shown,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  process.stdout.write(`\nProfile match for ${opts.cwd}\n`);
  if (note) process.stdout.write(`  ${note}\n`);
  if (!opts.deep && !deepMatchDisabled()) {
    process.stdout.write("  (lexical only — add --deep to rerank with the model)\n");
  }
  process.stdout.write("\n");

  if (shown.length === 0) {
    process.stdout.write("  No profile matches this directory.\n");
    process.stdout.write("  That is a real answer, not a failure: nothing here resembles a\n");
    process.stdout.write("  domain profile, so the picker falls back to featured + your default.\n\n");
    if (opts.explain) writeEvidence(evidence);
    return 0;
  }

  for (const m of shown) {
    process.stdout.write(`  ${m.strength.toFixed(2)}  ${m.name}\n`);
    process.stdout.write(`        ${m.reason}\n`);
    if (opts.explain && m.matchedTerms.length > 0) {
      for (const t of m.matchedTerms) {
        const src = evidence.sources.get(t) ?? "?";
        const why = evidence.reasons.get(t) ?? "";
        process.stdout.write(`        · ${t}  [${src}]  ${why}\n`);
      }
    }
    process.stdout.write("\n");
  }

  if (opts.explain) writeEvidence(evidence);
  return 0;
}

/**
 * Print the full evidence bag.
 *
 * The terms that matched NOTHING matter as much as the ones that did: a term
 * here that obviously shouldn't be evidence at all (a metadata key, a
 * scaffolding word) is a one-line fix in EVIDENCE_STOPWORDS or
 * MANIFEST_METADATA_KEYS, and this listing is how you find it.
 */
function writeEvidence(evidence: ReturnType<typeof repoEvidence>): void {
  process.stdout.write("  Evidence gathered from this directory:\n");
  const rows = [...evidence.terms.entries()].sort(
    ([ta, wa], [tb, wb]) => wb - wa || ta.localeCompare(tb),
  );
  if (rows.length === 0) {
    process.stdout.write("    (none)\n\n");
    return;
  }
  for (const [term, weight] of rows) {
    const src = evidence.sources.get(term) ?? "?";
    const why = evidence.reasons.get(term) ?? "";
    process.stdout.write(`    ${String(weight).padStart(4)}  ${term.padEnd(20)} [${src}]  ${why}\n`);
  }
  process.stdout.write(
    `\n  A term here that shouldn't be evidence at all is a one-line fix in\n  EVIDENCE_STOPWORDS or MANIFEST_METADATA_KEYS (src/lib/profile-match.ts).\n  Matches below ${MATCH_MIN_STRENGTH} strength are dropped before display.\n\n`,
  );
}
