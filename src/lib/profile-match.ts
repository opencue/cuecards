/**
 * Generic repo → profile matcher.
 *
 * `stack-suggest` ranks profiles from five hand-maintained sources: dependency
 * detection rules, path conventions, combo history, recents, and the featured
 * list. That covers 19 of 85 profiles. The other 66 — `gstack` among them —
 * can only ever surface if the user launched them before, so a directory that
 * genuinely wants one has no way to say so.
 *
 * The information is already there: every profile.yaml describes itself, and
 * lists the skills and MCPs it carries. This module reads that text, reads what
 * the directory looks like, and scores one against the other. Coverage goes
 * from 19/85 to all of them, and the picker's suggestion list stops running out.
 *
 * Two properties matter more than raw overlap:
 *
 *   **IDF weighting.** A term that appears in half the profiles ("skills",
 *   "deploy", "api") says nothing about which one to pick. Terms are weighted
 *   by how rare they are across the profile set, so a match on "cargo" counts
 *   for far more than a match on "build".
 *
 *   **Size damping.** `gstack` bundles 58 roles and mentions nearly everything;
 *   `rust` mentions Rust. Without damping the big profile wins every directory
 *   by surface area alone. Scores are divided by the square root of the
 *   profile's vocabulary, so breadth stops being an advantage in itself.
 *
 * Inheritance is deliberately NOT resolved — the same reasoning as
 * `catalog-index`'s MCP provider map. Nearly every profile inherits `core`, so
 * resolved terms would make them all look alike. A profile is matched on what
 * it declares about itself.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import { tokenize } from "./catalog-index";

/** Per-source term weights for a PROFILE's own vocabulary. */
const PROFILE_WEIGHTS = {
  name: 4,
  description: 2,
  mcp: 2,
  skill: 1.5,
  other: 1,
} as const;

/** Per-source term weights for what a DIRECTORY says about itself. */
const EVIDENCE_WEIGHTS = {
  /** A declared dependency is the strongest statement a repo makes. */
  dependency: 3,
  /** A language inferred from file extensions present. */
  language: 3,
  /** A marker file (Dockerfile, next.config.ts, ...). */
  marker: 2,
  /**
   * A top-level file or directory basename. Weak but genuinely generic: it is
   * what lets `robot.urdf` reach the `ros2` profile, whose description says
   * "ROS 2 robot control", with no rule written for it.
   */
  entry: 1.2,
} as const;

// Deliberately absent: the directory's own name and its parent's. Path evidence
// was tried and removed — `~/Documents/<x>` made every project match
// `docs-writer` via "document", and `base-template` outranked the medusa
// profiles on "base"/"baseline". The one case it got right (a shop under
// `medusa-shops/`) is already handled explicitly, and better, by
// `pathSignals` in stack-suggest.

/**
 * Score a clear match reaches. Strength is measured against THIS, not against
 * the run's best hit.
 *
 * Normalizing against the top scorer was the first implementation, and it was
 * wrong in a way worth recording: it manufactures confidence out of noise. A
 * directory with nothing to say still produced a 1.00-strength "match", because
 * the weakest possible signal is still the strongest signal present. An
 * absolute scale lets the honest answer — "this directory doesn't look like any
 * profile in particular" — actually be expressed.
 */
export const STRONG_MATCH_SCORE = 10;

/** Below this absolute strength a match isn't worth showing. */
export const MATCH_MIN_STRENGTH = 0.25;

/**
 * A term present in more than this share of profiles carries no discriminating
 * power, whatever its IDF works out to. "setup", "content" and "profile" appear
 * across a fifth of the library; matching one says nothing about which profile
 * to pick.
 */
export const MAX_DF_RATIO = 0.2;

/** Below this many profiles the document-frequency cut is skipped entirely. */
export const DF_CUT_MIN_PROFILES = 10;

/**
 * Terms that name universal project scaffolding or filesystem convention
 * rather than anything about the project.
 *
 * `document` earns its place here the hard way: every project under
 * `~/Documents/` contributed it via the path, so it matched `docs-writer` for
 * the entire workspace.
 */
