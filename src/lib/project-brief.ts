/**
 * Project brief — verified facts about the directory the agent is launching in.
 *
 * A profile teaches the agent a domain; it can't know that *this* repo uses bun
 * rather than npm, that the tests run through `just check`, or where the entry
 * point lives. This module reads that off the filesystem — manifests, lockfiles,
 * CI config — and renders a compact block the launcher hands to the agent.
 *
 * Rules of the house:
 *   - Verified only. Everything here comes from a file that says so; nothing is
 *     inferred from vibes. A wrong fact is worse than a missing one.
 *   - `.env` values are NEVER read. The scanner notes only whether a committed
 *     `.env.example` exists.
 *   - Nothing throws. Every probe is guarded; a failure drops one field.
 *
 * `scanBrief` takes an injectable probe so the whole scanner is unit-testable
 * without touching a real filesystem.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** One runnable command the project actually declares. */
export interface BriefCommand {
  /** What it's for: "test", "build", "lint", "typecheck", "dev". */
  label: string;
  /** The command to run, verbatim. */
  command: string;
}

export interface ProjectBrief {
  /** Absolute path the scan ran against. */
  root: string;
  /** e.g. `{ name: "bun", via: "bun.lock" }`. */
  packageManager?: { name: string; via: string };
  commands: BriefCommand[];
  entrypoints: string[];
  layout: string[];
  /** How many further directories the layout cap hid. */
  layoutMore: number;
  workspaces: string[];
  /** Data-layer facts: "prisma (prisma/schema.prisma)", "alembic", … */
  data: string[];
  /** Commands CI actually runs. */
  ci: string[];
  defaultBranch?: string;
  /** True when a committed `.env.example`/`.env.sample` exists. Values unread. */
  hasEnvExample: boolean;
  /** Free-text notes from `.cue/project.md`, if the user wrote any. */
  notes: string[];
}

/** Filesystem access, injectable so tests stay hermetic. */
export interface BriefProbe {
  exists: (path: string) => boolean;
  /** File contents, or null when missing/unreadable. */
  read: (path: string) => string | null;
  /** Directory entry names, or [] when unreadable. */
  list: (path: string) => string[];
  /** Directory entry names that are themselves directories. */
  listDirs: (path: string) => string[];
}

export const REAL_PROBE: BriefProbe = {
  exists: (p) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  },
  read: (p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return null;
    }
  },
  list: (p) => {
    try {
      return readdirSync(p);
    } catch {
      return [];
    }
  },
  listDirs: (p) => {
    try {
      return readdirSync(p, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return [];
    }
  },
};

/** Directories that say nothing about a project's shape. */
const LAYOUT_NOISE = new Set([
  "node_modules", ".git", ".github", ".vscode", ".idea", "dist", "build", "out",
  "target", ".next", ".nuxt", ".svelte-kit", ".venv", "venv", "__pycache__",
  ".pytest_cache", "coverage", ".turbo", ".cache", ".parcel-cache", "tmp",
  ".claude", ".codex", ".cue", ".DS_Store", "vendor", ".ruff_cache", ".mypy_cache",
]);

/** Cap on layout entries so the block stays scannable. */
export const MAX_LAYOUT = 8;

/**
 * Directories worth naming first. Alphabetical order would spend the layout
 * budget on `action/ agentshield/ awesome-clis/…` and cut `src/` — the one
 * directory the agent actually needs. Anything not listed sorts after these,
 * alphabetically.
 */
const LAYOUT_PRIORITY = [
  "src", "lib", "app", "apps", "packages", "cmd", "internal", "pkg",
  "server", "client", "backend", "frontend", "storefront", "web", "api",
  "core", "profiles", "resources", "skills", "components", "modules",
  "tests", "test", "migrations", "db", "scripts", "docs", "config",
];
/** Cap on CI command lines. */
export const MAX_CI = 4;
/** Cap on workspace globs. */
export const MAX_WORKSPACES = 6;
/** Default render budget in characters. */
export const MAX_BRIEF_CHARS = 1500;

/** package.json script names worth surfacing, mapped to their brief label. */
const SCRIPT_LABELS: ReadonlyArray<[label: string, names: string[]]> = [
  ["test", ["test", "tests", "test:unit"]],
  ["build", ["build", "compile"]],
  ["lint", ["lint", "lint:check"]],
  ["typecheck", ["typecheck", "types", "check-types", "type-check"]],
  ["dev", ["dev", "start", "serve"]],
];

