/**
 * Context-aware auto-profile detection.
 * Scans cwd for project signals and scores against known profiles.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * V2 detection result with 0-1 confidence and reasons array.
 */
export interface DetectionResultV2 {
  profile: string;
  confidence: number; // 0.0 - 1.0
  reasons: string[];
}

/**
 * Read package.json dependencies to boost detection.
 */
function readPackageDeps(cwd: string): { deps: Set<string>; devDeps: Set<string> } {
  const deps = new Set<string>();
  const devDeps = new Set<string>();
  try {
    const raw = readFileSync(join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    if (pkg.dependencies) for (const k of Object.keys(pkg.dependencies)) deps.add(k);
    if (pkg.devDependencies) for (const k of Object.keys(pkg.devDependencies)) devDeps.add(k);
  } catch { /* no package.json or invalid */ }
  return { deps, devDeps };
}

/** True when any dependency name starts with `prefix` (for scoped packages). */
function hasPrefix(deps: Set<string>, prefix: string): boolean {
  for (const d of deps) if (d.startsWith(prefix)) return true;
  return false;
}

/** True when any of `names` is present in the dependency set. */
function hasAny(deps: Set<string>, names: string[]): boolean {
  for (const n of names) if (deps.has(n)) return true;
  return false;
}

/**
 * Service/integration dependency → profile suggestions. Unlike the framework
 * chain below (mutually exclusive — a repo is *either* a Next.js app or a
 * Vite app), these are additive: a Next.js shop with `stripe` installed gets
 * both `nextjs` and `stripe` suggested. Confidence sits in the
 * [SUGGESTED_MIN_CONFIDENCE, SUGGESTED_AUTO_PICK_CONFIDENCE) band on purpose:
 * high enough to show in the picker, low enough to never outrank the primary
 * stack profile or hijack the Enter default. Only profiles that exist in
 * profiles/ belong here — the picker drops unknown names, but a dead rule is
 * still noise.
 */
export interface DepProfileRule {
  profile: string;
  /** Exact dependency names that trigger the rule. */
  deps?: string[];
  /** Scoped-package prefixes, e.g. "@aws-sdk/". */
  prefixes?: string[];
  /** Python package names (PEP 503 normalized: lowercase, `_`/`.` → `-`). */
  pyDeps?: string[];
  confidence: number;
  reason: string;
  /**
   * Eligible as a combine-multiselect companion (see `serviceCompanions`).
   * True for service integrations that ride alongside a primary stack;
   * false/omitted for rules that ARE a primary stack (react-native).
   */
  companion?: boolean;
}

export const DEP_PROFILE_RULES: DepProfileRule[] = [
  { profile: "stripe", deps: ["stripe"], prefixes: ["@stripe/"], pyDeps: ["stripe"], confidence: 0.6, reason: "package.json has stripe", companion: true },
  { profile: "aws", deps: ["aws-sdk", "aws-cdk"], prefixes: ["@aws-sdk/", "@aws-cdk/"], pyDeps: ["boto3", "botocore", "aws-cdk-lib"], confidence: 0.6, reason: "package.json has @aws-sdk/*", companion: true },
  { profile: "supabase", prefixes: ["@supabase/"], pyDeps: ["supabase"], confidence: 0.6, reason: "package.json has @supabase/*", companion: true },
  { profile: "slack", prefixes: ["@slack/"], pyDeps: ["slack-sdk"], confidence: 0.6, reason: "package.json has @slack/*", companion: true },
  { profile: "postgres", deps: ["pg", "postgres", "pg-promise"], pyDeps: ["psycopg", "psycopg2", "psycopg2-binary", "asyncpg"], confidence: 0.55, reason: "package.json has pg/postgres", companion: true },
  { profile: "resend", deps: ["resend"], pyDeps: ["resend"], confidence: 0.6, reason: "package.json has resend", companion: true },
  { profile: "strapi", prefixes: ["@strapi/"], confidence: 0.65, reason: "package.json has @strapi/*", companion: true },
  { profile: "threejs", deps: ["three"], confidence: 0.6, reason: "package.json has three", companion: true },
  // react-native is a primary stack, not a service: an RN repo also has
  // `react`, which the framework chain reads as plain `frontend` (0.8) — so
  // this one rule sits above the band to outrank that misread.
  { profile: "react-native", deps: ["react-native", "expo"], prefixes: ["@react-native/"], confidence: 0.85, reason: "package.json has react-native/expo" },
];

const ex = (cwd: string, rel: string): boolean => existsSync(join(cwd, rel));
const exAny = (cwd: string, rels: string[]): boolean => rels.some((r) => ex(cwd, r));

/**
 * Cap on workspace child package.jsons read per detection. The picker calls
 * detectProfileV2 synchronously on every launch, so a huge monorepo must not
 * turn profile suggestion into a directory crawl.
 */
const MAX_WORKSPACE_PKGS = 24;

/**
 * Union of dependency names across workspace child packages, so a monorepo
 * ROOT cwd still detects service deps (stripe in packages/api). Patterns come
 * from package.json `workspaces` (array or {packages}) and pnpm-workspace.yaml.
 * Best-effort glob support: exact paths and single trailing `/*` only — deeper
 * globs (`**`, or a `*` mid-path) are skipped, negations ignored.
 */
function readWorkspaceDeps(cwd: string): Set<string> {
  const patterns: string[] = [];
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
    if (Array.isArray(ws)) for (const w of ws) if (typeof w === "string") patterns.push(w);
  } catch { /* no root package.json */ }
  try {
    const raw = readFileSync(join(cwd, "pnpm-workspace.yaml"), "utf8");
    const section = raw.match(/^packages:\s*\n((?:[ \t]*-[^\n]*\n?)*)/m);
    if (section) {
      for (const m of section[1]!.matchAll(/-\s*["']?([^"'\n#]+)/g)) patterns.push(m[1]!.trim());
    }
  } catch { /* no pnpm workspace file */ }

  const deps = new Set<string>();
  let read = 0;
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) continue;
    const dirs: string[] = [];
    if (pattern.endsWith("/*") && !pattern.slice(0, -2).includes("*")) {
      const base = pattern.slice(0, -2);
      try {
        for (const e of readdirSync(join(cwd, base), { withFileTypes: true })) {
          if (e.isDirectory()) dirs.push(join(base, e.name));
        }
      } catch { /* glob base missing */ }
    } else if (!pattern.includes("*")) {
      dirs.push(pattern);
    }
    for (const dir of dirs) {
      if (read >= MAX_WORKSPACE_PKGS) return deps;
      try {
        const pkg = JSON.parse(readFileSync(join(cwd, dir, "package.json"), "utf8"));
        read += 1;
        for (const k of Object.keys(pkg.dependencies ?? {})) deps.add(k);
        for (const k of Object.keys(pkg.devDependencies ?? {})) deps.add(k);
      } catch { /* dir without package.json */ }
    }
  }
  return deps;
}

/** PEP 503 name normalization: lowercase, runs of `-`/`_`/`.` → single `-`. */
const normPyName = (name: string): string => name.toLowerCase().replace(/[-_.]+/g, "-");

/**
 * Best-effort Python dependency names from requirements.txt and
 * pyproject.toml, for the `pyDeps` side of DEP_PROFILE_RULES. requirements
 * lines are parsed properly (comments, extras, version specifiers, env
 * markers stripped); pyproject is a cheap regex over quoted strings in
 * `dependencies = [...]` arrays plus `[tool.poetry.dependencies]` keys — not
 * a TOML parser, same best-effort discipline as the rest of this module.
 * `source` names the file that contributed deps, for detection reasons.
 */
function readPythonDeps(cwd: string): { deps: Set<string>; source: string } {
  const deps = new Set<string>();
  const sources: string[] = [];
  try {
    const raw = readFileSync(join(cwd, "requirements.txt"), "utf8");
    for (const line of raw.split("\n")) {
      const bare = line.split("#")[0]!.trim();
      if (!bare || bare.startsWith("-")) continue; // blank / pip flags (-r, -e, --hash)
      const m = bare.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);
      if (m) deps.add(normPyName(m[1]!));
    }
    if (deps.size > 0) sources.push("requirements.txt");
  } catch { /* no requirements.txt */ }
  try {
    const raw = readFileSync(join(cwd, "pyproject.toml"), "utf8");
    const before = deps.size;
    // Quoted entries inside any `dependencies = [...]` array ([project] or
    // optional-dependencies groups).
    for (const arr of raw.matchAll(/dependencies\s*=\s*\[([^\]]*)\]/g)) {
      for (const q of arr[1]!.matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)/g)) {
        deps.add(normPyName(q[1]!));
      }
    }
    // `[tool.poetry.dependencies]` table keys (one `name = ...` per line).
    const poetry = raw.match(/\[tool\.poetry\.dependencies\]([^[]*)/);
    if (poetry) {
      for (const line of poetry[1]!.split("\n")) {
        const m = line.match(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/);
        if (m && m[1] !== "python") deps.add(normPyName(m[1]!));
      }
    }
    if (deps.size > before) sources.push("pyproject.toml");
  } catch { /* no pyproject.toml */ }
  return { deps, source: sources.join(" + ") };
}