const EVIDENCE_STOPWORDS = new Set([
  // filesystem / scaffolding
  "document", "documents", "home", "user", "users", "project", "projects", "repo",
  "src", "lib", "libs", "bin", "dist", "build", "test", "tests", "spec", "specs",
  "docs", "doc", "config", "configs", "script", "scripts", "asset", "assets",
  "public", "static", "example", "examples", "sample", "samples", "template",
  "templates", "node", "modules", "module", "vendor", "target", "coverage",
  "packages", "tools", "util", "utils", "common", "shared", "temp", "tmp",
  "cache", "logs", "content", "setup", "draft", "drafts", "action", "actions",
  "lint", "eval", "evals", "main", "index", "types", "hooks", "components",
  "pages", "styles", "license", "readme", "changelog", "makefile",
  // package-internal words — every ecosystem has an @x/core and an @x/prompts,
  // and matching on them ranked `core` first for a repo that merely uses clack
  "core", "base", "baseline", "prompt", "prompts", "client", "server", "sdk",
  "api", "cli", "runtime", "helper", "helpers", "plugin", "plugins", "profile",
  "profiles", "development", "check", "fast", "awesome", "skill", "skills",
  // agent tooling config — present in every repo in this workspace, so it says
  // nothing about any of them
  "claude", "agent", "agents", "cursor", "codex", "gemini", "copilot", "windsurf",
]);

/** File extension → the terms that extension implies. */
const EXT_LANGUAGE: Record<string, string[]> = {
  rs: ["rust", "cargo"],
  py: ["python"],
  go: ["golang"],
  swift: ["swift", "ios"],
  kt: ["kotlin", "android"],
  java: ["java"],
  rb: ["ruby", "rails"],
  php: ["php"],
  tsx: ["react", "typescript", "frontend"],
  jsx: ["react", "javascript", "frontend"],
  vue: ["vue", "frontend"],
  svelte: ["svelte", "frontend"],
  tf: ["terraform", "infrastructure"],
  sol: ["solidity", "blockchain"],
  ipynb: ["notebook", "research"],
  urdf: ["robot", "robotics", "ros"],
  xacro: ["robot", "robotics", "ros"],
};

/**
 * Extensions distinctive enough that a single file settles the question.
 *
 * The rest need two, because one stray `.py` script in a TypeScript repo
 * shouldn't make it a Python project. But a repo does not contain a lone
 * `robot.urdf`, `main.tf`, or `Contract.sol` by accident — and requiring two
 * made a real ROS workspace match nothing at all.
 */
const DISTINCTIVE_EXTS = new Set(["rs", "go", "swift", "kt", "rb", "tf", "sol", "urdf", "xacro", "ipynb", "vue", "svelte"]);

/** Manifests worth looking for one directory down, for monorepo layouts. */
const NESTED_MANIFESTS = ["package.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod"];

/**
 * Manifest METADATA keys, which the loose line-scanner would otherwise read as
 * dependency names.
 *
 * These produced visibly wrong matches: `requires-python` and `authors` in a
 * pyproject made a repo match the `research` profile on "author"/"keyword",
 * and an `[project.urls] issues = ...` line made it match `linear` on "issue".
 */
const MANIFEST_METADATA_KEYS = new Set([
  "name", "version", "description", "license", "readme", "authors", "author",
  "maintainers", "keywords", "classifiers", "homepage", "repository", "issues",
  "documentation", "urls", "scripts", "entry", "edition", "workspace", "members",
  "package", "project", "build", "requires", "toolchain", "module", "replace",
  "exclude", "include", "features", "profile", "target", "dependencies",
  "optional", "dev", "test", "default", "path", "branch", "true", "false",
]);

/**
 * Metadata keys whose VALUE is a dependency list.
 *
 * They are metadata by name but carry the real package names inline, which for
 * a pyproject is often the only place dependencies appear at all.
 */
const DEPENDENCY_LIST_KEYS = new Set(["dependencies", "requires", "install_requires", "devdependencies"]);