/** Makefile / justfile targets worth surfacing, in label order. */
const TARGET_LABELS: ReadonlyArray<[label: string, names: string[]]> = [
  ["test", ["test", "tests", "check"]],
  ["build", ["build", "all"]],
  ["lint", ["lint", "fmt", "format"]],
  ["dev", ["dev", "run", "serve"]],
];

/**
 * Scan a directory into a brief. Returns `null` when the directory carries
 * neither a manifest nor a git repo — there is nothing verified to say, and an
 * empty brief is just noise in the agent's context.
 */
export function scanBrief(cwd: string, probe: BriefProbe = REAL_PROBE): ProjectBrief | null {
  const has = (rel: string) => probe.exists(join(cwd, rel));
  const read = (rel: string) => probe.read(join(cwd, rel));

  const MANIFESTS = [
    "package.json", "Cargo.toml", "pyproject.toml", "go.mod", "Makefile",
    "justfile", "Justfile", "requirements.txt", "composer.json", "Gemfile",
  ];
  const hasManifest = MANIFESTS.some((m) => has(m));
  if (!hasManifest && !has(".git")) return null;

  const brief: ProjectBrief = {
    root: cwd,
    commands: [],
    entrypoints: [],
    layout: [],
    layoutMore: 0,
    workspaces: [],
    data: [],
    ci: [],
    hasEnvExample: false,
    notes: [],
  };

  const pkg = parseJson(read("package.json"));
  brief.packageManager = detectPackageManager(has, pkg !== null);
  const runner = brief.packageManager?.name;

  // ── commands ──────────────────────────────────────────────────────────────
  const seenLabels = new Set<string>();
  const addCommand = (label: string, command: string) => {
    if (seenLabels.has(label)) return;
    seenLabels.add(label);
    brief.commands.push({ label, command });
  };

  const scripts = (pkg?.scripts ?? {}) as Record<string, unknown>;
  const jsRunner = runner && runner !== "cargo" && runner !== "uv" && runner !== "poetry" && runner !== "pip"
    ? runner
    : "npm";
  for (const [label, names] of SCRIPT_LABELS) {
    const hit = names.find((n) => typeof scripts[n] === "string");
    if (hit) addCommand(label, `${jsRunner} run ${hit}`);
  }

  const makefile = read("Makefile") ?? read("makefile");
  if (makefile) {
    const targets = parseMakeTargets(makefile);
    for (const [label, names] of TARGET_LABELS) {
      const hit = names.find((n) => targets.includes(n));
      if (hit) addCommand(label, `make ${hit}`);
    }
  }

  const justfile = read("justfile") ?? read("Justfile");
  if (justfile) {
    const recipes = parseJustRecipes(justfile);
    for (const [label, names] of TARGET_LABELS) {
      const hit = names.find((n) => recipes.includes(n));
      if (hit) addCommand(label, `just ${hit}`);
    }
  }

  const cargo = read("Cargo.toml");
  if (cargo) {
    addCommand("test", "cargo test");
    addCommand("build", "cargo build");
    if (has("clippy.toml") || has(".clippy.toml")) addCommand("lint", "cargo clippy");
  }

  const pyproject = read("pyproject.toml");
  if (pyproject) {
    if (/\[tool\.pytest/.test(pyproject) || has("tests") || has("test")) {
      addCommand("test", "pytest");
    }
    if (/\bruff\b/.test(pyproject)) addCommand("lint", "ruff check .");
    if (/\bmypy\b/.test(pyproject)) addCommand("typecheck", "mypy .");
  }

  if (has("go.mod")) {
    addCommand("test", "go test ./...");
    addCommand("build", "go build ./...");
  }

  // ── entry points ──────────────────────────────────────────────────────────
  if (pkg) {
    const bin = pkg.bin;
    if (typeof bin === "string") brief.entrypoints.push(bin);
    else if (bin && typeof bin === "object") {
      for (const v of Object.values(bin as Record<string, unknown>)) {
        if (typeof v === "string") brief.entrypoints.push(v);
      }
    }
    if (typeof pkg.main === "string") brief.entrypoints.push(pkg.main);
  }
  for (const candidate of [
    "src/index.ts", "src/index.js", "src/main.ts", "src/main.rs", "main.go",
    "manage.py", "app/main.py", "src/app.py",
  ]) {
    if (has(candidate)) brief.entrypoints.push(candidate);
  }
  for (const dir of probe.listDirs(join(cwd, "cmd"))) {
    if (probe.exists(join(cwd, "cmd", dir, "main.go"))) brief.entrypoints.push(`cmd/${dir}/main.go`);
  }
  brief.entrypoints = dedupe(brief.entrypoints).slice(0, 4);

  // ── layout ────────────────────────────────────────────────────────────────
  const allDirs = probe
    .listDirs(cwd)
    .filter((d) => !d.startsWith(".") && !LAYOUT_NOISE.has(d))
    .sort((a, b) => {
      const rank = (d: string) => {
        const i = LAYOUT_PRIORITY.indexOf(d);
        return i < 0 ? LAYOUT_PRIORITY.length : i;
      };
      return rank(a) - rank(b) || a.localeCompare(b);
    });
  brief.layout = allDirs.slice(0, MAX_LAYOUT);
  brief.layoutMore = Math.max(0, allDirs.length - brief.layout.length);

  // ── workspaces ────────────────────────────────────────────────────────────
  const wsField = pkg?.workspaces;
  if (Array.isArray(wsField)) {
    brief.workspaces.push(...wsField.filter((w): w is string => typeof w === "string"));
  } else if (wsField && typeof wsField === "object" && Array.isArray((wsField as { packages?: unknown }).packages)) {
    brief.workspaces.push(
      ...((wsField as { packages: unknown[] }).packages.filter((w): w is string => typeof w === "string")),
    );
  }
  const pnpmWs = read("pnpm-workspace.yaml");
  if (pnpmWs) {
    for (const line of pnpmWs.split("\n")) {
      const m = /^\s*-\s+["']?([^"'\s]+)["']?\s*$/.exec(line);
      if (m?.[1]) brief.workspaces.push(m[1]);
    }
  }
  if (cargo && /\[workspace\]/.test(cargo)) brief.workspaces.push("cargo workspace");
  if (has("turbo.json")) brief.workspaces.push("turborepo");
  brief.workspaces = dedupe(brief.workspaces).slice(0, MAX_WORKSPACES);

  // ── data layer ────────────────────────────────────────────────────────────
  const dataMarkers: ReadonlyArray<[file: string, label: string]> = [
    ["prisma/schema.prisma", "prisma (prisma/schema.prisma)"],
    ["drizzle.config.ts", "drizzle (drizzle.config.ts)"],
    ["alembic.ini", "alembic migrations"],
    ["medusa-config.ts", "medusa"],
    ["medusa-config.js", "medusa"],
    ["supabase/config.toml", "supabase"],
  ];
  for (const [file, label] of dataMarkers) if (has(file)) brief.data.push(label);
  brief.data = dedupe(brief.data);

  // ── what CI runs ──────────────────────────────────────────────────────────
  brief.ci = scanCiCommands(cwd, probe);

  // ── git default branch ────────────────────────────────────────────────────
  const originHead = read(".git/refs/remotes/origin/HEAD");
  const branchMatch = originHead ? /refs\/remotes\/origin\/(\S+)/.exec(originHead) : null;
  if (branchMatch?.[1]) brief.defaultBranch = branchMatch[1];

  brief.hasEnvExample = has(".env.example") || has(".env.sample");

  // ── notes from an opt-in .cue/project.md ──────────────────────────────────
  const briefFile = read(BRIEF_FILE);
  if (briefFile) brief.notes = extractNotes(briefFile);

  return brief;
}

/** Lockfile → package manager. JS lockfiles win when a package.json exists. */
function detectPackageManager(
  has: (rel: string) => boolean,
  hasPackageJson: boolean,
): { name: string; via: string } | undefined {
  const js: ReadonlyArray<[file: string, name: string]> = [
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
  ];
  for (const [file, name] of js) if (has(file)) return { name, via: file };
  const others: ReadonlyArray<[file: string, name: string]> = [
    ["Cargo.lock", "cargo"],
    ["uv.lock", "uv"],
    ["poetry.lock", "poetry"],
  ];
  for (const [file, name] of others) if (has(file)) return { name, via: file };
  if (hasPackageJson) return { name: "npm", via: "package.json (no lockfile)" };
  return undefined;
}

/** Target names from a Makefile (`name:` at column 0, skipping .PHONY etc.). */
export function parseMakeTargets(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split("\n")) {
    const m = /^([a-zA-Z][\w.-]*)\s*:(?!=)/.exec(line);
    if (m?.[1] && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Recipe names from a justfile (`name:` or `name arg:` at column 0). */
export function parseJustRecipes(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split("\n")) {
    const m = /^([a-zA-Z][\w-]*)(?:\s+[^:]*)?:(?!=)/.exec(line);
    if (m?.[1] && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Verbs that make a CI `run:` line worth quoting to the agent. */
const CI_VERBS = /\b(test|build|lint|typecheck|type-check|check|fmt|format)\b/;

/**
 * Commands CI actually runs, harvested from `.github/workflows/*.yml`. Reads at
 * most three workflow files and keeps the lines that name a known verb — the
 * point is "here is what has to pass", not a full pipeline dump.
 */
export function scanCiCommands(cwd: string, probe: BriefProbe): string[] {
  const dir = join(cwd, ".github", "workflows");
  const files = probe
    .list(dir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort()
    .slice(0, 3);
  const out: string[] = [];
  for (const file of files) {
    const content = probe.read(join(dir, file));
    if (!content) continue;
    for (const line of content.split("\n")) {
      const m = /^\s*(?:-\s*)?run:\s*(.+?)\s*$/.exec(line);
      const cmd = m?.[1]?.replace(/^["']|["']$/g, "");
      // Multi-line `run: |` blocks and shell noise aren't useful one-liners.
      if (!cmd || cmd === "|" || cmd === ">" || cmd.length > 60) continue;
      if (!CI_VERBS.test(cmd)) continue;
      if (!out.includes(cmd)) out.push(cmd);
      if (out.length >= MAX_CI) return out;
    }
  }
  return out;
}

function parseJson(raw: string | null): Record<string, any> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.filter((s) => s.length > 0))];
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Column the values line up at in the rendered block. */
const LABEL_COL = 18;

/**
 * Render the brief as the block handed to the agent. Aligned key/value lines —
 * dense, greppable, and cheap in tokens. Returns "" when the brief carries no
 * facts worth stating (a bare git directory with no manifest).
 */
export function renderBrief(
  brief: ProjectBrief,
  opts: { maxChars?: number; includeNotes?: boolean } = {},
): string {
  // `.cue/project.md` keeps its notes *below* the generated block, so writing
  // that file renders without them — otherwise every rewrite would fold the
  // notes back into the machine block and duplicate them.
  const includeNotes = opts.includeNotes !== false;
  const rows: Array<[string, string]> = [];
  if (brief.packageManager) {
    rows.push(["package manager", `${brief.packageManager.name} (${brief.packageManager.via})`]);
  }
  for (const c of brief.commands) rows.push([c.label, c.command]);
  if (brief.entrypoints.length > 0) rows.push(["entry", brief.entrypoints.join(", ")]);
  if (brief.layout.length > 0) {
    const more = brief.layoutMore > 0 ? ` (+${brief.layoutMore} more)` : "";
    rows.push(["layout", brief.layout.map((d) => `${d}/`).join(" ") + more]);
  }
  if (brief.workspaces.length > 0) rows.push(["workspaces", brief.workspaces.join(", ")]);
  if (brief.data.length > 0) rows.push(["data", brief.data.join(", ")]);
  if (brief.ci.length > 0) rows.push(["ci runs", brief.ci.join(" · ")]);
  if (brief.defaultBranch) rows.push(["default branch", brief.defaultBranch]);
  if (brief.hasEnvExample) rows.push([".env", ".env.example present (values not read)"]);

  const notes = includeNotes ? brief.notes : [];
  if (rows.length === 0 && notes.length === 0) return "";

  const lines: string[] = [];
  lines.push("## This project");
  lines.push("");
  lines.push(
    "Facts scanned from the working directory by cue. Prefer these commands over " +
      "guesses — they come from the project's own manifests.",
  );
  lines.push("");
  for (const [label, value] of rows) {
    lines.push(`${label.padEnd(LABEL_COL)}${value}`);
  }
  if (notes.length > 0) {
    lines.push("");
    lines.push("Notes from .cue/project.md:");
    for (const note of notes) lines.push(`- ${note}`);
  }

  const text = lines.join("\n");
  const max = opts.maxChars ?? MAX_BRIEF_CHARS;
  if (text.length <= max) return text;
  return `${text.slice(0, max - 20).trimEnd()}\n… (brief truncated)`;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/** How a rendered brief reaches one agent process. */
export interface BriefInjection {
  /** Arguments to prepend to the agent's argv. */
  args: string[];
  /** Environment additions for the child process. */
  env: Record<string, string>;
  /** File the caller must write first (codex has no system-prompt flag). */
  file?: { path: string; content: string };
}

/**
 * Route a brief to an agent **per process**.
 *
 * This never goes through the materialized memory file: the runtime directory
 * is keyed by profile, shared by every directory using that profile and by
 * every parallel session, so repo-specific text written there would leak
 * across projects and race between sessions.
 *
 *   - claude-code takes `--append-system-prompt`, which is exactly this.
 *   - codex has no equivalent flag, so the brief is written to a per-cwd file
 *     and pointed at with `CUE_PROJECT_BRIEF`; the materialized AGENTS.md
 *     carries one *static* line telling the agent to read it.
 *
 * An empty brief injects nothing. Pure — the caller owns the write.
 */
export function buildBriefInjection(opts: {
  agent: "claude-code" | "codex" | string;
  brief: string;
  /** Directory for per-cwd brief files (codex path). */
  briefDir: string;
  cwd: string;
}): BriefInjection {
  const brief = opts.brief.trim();
  if (brief.length === 0) return { args: [], env: {} };
  if (opts.agent === "claude-code") {
    return { args: ["--append-system-prompt", brief], env: {} };
  }
  const path = join(opts.briefDir, `${briefFileKey(opts.cwd)}.md`);
  return { args: [], env: { CUE_PROJECT_BRIEF: path }, file: { path, content: `${brief}\n` } };
}

/** Stable per-directory filename component. */
export function briefFileKey(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}

/**
 * The one static line the codex memory file carries. Static on purpose: the
 * runtime AGENTS.md is shared across directories, so it must not contain any
 * directory-specific text — only a pointer to the per-process env var.
 */
export const CODEX_BRIEF_POINTER =
  "When `CUE_PROJECT_BRIEF` is set in the environment, read that file before " +
  "your first action — it lists this directory's verified commands and layout.";

// ---------------------------------------------------------------------------
// .cue/project.md — the opt-in persisted brief
// ---------------------------------------------------------------------------

export const BRIEF_FILE = ".cue/project.md";
export const GEN_START = "<!-- cue:generated — do not edit below -->";
export const GEN_END = "<!-- /cue:generated -->";

/**
 * Split a `.cue/project.md` into its machine block and everything else. A file
 * without markers is treated as all-notes, so a hand-written file is never
 * mistaken for generated content and overwritten.
 */
export function splitBriefFile(content: string): { generated: string; rest: string } {
  const start = content.indexOf(GEN_START);
  const end = content.indexOf(GEN_END);
  if (start < 0 || end < 0 || end < start) return { generated: "", rest: content };
  const generated = content.slice(start + GEN_START.length, end).trim();
  const rest = (content.slice(0, start) + content.slice(end + GEN_END.length)).trim();
  return { generated, rest };
}

/**
 * The free-text notes a user (or the agent) wrote under `## Notes`. Bullet
 * lines only — prose paragraphs are skipped so the injected block stays tight.
 */
export function extractNotes(content: string): string[] {
  const { rest } = splitBriefFile(content);
  const out: string[] = [];
  let inNotes = false;
  for (const line of rest.split("\n")) {
    if (/^#{1,6}\s/.test(line)) {
      inNotes = /notes/i.test(line);
      continue;
    }
    if (!inNotes) continue;
    const m = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
    if (m?.[1]) out.push(m[1]);
  }
  return out;
}

/** The default body for a freshly created `.cue/project.md`. */
const NOTES_TEMPLATE = `## Notes

Anything cue can't scan — conventions, gotchas, "always do X before Y".
These lines are handed to the agent alongside the generated block above.

- `;

/**
 * Produce the new contents of `.cue/project.md`: the generated block replaced,
 * everything the user wrote preserved. A missing file gets the notes template.
 * Pure — the caller owns the write.
 */
export function mergeBriefFile(existing: string | null, generated: string): string {
  const block = `${GEN_START}\n${generated}\n${GEN_END}`;
  if (existing === null || existing.trim().length === 0) {
    return `${block}\n\n${NOTES_TEMPLATE}\n`;
  }
  const { rest } = splitBriefFile(existing);
  return rest.length > 0 ? `${block}\n\n${rest}\n` : `${block}\n`;
}