/**
 * Per-extra-signal confidence boost. A profile backed by several independent
 * signals (e.g. `medusa-config.ts` + `@medusajs/*` dep) is a stronger match
 * than one backed by a single file, so corroboration nudges confidence toward
 * the cap. Single-signal detections are untouched.
 */
const CORROBORATION_STEP = 0.05;
const CONFIDENCE_CAP = 0.97;

/**
 * Enhanced v2 detection with package.json awareness and 0-1 confidence.
 *
 * Each `add()` records the strongest single signal for a profile (max
 * confidence) and accumulates the reasons. After all signals are gathered,
 * profiles corroborated by 2+ independent signals get a small per-signal boost
 * (capped), so an agreement of weak signals can out-rank a lone strong one.
 */
export function detectProfileV2(cwd: string): DetectionResultV2[] {
  const results = new Map<string, { confidence: number; reasons: string[] }>();

  function add(profile: string, confidence: number, reason: string) {
    const entry = results.get(profile) ?? { confidence: 0, reasons: [] };
    entry.confidence = Math.max(entry.confidence, confidence);
    // Dedupe reasons so the same file counted twice doesn't inflate the boost.
    if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
    results.set(profile, entry);
  }

  // Domain-first signals: advertising repos are often infrastructure-shaped
  // (Docker/Coolify) but their primary job is campaign management. Prefer the
  // domain profile over generic ops when the repo name/docs/scripts say Ads.
  const repoText = `${cwd} ${basename(cwd)}`.toLowerCase();
  const adsSignal = /(^|[^a-z])(ads?|google[-_ ]?ads|campaigns?|ppc|roas|gaql|ad[-_ ]?copy)([^a-z]|$)/.test(repoText);
  if (adsSignal) {
    add("google-ads", 0.86, "repository name suggests advertising");
    add("claude-ads", 0.78, "repository name suggests advertising");
    add("marketing", 0.72, "repository name suggests advertising");
    add("ads-manager", 0.68, "repository name suggests advertising");
  }

  // ── Rust ──
  if (ex(cwd, "Cargo.toml")) {
    add("rust", 0.9, "Cargo.toml");
    if (ex(cwd, "src/main.rs")) add("rust", 0.7, "src/main.rs");
    if (ex(cwd, "src/lib.rs")) add("rust", 0.6, "src/lib.rs");
  }

  // ── Go ──
  if (ex(cwd, "go.mod")) add("go-api", 0.8, "go.mod");
  if (ex(cwd, "main.go")) add("go-api", 0.6, "main.go");
  if (exAny(cwd, ["cmd", "internal"])) add("go-api", 0.4, "cmd/ or internal/");

  // ── Python ──
  if (ex(cwd, "pyproject.toml")) add("python", 0.7, "pyproject.toml");
  if (ex(cwd, "requirements.txt")) add("python", 0.7, "requirements.txt");
  if (ex(cwd, "manage.py")) add("python", 0.8, "manage.py");
  if (exAny(cwd, ["alembic.ini", "app/main.py"])) add("python", 0.6, "alembic.ini or app/main.py");

  // ── Backend (containers / CI / DB) ──
  if (exAny(cwd, ["docker-compose.yml", "docker-compose.yaml", "Dockerfile"])) {
    add("backend", 0.5, "docker-compose / Dockerfile");
  }
  if (exAny(cwd, ["prisma/schema.prisma", "drizzle.config.ts"])) add("backend", 0.5, "prisma / drizzle");
  if (ex(cwd, ".github/workflows")) add("backend", 0.3, ".github/workflows/");

  // ── On-disk framework config files (corroborate the package.json deps below) ──
  if (exAny(cwd, ["next.config.js", "next.config.ts", "next.config.mjs"])) {
    add("nextjs", 0.85, "next.config.*");
  }
  if (exAny(cwd, ["vite.config.ts", "vite.config.js"])) add("frontend", 0.6, "vite.config.*");
  if (exAny(cwd, ["tailwind.config.js", "tailwind.config.ts"])) add("frontend", 0.4, "tailwind.config.*");

  // ── Vercel (deploy target) — an explicit vercel.json / .vercel signals intent
  // to use Vercel, so it edges out the bare framework profile (nextjs/frontend).
  if (exAny(cwd, ["vercel.json", ".vercel/project.json"])) add("vercel", 0.95, "vercel.json");
  else if (ex(cwd, ".vercel")) add("vercel", 0.9, ".vercel/");

  // ── Docs ──
  if (exAny(cwd, ["astro.config.mjs", "docusaurus.config.js", "mkdocs.yml"])) {
    add("docs-writer", 0.7, "astro / docusaurus / mkdocs config");
  }

  // ── Medusa (commerce) — its own strongest signals ──
  const isMedusaBackend = exAny(cwd, ["medusa-config.js", "medusa-config.ts", "packages/medusa"]);
  if (isMedusaBackend) add("medusa-dev", 0.9, "medusa-config.*");

  // ── Fleet / meta ──
  if (exAny(cwd, [".colony", ".omx", "scripts/codex-fleet"])) add("fleet-control", 0.6, "fleet markers");
  if (exAny(cwd, ["CLAUDE.md", ".claude"])) add("core", 0.4, "CLAUDE.md or .claude/");
  if (ex(cwd, "profiles")) add("full", 0.3, "profiles/ dir");

  // ── package.json deps ──
  if (ex(cwd, "package.json")) {
    const { deps, devDeps } = readPackageDeps(cwd);
    const allDeps = new Set([...deps, ...devDeps]);
    const isMedusaPkg = hasPrefix(allDeps, "@medusajs/");
    if (isMedusaPkg && allDeps.has("next")) {
      // Medusa storefront on Next.js.
      add("medusa-next", 0.85, "package.json @medusajs + next");
    } else if (isMedusaPkg && hasAny(allDeps, ["vite"])) {
      // Medusa storefront on Vite (the canonical storefront pattern).
      add("medusa-vite", 0.85, "package.json @medusajs + vite");
    } else if (isMedusaPkg) {
      add("medusa-dev", 0.85, "package.json @medusajs/*");
    } else if (allDeps.has("next")) {
      add("nextjs", 0.9, "package.json has next");
    } else if (hasAny(allDeps, ["astro", "@docusaurus/core"])) {
      add("docs-writer", 0.8, "package.json docs framework");
    } else if (allDeps.has("react")) {
      add("frontend", 0.8, "package.json has react");
    } else {
      add("backend", 0.6, "package.json (no framework)");
    }
    // Vercel CLI / SDK in deps corroborates an existing vercel.json signal.
    if (hasPrefix(allDeps, "@vercel/") || allDeps.has("vercel")) {
      add("vercel", 0.6, "package.json @vercel/* or vercel");
    }
    // Service/integration deps (stripe, @aws-sdk/*, …) — additive, see table.
    for (const rule of DEP_PROFILE_RULES) {
      const hit =
        (rule.deps !== undefined && hasAny(allDeps, rule.deps)) ||
        (rule.prefixes ?? []).some((p) => hasPrefix(allDeps, p));
      if (hit) add(rule.profile, rule.confidence, rule.reason);
    }
  }

  // ── Workspace child deps (monorepo roots) — same rule table ──
  if (exAny(cwd, ["package.json", "pnpm-workspace.yaml"])) {
    const wsDeps = readWorkspaceDeps(cwd);
    if (wsDeps.size > 0) {
      for (const rule of DEP_PROFILE_RULES) {
        const hit =
          (rule.deps !== undefined && hasAny(wsDeps, rule.deps)) ||
          (rule.prefixes ?? []).some((p) => hasPrefix(wsDeps, p));
        if (hit) add(rule.profile, rule.confidence, `workspace ${rule.reason}`);
      }
    }
  }

  // ── Python deps (requirements.txt / pyproject.toml) — same rule table ──
  if (exAny(cwd, ["requirements.txt", "pyproject.toml"])) {
    const { deps: pyDeps, source } = readPythonDeps(cwd);
    if (pyDeps.size > 0) {
      for (const rule of DEP_PROFILE_RULES) {
        if (rule.pyDeps === undefined) continue;
        const matched = rule.pyDeps.find((d) => pyDeps.has(d));
        if (matched !== undefined) add(rule.profile, rule.confidence, `${source} has ${matched}`);
      }
    }
  }

  return [...results.entries()]
    .map(([profile, { confidence, reasons }]) => {
      // Corroboration boost: each signal beyond the first nudges confidence up
      // toward the cap. Lone signals keep their base value (tested contract).
      const boosted = reasons.length > 1
        ? Math.min(CONFIDENCE_CAP, confidence + CORROBORATION_STEP * (reasons.length - 1))
        : confidence;
      return { profile, confidence: boosted, reasons };
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}