/** Filenames that name a technology outright. */
const MARKER_FILES: Record<string, string[]> = {
  "cargo.toml": ["rust", "cargo"],
  "go.mod": ["golang"],
  "pyproject.toml": ["python"],
  "requirements.txt": ["python"],
  "gemfile": ["ruby", "rails"],
  "composer.json": ["php"],
  dockerfile: ["docker", "container"],
  "docker-compose.yml": ["docker", "compose"],
  "docker-compose.yaml": ["docker", "compose"],
  "package.xml": ["ros2", "robotics"],
  "wp-config.php": ["wordpress"],
  "medusa-config.ts": ["medusa", "commerce"],
  "medusa-config.js": ["medusa", "commerce"],
  "next.config.ts": ["nextjs", "react", "frontend"],
  "next.config.js": ["nextjs", "react", "frontend"],
  "next.config.mjs": ["nextjs", "react", "frontend"],
  "vite.config.ts": ["vite", "frontend"],
  "vite.config.js": ["vite", "frontend"],
  "nuxt.config.ts": ["nuxt", "vue", "frontend"],
  "svelte.config.js": ["svelte", "frontend"],
  "astro.config.mjs": ["astro", "frontend"],
  "tailwind.config.ts": ["tailwind", "frontend"],
  "playwright.config.ts": ["playwright", "browser", "testing"],
  "vercel.json": ["vercel", "deploy"],
  "netlify.toml": ["netlify", "deploy"],
  "serverless.yml": ["serverless", "aws"],
  "terraform.tf": ["terraform", "infrastructure"],
  "supabase": ["supabase", "postgres"],
};

/** One profile's self-declared vocabulary. */
export interface ProfileDoc {
  name: string;
  description: string;
  /** term → local weight, before IDF. */
  terms: Map<string, number>;
}

/** Where a piece of evidence came from. Drives the corroboration rule. */
export type EvidenceSource = "dependency" | "language" | "marker" | "entry";

/** Sources that can stand on their own. See the corroboration rule below. */
const STRONG_SOURCES: ReadonlySet<EvidenceSource> = new Set(["dependency", "language", "marker"]);

/** What a directory says about itself. */
export interface RepoEvidence {
  /** term → weight. */
  terms: Map<string, number>;
  /** term → short human reason, for the suggestion's "why". */
  reasons: Map<string, string>;
  /** term → which source produced it. */
  sources: Map<string, EvidenceSource>;
}

export interface ProfileMatch {
  name: string;
  /** 0..1, relative to the strongest match in this run. */
  strength: number;
  /** Raw weighted score, before normalization. */
  score: number;
  /** Up to three terms that drove the match, strongest first. */
  matchedTerms: string[];
  /** One-line explanation for the picker. */
  reason: string;
}

/** Injectable filesystem access, mirroring `stack-suggest`'s PathProbe. */
export interface MatchProbe {
  exists: (p: string) => boolean;
  list: (p: string) => string[];
  read: (p: string) => string | null;
}

export const REAL_MATCH_PROBE: MatchProbe = {
  exists: (p) => existsSync(p),
  list: (p) => {
    try {
      return readdirSync(p);
    } catch {
      return [];
    }
  },
  read: (p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return null;
    }
  },
};

function repoRoot(): string {
  return process.env.CUE_REPO_ROOT ?? process.env.SOUL_REPO_ROOT ?? join(homedir(), "Documents", "cue");
}

export function profilesRoot(): string {
  return process.env.CUE_PROFILES_ROOT ?? join(repoRoot(), "profiles");
}

function addTerms(map: Map<string, number>, terms: Iterable<string>, weight: number): void {
  for (const t of terms) {
    // Highest-weighted source wins rather than accumulating, so repeating a
    // word in a long description can't outweigh it being the profile's name.
    map.set(t, Math.max(map.get(t) ?? 0, weight));
  }
}

/**
 * Read every profile.yaml and build its self-declared vocabulary.
 *
 * Unreadable or unparseable profiles are skipped, not fatal — one broken YAML
 * shouldn't cost the picker its whole suggestion tail.
 */
