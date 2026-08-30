/**
 * `cue resolve <query>` — Tier 2 of on-demand skill resolution.
 *
 * Finds skills anywhere in the library that match a free-text query, whether or
 * not the active profile loaded them, and reports honestly what it would take
 * to actually use each one.
 *
 * Three tiers exist (see docs/superpowers/specs/2026-07-26-on-demand-skill-
 * resolution-design.md):
 *
 *   Tier 1  the smart-loader-suggest hook — bash, runs on every prompt
 *   Tier 2  this command — full scoring, fidelity diff, journal
 *   Tier 3  `--deep` — an LLM pass over the near-miss candidates
 *
 * The Tier 1 hook deliberately does NOT shell out to this command: a bun spawn
 * costs ~50-100ms, half the hook's latency budget. Claude calls this; the hook
 * does not.
 *
 * This command only ever SUGGESTS. It never injects a skill body, never edits a
 * profile, and never writes a loadout — it prints the command that would.
 *
 * Flags:
 *   --json           machine-readable (consumed by meta/smart-loader)
 *   --deep           Tier 3 LLM escalation over near-miss candidates
 *   --limit N        cap results (default 5)
 *   --threshold N    override the score floor
 *   --profile NAME   force the active profile instead of resolving from cwd
 *   --all            don't drop skills already in the active profile
 *   --explain        show which fields matched
 *   --no-journal     don't record this resolution
 *   --rebuild        rebuild index.json + the Tier 1 matcher files, then exit
 */

import { homedir } from "node:os";
import { join } from "node:path";

import {
  type IndexEntry,
  type ScoredHit,
  type SkillIndex,
  buildIndex,
  indexPath,
  isIndexStale,
  loadIndex,
  matcherDir,
  scoreQuery,
  writeIndex,
  writeMatcherIndex,
} from "../lib/catalog-index";
import { resolveProfileForCwd } from "../lib/cwd-resolver";
import { loadProfile } from "../lib/profile-loader";
import { PROMOTION_THRESHOLD, recordResolve, resolveCounts } from "../lib/skill-resolve-journal";
import { selectRelevantSkills } from "../lib/skill-subset";

/** How many near-misses Tier 3 hands the classifier. Enough to rescue a real
 *  match Tier 2's threshold rejected, small enough to keep the prompt cheap. */
const DEEP_CANDIDATE_LIMIT = 25;
/** Tier 3 scores against a floor this low so genuinely weak matches are still
 *  offered to the classifier — judging them is exactly what it's for. */
const DEEP_THRESHOLD = 1;

interface Options {
  query: string;
  json: boolean;
  deep: boolean;
  limit: number;
  threshold?: number;
  profile?: string;
  all: boolean;
  explain: boolean;
  journal: boolean;
  rebuild: boolean;
}

function parseArgs(args: string[]): Options {
  const opts: Options = {
    query: "",
    json: false,
    deep: false,
    limit: 5,
    all: false,
    explain: false,
    journal: true,
    rebuild: false,
  };
  const words: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    switch (a) {
      case "--json": opts.json = true; break;
      case "--deep": opts.deep = true; break;
      case "--all": opts.all = true; break;
      case "--explain": opts.explain = true; break;
      case "--no-journal": opts.journal = false; break;
      case "--rebuild": opts.rebuild = true; break;
      case "--limit": opts.limit = Number(args[++i]) || opts.limit; break;
      case "--threshold": opts.threshold = Number(args[++i]); break;
      case "--profile": opts.profile = args[++i]; break;
      default:
        if (!a.startsWith("-")) words.push(a);
        break;
    }
  }
  opts.query = words.join(" ").trim();
  return opts;
}

/** Load the index, rebuilding it when missing or older than the catalog. */
function ensureIndex(): SkillIndex | null {
  if (isIndexStale()) {
    try {
      const built = buildIndex();
      writeIndex(built);
      writeMatcherIndex(built);
      return built;
    } catch {
      /* fall through to whatever is on disk */
    }
  }
  return loadIndex();
}

interface ActiveProfile {
  name: string;
  /** Skill ids the profile already loads — excluded from results by default. */
  loaded: Set<string>;
  /** MCP ids available in the profile, lowercased, for the fidelity diff. */
  mcps: Set<string>;
}

/**
 * Resolve the active profile so results can be filtered and fidelity-checked.
 *
 * Fails soft on purpose: resolution outside a cue-managed directory, or against
 * a profile that no longer loads, should still return skills — it just can't
 * say what's already loaded.
 */