export function loadProfileDocs(root: string = profilesRoot(), probe: MatchProbe = REAL_MATCH_PROBE): ProfileDoc[] {
  const docs: ProfileDoc[] = [];
  for (const entry of probe.list(root)) {
    if (entry.startsWith("_") || entry.startsWith(".")) continue;
    const file = join(root, entry, "profile.yaml");
    const raw = probe.read(file);
    if (raw === null) continue;

    let doc: {
      name?: string;
      description?: string;
      skills?: { local?: unknown[] };
      mcps?: unknown[];
      playbooks?: unknown[];
      commands?: unknown[];
    };
    try {
      doc = parseYaml(raw) as typeof doc;
    } catch {
      continue;
    }
    if (!doc || typeof doc !== "object") continue;

    const name = typeof doc.name === "string" && doc.name ? doc.name : entry;
    const description = typeof doc.description === "string" ? doc.description : "";
    const terms = new Map<string, number>();

    // The profile's own name, whole and split, is the strongest signal it has.
    addTerms(terms, [name.toLowerCase(), ...tokenize(name.replace(/-/g, " "))], PROFILE_WEIGHTS.name);
    addTerms(terms, tokenize(description), PROFILE_WEIGHTS.description);

    for (const item of doc.mcps ?? []) {
      const id = typeof item === "string" ? item : (item as { id?: string } | null)?.id;
      if (typeof id === "string" && id) addTerms(terms, [id.toLowerCase()], PROFILE_WEIGHTS.mcp);
    }

    // Skill ids carry the domain vocabulary: "rust/sqlx-cli" → rust, sqlx, cli.
    for (const item of doc.skills?.local ?? []) {
      const id = typeof item === "string" ? item : (item as { id?: string } | null)?.id;
      if (typeof id !== "string" || !id) continue;
      addTerms(terms, tokenize(id.replace(/[/-]/g, " ")), PROFILE_WEIGHTS.skill);
    }

    for (const list of [doc.playbooks, doc.commands]) {
      for (const item of list ?? []) {
        if (typeof item === "string") addTerms(terms, tokenize(item.replace(/-/g, " ")), PROFILE_WEIGHTS.other);
      }
    }

    docs.push({ name, description, terms });
  }
  return docs;
}

/**
 * Dependency names declared in the usual manifests, lowercased.
 *
 * Searches the top level and one directory down. The nesting matters: a Medusa
 * shop keeps its `package.json` in `app/`, so a top-level-only read found no
 * dependencies at all and the shop matched nothing.
 */