async function activeProfile(override?: string): Promise<ActiveProfile> {
  const empty: ActiveProfile = { name: "(none)", loaded: new Set(), mcps: new Set() };
  let name = override;
  if (!name) {
    try {
      const r = await resolveProfileForCwd({
        cwd: process.cwd(),
        homeDir: homedir(),
        configDir: join(homedir(), ".config", "cue"),
      });
      // The resolver's "none" variant carries no profile at all — running
      // outside a cue-managed directory is normal, not an error.
      name = "profile" in r ? r.profile : undefined;
    } catch {
      return empty;
    }
  }
  if (!name) return empty;

  try {
    const p = await loadProfile(name);
    return {
      name,
      loaded: new Set(p.skills.local.map((s) => s.id)),
      mcps: new Set(p.mcps.map((m) => m.id.toLowerCase())),
    };
  } catch {
    return { ...empty, name };
  }
}

interface Fidelity {
  /** MCPs the skill references that the active profile does not provide. */
  missingMcps: string[];
  /** The command that would actually close the gap, or null when there's none. */
  fix: string | null;
}

/**
 * What would it take to use this skill for real?
 *
 * A running agent session freezes its MCP set at boot, so a soft load can never
 * supply a missing server. We say so and hand back the re-exec rather than
 * letting the agent discover the gap by calling a tool that isn't there.
 *
 * The fix command names a profile that actually DECLARES the missing MCP
 * (from the index's precomputed provider map). When nothing declares it, we say
 * that plainly instead of inventing a `cue summon <category>` — categories and
 * profiles are different namespaces, and a made-up profile name is worse than
 * no suggestion.
 */
function fidelityFor(entry: IndexEntry, profile: ActiveProfile, index: SkillIndex): Fidelity {
  const missingMcps = entry.requires.mcps.filter((m) => !profile.mcps.has(m.toLowerCase()));
  if (missingMcps.length === 0) return { missingMcps, fix: null };

  const providers = new Set<string>();
  const wanted = new Set(missingMcps.map((m) => m.toLowerCase()));
  for (const mcp of wanted) {
    for (const p of index.mcpProviders?.[mcp] ?? []) providers.add(p);
  }
  // A dozen profiles may declare a popular MCP; pick the one a user would
  // recognize as its home. Rank: the profile named after the MCP itself
  // (`coolify` for the coolify server), then one matching the skill's category,
  // then alphabetically so the answer is stable across runs.
  const rank = (p: string): number => (wanted.has(p.toLowerCase()) ? 0 : p === entry.category ? 1 : 2);
  const ranked = [...providers].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  return { missingMcps, fix: ranked.length > 0 ? `cue summon ${ranked[0]}` : null };
}

interface ResultRow {
  id: string;
  name: string;
  category: string;
  score: number;
  tier: 1 | 2 | 3;
  capability: string;
  description: string;
  path: string;
  loaded: boolean;
  missingMcps: string[];
  fix: string | null;
  /** Prior invocations of this skill in this directory. */
  resolvedHere: number;
  /** Set once the invocation count clears the promotion threshold. */
  keepCommand: string | null;
  matched?: string[];
  /** Companion skills the SKILL.md wiki-links to. */
  links: string[];
}

function toRow(
  hit: ScoredHit,
  profile: ActiveProfile,
  counts: Map<string, number>,
  tier: 1 | 2 | 3,
  explain: boolean,
  index: SkillIndex,
): ResultRow {
  const f = fidelityFor(hit.entry, profile, index);
  const resolvedHere = counts.get(hit.entry.id) ?? 0;
  return {
    id: hit.entry.id,
    name: hit.entry.name,
    category: hit.entry.category,
    score: hit.score,
    tier,
    capability: hit.entry.capability,
    description: hit.entry.description,
    path: hit.entry.source,
    loaded: profile.loaded.has(hit.entry.id),
    missingMcps: f.missingMcps,
    fix: f.fix,
    resolvedHere,
    keepCommand: resolvedHere >= PROMOTION_THRESHOLD ? `cue loadout keep ${hit.entry.id}` : null,
    matched: explain ? hit.matched : undefined,
    links: hit.entry.links,
  };
}

/**
 * Tier 3 — hand the near-misses to the classifier.
 *
 * Reuses `selectRelevantSkills`, which owns the `claude --print` spawn, the
 * 7-day cache and the fail-open contract. `minKeep: 1` because narrowing to a
 * single skill is a perfectly good answer here; the subset classifier's default
 * of 3 exists to protect a launch's skill set, not a lookup.
 *
 * Any failure returns the Tier 2 rows unchanged — never an error.
 */
async function deepResolve(
  index: SkillIndex,
  query: string,
  profile: ActiveProfile,
  counts: Map<string, number>,
  base: ResultRow[],
  explain: boolean,
  limit: number,
): Promise<{ rows: ResultRow[]; note: string }> {
  const candidates = scoreQuery(index, query, {
    exclude: undefined,
    threshold: DEEP_THRESHOLD,
    limit: DEEP_CANDIDATE_LIMIT,
  });
  if (candidates.length <= 4) {
    return { rows: base, note: "too few candidates to classify — Tier 2 results" };
  }

  const byId = new Map(candidates.map((c) => [c.entry.id, c]));
  const result = await selectRelevantSkills([...byId.keys()], query, { minKeep: 1 });
  if (!result.classified) {
    return { rows: base, note: `deep pass unavailable (${result.reason}) — Tier 2 results` };
  }

  const rows = result.selected
    .map((id) => byId.get(id))
    .filter((c): c is ScoredHit => c !== undefined)
    .map((c) => toRow(c, profile, counts, 3, explain, index))
    .slice(0, limit);

  if (rows.length === 0) return { rows: base, note: "deep pass kept nothing — Tier 2 results" };
  return { rows, note: result.reason };
}

function renderHuman(rows: ResultRow[], profile: ActiveProfile, query: string, note: string): string {
  if (rows.length === 0) {
    return [
      `No skill matched "${query}".`,
      "",
      "  Try fewer / different words, or --deep for an LLM pass over near-misses.",
      "  If nothing fits, that's a real gap — scaffold one with `cue skills new`.",
    ].join("\n");
  }

  const out: string[] = [];
  out.push(`Skills matching "${query}"  (profile: ${profile.name})`);
  if (note) out.push(`  ${note}`);
  out.push("");

  for (const r of rows) {
    const flag = r.loaded ? " [already loaded]" : "";
    out.push(`  ${String(r.score).padStart(3)}  ${r.id}${flag}`);
    const blurb = r.capability || r.description;
    if (blurb) out.push(`       ${truncate(blurb, 96)}`);
    out.push(`       Read: ${r.path}`);
    if (r.missingMcps.length > 0) {
      out.push(`       ⚠️  needs MCP ${r.missingMcps.map((m) => `\`${m}\``).join(", ")} — not in this profile`);
      if (r.fix) out.push(`           full fidelity: ${r.fix}`);
    }
    if (r.links.length > 0) out.push(`       related: ${r.links.join(", ")}`);
    if (r.keepCommand) {
      out.push(`       ↑ invoked ${r.resolvedHere}× in this directory — keep it: ${r.keepCommand}`);
    }
    if (r.matched && r.matched.length > 0) {
      out.push(`       matched: ${r.matched.slice(0, 6).join(", ")}`);
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export async function run(args: string[]): Promise<number> {
  const opts = parseArgs(args);

  if (opts.rebuild) {
    try {
      const built = buildIndex();
      writeIndex(built);
      const m = writeMatcherIndex(built);
      const c = built.counts;
      console.log(`Rebuilt ${indexPath()}`);
      console.log(
        `  ${c.skills} skills · ${c.withTriggers} with triggers · ${c.withCapability} with capability · ${c.withRequires} with MCP deps`,
      );
      console.log(`  matcher: ${m.phrases} phrases, ${m.terms} terms → ${matcherDir()}`);
      return 0;
    } catch (err) {
      console.error(`cue resolve --rebuild failed: ${(err as Error).message}`);
      return 1;
    }
  }

  if (!opts.query) {
    console.error("usage: cue resolve <query...> [--json] [--deep] [--limit N] [--explain]");
    console.error("       cue resolve --rebuild");
    return 2;
  }

  const index = ensureIndex();
  if (!index) {
    console.error("No skill index available. Run `cue resolve --rebuild` to build it.");
    return 1;
  }

  const profile = await activeProfile(opts.profile);
  const counts = resolveCounts({ cwd: process.cwd() });

  const hits = scoreQuery(index, opts.query, {
    exclude: opts.all ? undefined : profile.loaded,
    threshold: opts.threshold,
    limit: opts.limit,
  });
  let rows = hits.map((h) => toRow(h, profile, counts, 2, opts.explain, index));
  let note = "";

  if (opts.deep) {
    const deep = await deepResolve(index, opts.query, profile, counts, rows, opts.explain, opts.limit);
    rows = deep.rows;
    note = deep.note;
  }

  if (opts.journal) {
    for (const r of rows) {
      recordResolve({
        ts: new Date().toISOString(),
        id: r.id,
        cwd: process.cwd(),
        profile: profile.name,
        stage: "surfaced",
        tier: r.tier,
        score: r.score,
      });
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ query: opts.query, profile: profile.name, note, results: rows }, null, 2));
    return 0;
  }

  console.log(renderHuman(rows, profile, opts.query, note));
  return rows.length > 0 ? 0 : 1;
}