function manifestDeps(cwd: string, probe: MatchProbe): string[] {
  const out: string[] = [];

  const readPackageJson = (dir: string): void => {
    const pkg = probe.read(join(dir, "package.json"));
    if (pkg === null) return;
    try {
      const parsed = JSON.parse(pkg) as Record<string, unknown>;
      for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
        const deps = parsed[field];
        if (deps && typeof deps === "object") out.push(...Object.keys(deps as Record<string, unknown>));
      }
    } catch {
      /* a malformed package.json contributes nothing */
    }
  };

  const readLooseManifests = (dir: string): void => {
    for (const file of ["pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod"]) {
      const raw = probe.read(join(dir, file));
      if (raw === null) continue;
      // Deliberately loose: we want identifier-shaped tokens, not a real parse
      // of four different manifest grammars. Two filters keep that honest.
      for (const line of raw.split("\n")) {
        // 1. Trove classifiers. `"Intended Audience :: Developers"` and friends
        //    are prose. Reading them made a small Python CLI look like it
        //    depended on "environment", "intended", "operating", "programming"
        //    and "topic" — and the LLM tier, handed that same evidence, then
        //    confidently picked profiles about building cue itself.
        if (line.includes("::")) continue;
        if (line.trimStart().startsWith("[")) continue; // section header

        const m = line.match(/^[\s"']*([a-zA-Z][a-zA-Z0-9._-]{2,})/);
        if (!m) continue;
        const key = m[1]!.toLowerCase();

        // 2. Metadata keys, because the scanner cannot tell `tokio = "1"` from
        //    `requires-python = ">=3.11"`. Hyphenated metadata (`build-backend`)
        //    counts if either half does.
        if (MANIFEST_METADATA_KEYS.has(key) || key.split(/[-_.]/).some((p) => MANIFEST_METADATA_KEYS.has(p))) {
          // An inline dependency array still carries real names on this line —
          // `dependencies = ["httpx>=0.27", "click"]` — so harvest those rather
          // than discarding the only dependency declaration a pyproject has.
          if (DEPENDENCY_LIST_KEYS.has(key)) {
            for (const q of line.matchAll(/["']([a-zA-Z][a-zA-Z0-9._-]{2,})/g)) out.push(q[1]!);
          }
          continue;
        }
        out.push(m[1]!);
      }
    }
  };

  readPackageJson(cwd);
  readLooseManifests(cwd);

  // Descend ONLY when the root declares nothing itself.
  //
  // A repo with its own manifest has already said what it is, and going deeper
  // just collects unrelated sub-projects: scanning into cue's vendored skill
  // tree made cue match `python` at 16.6, and gitguardex's template fixtures
  // made it match `designer-medusa-next`. The nesting only needs handling for
  // the case it was added for — a shop whose only package.json lives in `app/`.
  if (out.length === 0) {
    const SKIP = new Set(["node_modules", "dist", "build", "target", "vendor", "coverage", "resources", "templates", "fixtures"]);
    const subdirs = probe
      .list(cwd)
      .filter((e) => !e.startsWith(".") && !e.includes(".") && !SKIP.has(e))
      .slice(0, 12);
    for (const dir of subdirs) {
      const full = join(cwd, dir);
      if (NESTED_MANIFESTS.some((m) => probe.exists(join(full, m)))) {
        readPackageJson(full);
        readLooseManifests(full);
      }
    }
  }

  return out.map((d) => d.toLowerCase());
}

/**
 * Describe a directory as a weighted bag of terms.
 *
 * Best-effort throughout: an unreadable directory yields fewer terms, never an
 * error. Only the top level is inspected — walking a whole tree would cost more
 * than the suggestion is worth.
 */
export function repoEvidence(cwd: string, probe: MatchProbe = REAL_MATCH_PROBE): RepoEvidence {
  const terms = new Map<string, number>();
  const reasons = new Map<string, string>();
  const sources = new Map<string, EvidenceSource>();

  /**
   * Every evidence term goes through `tokenize` — the SAME normalizer the
   * profile side uses.
   *
   * Skipping it is a silent-failure bug, not a shortcut: `tokenize` folds
   * plurals, so a profile describing "robotics" indexes `robotic`, while a raw
   * `EXT_LANGUAGE` value of "robotics" stays plural. The two never meet and the
   * match simply doesn't happen, with nothing to show for it. Both sides
   * normalize identically or neither does.
   */
  const add = (list: Iterable<string>, weight: number, reason: string, source: EvidenceSource) => {
    for (const raw of list) {
      for (const t of tokenize(raw.replace(/[@/_-]/g, " "))) {
        if (EVIDENCE_STOPWORDS.has(t)) continue;
        if ((terms.get(t) ?? 0) >= weight) continue;
        terms.set(t, weight);
        reasons.set(t, reason);
        sources.set(t, source);
      }
    }
  };

  // Dependencies. A scoped name contributes both the scope and the package,
  // so "@medusajs/medusa" reaches a profile that only says "medusa".
  for (const dep of manifestDeps(cwd, probe)) {
    const parts = dep.replace(/^@/, "").split(/[/@]/).filter(Boolean);
    add([dep, ...parts, ...tokenize(dep.replace(/[@/_-]/g, " "))], EVIDENCE_WEIGHTS.dependency, `depends on ${dep}`, "dependency");
  }

  const entries = probe.list(cwd);
  const files = entries.filter((e) => e.includes("."));

  // Marker files.
  for (const e of entries) {
    const hit = MARKER_FILES[e.toLowerCase()];
    if (hit) add(hit, EVIDENCE_WEIGHTS.marker, e, "marker");
  }

  // Languages, by extension frequency. A single stray .py in a Rust repo
  // shouldn't make it a Python project, so a language needs two files.
  const extCount = new Map<string, number>();
  for (const f of files) {
    const ext = f.split(".").pop()?.toLowerCase() ?? "";
    if (ext) extCount.set(ext, (extCount.get(ext) ?? 0) + 1);
  }
  for (const [ext, count] of extCount) {
    const langs = EXT_LANGUAGE[ext];
    if (!langs) continue;
    if (count < (DISTINCTIVE_EXTS.has(ext) ? 1 : 2)) continue;
    add(langs, EVIDENCE_WEIGHTS.language, `${count} .${ext} file${count === 1 ? "" : "s"}`, "language");
  }

  // Top-level entry basenames, files and directories alike. `robot.urdf` and
  // `mrs1000_bringup` are the project describing itself in the only vocabulary
  // it has; the stoplist keeps universal scaffolding out.
  for (const e of entries) {
    if (e.startsWith(".") || e.startsWith("_")) continue;
    const stem = e.replace(/\.[^.]+$/, "");
    add(tokenize(stem.replace(/[-_]/g, " ")), EVIDENCE_WEIGHTS.entry, `${e} in this directory`, "entry");
  }

  return { terms, reasons, sources };
}

/**
 * Score every profile against the directory's evidence.
 *
 * Returns matches sorted strongest-first, with `strength` normalized against
 * the top scorer so callers can map it onto their own score band.
 */
export function matchProfiles(evidence: RepoEvidence, docs: ProfileDoc[]): ProfileMatch[] {
  if (docs.length === 0 || evidence.terms.size === 0) return [];

  // Document frequency across profiles — how discriminating is each term?
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const t of doc.terms.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = docs.length;
  // The document-frequency cut is a statistic, and a statistic over a handful
  // of profiles is noise. Below `DF_CUT_MIN_PROFILES` it is skipped entirely,
  // and it never drops below 2 — otherwise a small custom profile library
  // discards every term shared by two profiles and matches nothing at all.
  const maxDf = n < DF_CUT_MIN_PROFILES ? n : Math.max(2, Math.floor(n * MAX_DF_RATIO));
  const idf = (t: string): number => Math.log(1 + n / (df.get(t) ?? n));

  const scored: ProfileMatch[] = [];
  for (const doc of docs) {
    // Breadth must not be an advantage in itself — see the module header.
    const damp = Math.sqrt(Math.max(doc.terms.size, 1));
    let score = 0;
    let corroborated = false;
    const contributions: Array<{ term: string; value: number }> = [];

    for (const [term, evWeight] of evidence.terms) {
      const profWeight = doc.terms.get(term);
      if (profWeight === undefined) continue;
      // Terms spread across a fifth of the library don't distinguish anything.
      if ((df.get(term) ?? 0) > maxDf) continue;
      const value = (evWeight * profWeight * idf(term)) / damp;
      score += value;
      contributions.push({ term, value });
      if (STRONG_SOURCES.has(evidence.sources.get(term) ?? "entry")) corroborated = true;
    }

    if (score <= 0) continue;

    // Corroboration rule: a filename alone never carries a match.
    //
    // Without this, every repo in a workspace matched `claude-api` because they
    // all have a CLAUDE.md, and `ros2` — backed by a real robot.urdf — ranked
    // BELOW that noise. Growing the stopword list to chase each such word is a
    // losing game; requiring one dependency, language, or marker hit ends the
    // whole class. Filenames still sharpen a match that already stands up.
    if (!corroborated) continue;
    contributions.sort((a, b) => b.value - a.value);
    const matchedTerms = contributions.slice(0, 3).map((c) => c.term);
    const why = evidence.reasons.get(matchedTerms[0]!) ?? matchedTerms.join(", ");
    scored.push({
      name: doc.name,
      strength: 0, // filled in below
      score,
      matchedTerms,
      reason: `matches ${matchedTerms.join(", ")} — ${why}`,
    });
  }

  if (scored.length === 0) return [];
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  // Absolute, not relative to the best hit — a directory that matches nothing
  // must be able to say so rather than crowning its loudest noise.
  for (const s of scored) s.strength = Math.min(1, s.score / STRONG_MATCH_SCORE);

  return scored.filter((s) => s.strength >= MATCH_MIN_STRENGTH);
}

/** Everything one directory's match needed, kept for callers that go further. */
export interface MatchContext {
  evidence: RepoEvidence;
  docs: ProfileDoc[];
  matches: ProfileMatch[];
}

/**
 * Read the profiles, read the directory, score — and hand back the inputs too.
 *
 * The LLM reranking tier needs the evidence and the profile docs, not just the
 * ranking, both to build its prompt and to key its cache. Returning them here
 * keeps `matchProfiles` pure and stops the caller from re-reading the whole
 * profile tree to get at them.
 *
 * Never throws: a failure costs the suggestion tail, not the picker.
 */
export function resolveMatchContext(
  cwd: string,
  opts: { root?: string; probe?: MatchProbe } = {},
): MatchContext | null {
  try {
    const probe = opts.probe ?? REAL_MATCH_PROBE;
    const docs = loadProfileDocs(opts.root ?? profilesRoot(), probe);
    const evidence = repoEvidence(cwd, probe);
    return { evidence, docs, matches: matchProfiles(evidence, docs) };
  } catch {
    return null;
  }
}

/**
 * Convenience wrapper for callers that only want the ranking.
 *
 * Never throws — a failure here costs the suggestion tail, not the picker.
 */
export function matchProfilesForCwd(
  cwd: string,
  opts: { root?: string; probe?: MatchProbe; limit?: number } = {},
): ProfileMatch[] {
  const ctx = resolveMatchContext(cwd, opts);
  if (!ctx) return [];
  return opts.limit ? ctx.matches.slice(0, opts.limit) : ctx.matches;
}
