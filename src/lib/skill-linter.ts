/**
 * Pure SKILL.md linter. Validates against the Anthropic SKILL.md spec and
 * emits both diagnostics and fix functions where appropriate.
 *
 * Each rule is independent. Rules return Diagnostic[] (zero diagnostics means
 * the rule passed). A rule can optionally provide a `fix` that transforms the
 * SKILL.md content string; the caller (cue lint-skill --fix) decides whether
 * to apply.
 *
 * No I/O. No network. Callers handle file reads, writes, and PR posting.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCLIsFromContent, parseMetadataFromContent } from "../commands/optimizer";

// ---------------------------------------------------------------------------
// Per-CLI install command lookup (used by R006).
// Reads resources/cli-recipes.json so the auto-generated Prerequisites
// section emits real commands instead of generic "use your package manager".
// ---------------------------------------------------------------------------

interface Recipe { apt?: string; brew?: string; dnf?: string; pacman?: string; snap?: string; pip?: string; pipx?: string; npm?: string; script?: string; manual?: string; needs?: string; }
let _recipesCache: Record<string, Recipe> | null = null;
function loadRecipes(): Record<string, Recipe> {
  if (_recipesCache) return _recipesCache;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = resolve(here, "..", "..", "resources", "cli-recipes.json");
    _recipesCache = JSON.parse(readFileSync(path, "utf8")) as Record<string, Recipe>;
  } catch {
    _recipesCache = {};
  }
  return _recipesCache;
}

/**
 * Render the install line for a single CLI. Prefers per-platform package
 * managers (Linux + macOS), falls back to manual hint. Emits a single
 * Markdown list item that's safe to embed in any SKILL.md.
 */
function renderInstallLine(cli: string): string {
  const r = loadRecipes()[cli];
  if (!r) return `- \`${cli}\` — install via your package manager`;
  const segments: string[] = [];
  // Linux options (prefer apt as most common, then snap, then dnf/pacman)
  if (r.apt) segments.push(`apt: \`sudo apt install -y ${r.apt}\``);
  else if (r.snap) segments.push(`snap: \`sudo snap install ${r.snap} --classic\``);
  else if (r.dnf) segments.push(`dnf: \`sudo dnf install -y ${r.dnf}\``);
  else if (r.pacman) segments.push(`pacman: \`sudo pacman -S ${r.pacman}\``);
  if (r.brew) segments.push(`brew: \`brew install ${r.brew}\``);
  if (r.pipx) segments.push(`pipx: \`pipx install ${r.pipx}\``);
  else if (r.pip) segments.push(`pip: \`pipx install ${r.pip}\` _(or \`pip install --user ${r.pip}\`)_`);
  if (r.npm) segments.push(`npm: \`npm install -g ${r.npm}\``);
  if (segments.length === 0 && r.manual) return `- \`${cli}\` — ${r.manual}`;
  if (segments.length === 0 && r.script) return `- \`${cli}\` — run: \`${r.script}\``;
  if (segments.length === 0) return `- \`${cli}\` — install via your package manager`;
  const note = r.needs ? `  _Note: ${r.needs}_` : "";
  return `- **${cli}** — ${segments.join(" · ")}${note}`;
}

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  rule: string;          // e.g. "R001"
  severity: Severity;
  message: string;
  line?: number;         // 1-based, optional
  /** Pure transform: given current content, return fixed content. Idempotent. */
  fix?: (content: string) => string;
}

export interface LintResult {
  diagnostics: Diagnostic[];
  fixable: number;
  /** 0–100 quality score: 100 - (20*errors + 5*warnings + 1*infos), clamped. */
  score: number;
}

/**
 * Compute a 0–100 quality score from a diagnostics list. Weighted so a single
 * error has more weight than five warnings. The score is not the goal; it's a
 * sortable proxy for "which skills need triage first."
 */
export function scoreDiagnostics(diagnostics: Diagnostic[]): number {
  let s = 100;
  for (const d of diagnostics) {
    if (d.severity === "error") s -= 20;
    else if (d.severity === "warning") s -= 5;
    else s -= 1;
  }
  return Math.max(0, Math.min(100, s));
}

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------

function getFrontmatter(content: string): { yaml: string; start: number; end: number } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  return { yaml: match[1]!, start: 0, end: match[0].length };
}

function fmField(yaml: string, key: string): string {
  const m = yaml.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
  return m ? m[1]!.trim() : "";
}

function bodyAfterFrontmatter(content: string): string {
  const fm = getFrontmatter(content);
  return fm ? content.slice(fm.end).replace(/^\n/, "") : content;
}

/** Insert a new field at the bottom of the frontmatter (just before the closing ---). */
function insertFrontmatterField(content: string, key: string, value: string): string {
  const fm = getFrontmatter(content);
  if (!fm) {
    // No frontmatter at all — create one
    return `---\n${key}: ${value}\n---\n\n${content}`;
  }
  const newYaml = fm.yaml + `\n${key}: ${value}`;
  return `---\n${newYaml}\n---` + content.slice(fm.end);
}

/** Slugify a string → kebab-case for derived `name:` values. */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}

// ---------------------------------------------------------------------------
// Ignore directives
//
// Two forms suppress lint diagnostics:
//   - Frontmatter: `lint-ignore: R009, R010` (or `[R009, R010]`)
//     Suppresses those rules across the whole file.
//   - Inline HTML comment: `<!-- lint-ignore R009 -->`
//     Suppresses R009 on the comment's own line and the next line. Use
//     `lint-ignore *` to suppress every rule on that line.
// ---------------------------------------------------------------------------

interface IgnoreSet {
  fileRules: Set<string>;
  /** Map of 1-based line number → set of suppressed rule ids ("*" = all). */
  lineRules: Map<number, Set<string>>;
}

function parseRuleList(raw: string): string[] {
  return raw
    .replace(/^\[|\]$/g, "")
    .split(/[,\s]+/)
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function parseIgnores(content: string): IgnoreSet {
  const fileRules = new Set<string>();
  const fm = getFrontmatter(content);
  if (fm) {
    const raw = fmField(fm.yaml, "lint-ignore");
    if (raw) for (const r of parseRuleList(raw)) fileRules.add(r);
  }

  const lineRules = new Map<number, Set<string>>();
  const commentRe = /<!--\s*lint-ignore\s+([^\-]+?)\s*-->/g;
  for (const m of content.matchAll(commentRe)) {
    if (m.index === undefined) continue;
    const rules = parseRuleList(m[1] ?? "");
    if (rules.length === 0) continue;
    const commentLine = lineOf(content, m.index);
    for (const ln of [commentLine, commentLine + 1]) {
      const existing = lineRules.get(ln) ?? new Set<string>();
      for (const r of rules) existing.add(r);
      lineRules.set(ln, existing);
    }
  }

  return { fileRules, lineRules };
}

function isIgnored(diag: Diagnostic, ignores: IgnoreSet): boolean {
  if (ignores.fileRules.has(diag.rule) || ignores.fileRules.has("*")) return true;
  if (diag.line !== undefined) {
    const lineSet = ignores.lineRules.get(diag.line);
    if (lineSet && (lineSet.has(diag.rule) || lineSet.has("*"))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * R001 — frontmatter must declare `name:` (used by Claude's skill discovery
 * for the canonical id). Auto-fix: derive from the first `# Heading` in the
 * body, slugified.
 */
function ruleR001(content: string): Diagnostic[] {
  const fm = getFrontmatter(content);
  if (fm && fmField(fm.yaml, "name")) return [];
  const body = bodyAfterFrontmatter(content);
  const heading = body.match(/^#\s+(.+)$/m);
  const derived = heading ? slugify(heading[1]!) : "";
  return [{
    rule: "R001",
    severity: "error",
    message: "Frontmatter missing `name:` field — required for skill discovery.",
    fix: derived ? (c) => insertFrontmatterField(c, "name", derived) : undefined,
  }];
}

/**
 * R002 — frontmatter must declare `description:` (the trigger sentence Claude
 * matches against user requests). No auto-fix: the description needs human
 * judgment about *when* the skill should fire.
 */
function ruleR002(content: string): Diagnostic[] {
  const fm = getFrontmatter(content);
  if (fm && fmField(fm.yaml, "description")) return [];
  return [{
    rule: "R002",
    severity: "error",
    message: "Frontmatter missing `description:` — required so Claude knows when to invoke the skill.",
  }];
}

/**
 * R003 — description ≤ 200 chars. Anthropic's discovery truncates beyond
 * that and you lose the trigger semantics. No auto-fix (needs rewriting).
 */
function ruleR003(content: string): Diagnostic[] {
  // Read directly from frontmatter, not parseMetadataFromContent (which clips).
  const fm = getFrontmatter(content);
  if (!fm) return [];
  const raw = fmField(fm.yaml, "description");
  if (!raw || raw.length <= 200) return [];
  return [{
    rule: "R003",
    severity: "warning",
    message: `Description is ${raw.length} chars (>200); Claude's discovery may truncate it.`,
  }];
}

/**
 * R004 — description must contain a trigger phrase OR frontmatter must
 * declare a `triggers:` list. The strongest signals for Claude's discovery
 * are second-person verbs ("Use when …", "Triggers …", "When the user …"),
 * and explicit structured triggers are an equally good signal.
 */
function ruleR004(content: string): Diagnostic[] {
  const fm = getFrontmatter(content);
  // Explicit `triggers:` field with any content counts as a trigger signal.
  if (fm && /^triggers:\s*(\n\s+-\s+\S|\S)/m.test(fm.yaml)) return [];

  const meta = parseMetadataFromContent(content);
  if (!meta.description) return [];
  const lower = meta.description.toLowerCase();
  const triggers = ["use when", "triggers", "when the user", "when you ", "when asked", "to be used", "used to", "used when"];
  if (triggers.some((t) => lower.includes(t))) return [];
  return [{
    rule: "R004",
    severity: "warning",
    message: 'Description has no trigger phrase (e.g. "Use when ...", "When the user ..."). Add a prose trigger or set `triggers:` in frontmatter.',
  }];
}

/**
 * R005 — `allowed-tools:` must use Anthropic's `Bash(name:*)` / `Read(path)`
 * syntax. Common mistake: comma-separated bare names like `allowed-tools: nmap, curl`.
 */
function ruleR005(content: string): Diagnostic[] {
  const fm = getFrontmatter(content);
  if (!fm) return [];
  const raw = fmField(fm.yaml, "allowed-tools");
  if (!raw) return [];
  // Strip array brackets/braces if present.
  const value = raw.replace(/^\[|\]$/g, "").trim();
  // Valid form has at least one Tool(...) wrapper.
  if (/\b(Bash|Read|Write|Edit|Glob|Grep|WebFetch|WebSearch)\s*\(/.test(value)) return [];

  // Common malformation: comma-separated bare names. Auto-fix by wrapping.
  const bareNames = value.split(/[,\s]+/).filter(Boolean);
  if (bareNames.length === 0) return [];
  const fixed = bareNames.map((n) => `Bash(${n}:*)`).join(", ");
  return [{
    rule: "R005",
    severity: "error",
    message: `\`allowed-tools:\` must use \`Bash(name:*)\` / \`Read(path)\` syntax; got bare names "${value}".`,
    fix: (c) => {
      const fmm = getFrontmatter(c);
      if (!fmm) return c;
      const newYaml = fmm.yaml.replace(/^allowed-tools:.*$/m, `allowed-tools: ${fixed}`);
      return `---\n${newYaml}\n---` + c.slice(fmm.end);
    },
  }];
}

/**
 * R006 — skill declares CLI dependencies but has no `## Prerequisites`
 * section listing them. Auto-fix: synthesize one from the extracted CLI set.
 * This is the single highest-value PR cue can open on a skill repo.
 */
function ruleR006(content: string): Diagnostic[] {
  const clis = parseCLIsFromContent(content);
  if (clis.length === 0) return [];
  if (/^##\s+Prerequisites\b/m.test(content)) return [];

  const fix = (c: string): string => {
    const fm = getFrontmatter(c);
    const body = fm ? c.slice(fm.end) : c;
    const block = `\n\n## Prerequisites\n\n` +
      clis.map(renderInstallLine).join("\n") + "\n";
    // Insert after the first heading + any intro paragraph, OR at end of body.
    const firstH = body.search(/^#\s+.+$/m);
    if (firstH === -1) return c + block;
    // Find next blank line after the heading
    const after = body.indexOf("\n\n", firstH);
    if (after === -1) return c + block;
    return (fm ? c.slice(0, fm.end) : "") + body.slice(0, after) + block + body.slice(after);
  };

  return [{
    rule: "R006",
    severity: "warning",
    message: `Skill uses ${clis.length} CLI tool(s) (${clis.slice(0, 5).join(", ")}${clis.length > 5 ? "…" : ""}) but has no \`## Prerequisites\` section. Users won't know what to install.`,
    fix,
  }];
}

/**
 * R007 — frontmatter has no `tags:` / `domain:` / `category:`. These are what
 * marketplaces and search index against; missing them hurts discoverability.
 * No auto-fix (judgment required), but the message lists the inferred tags
 * for the maintainer to copy in.
 */
function ruleR007(content: string): Diagnostic[] {
  const fm = getFrontmatter(content);
  if (!fm) return [];
  const hasAny = ["tags", "domain", "category"].some((k) => fmField(fm.yaml, k));
  if (hasAny) return [];

  // Suggest tags from the body — frequent capitalized nouns / known CLIs.
  const clis = parseCLIsFromContent(content);
  const suggestions = clis.slice(0, 4);
  const hint = suggestions.length > 0 ? ` Suggested tags from your CLI usage: [${suggestions.join(", ")}].` : "";
  return [{
    rule: "R007",
    severity: "info",
    message: `Frontmatter has no \`tags:\`, \`domain:\`, or \`category:\` — hurts discoverability.${hint}`,
  }];
}

/**
 * R008 — markdown links pointing nowhere within the document. Detects
 * `[text](#anchor)` where `#anchor` doesn't correspond to any heading.
 * Pure (no network), so safe in CI. URL links are out of scope.
 */
function ruleR008(content: string): Diagnostic[] {
  const headings = new Set<string>();
  for (const m of content.matchAll(/^#+\s+(.+)$/gm)) {
    headings.add(slugify(m[1]!));
  }
  const broken: string[] = [];
  for (const m of content.matchAll(/\[([^\]]+)\]\(#([^)]+)\)/g)) {
    if (!headings.has(m[2]!.toLowerCase())) broken.push(m[2]!);
  }
  if (broken.length === 0) return [];
  return [{
    rule: "R008",
    severity: "warning",
    message: `Broken in-document anchor link(s): ${broken.slice(0, 5).join(", ")}${broken.length > 5 ? "…" : ""}`,
  }];
}

// ---------------------------------------------------------------------------
// R009 — voice rules
// ---------------------------------------------------------------------------

const BANNED_WORDS = [
  "delve", "crucial", "robust", "comprehensive", "nuanced", "multifaceted",
  "furthermore", "moreover", "additionally", "pivotal", "landscape", "tapestry",
  "underscore", "foster", "showcase", "intricate", "vibrant", "fundamental",
  "significant",
] as const;

const BANNED_PHRASES = [
  "here's the kicker", "the bottom line", "deep dive", "unpack this",
  "in today's fast-paced world",
] as const;

/**
 * Strip frontmatter, fenced code blocks (```...```), and inline code (`...`)
 * so voice checks only run on prose. Preserves line count by replacing
 * stripped regions with newlines, keeping reported line numbers accurate.
 */
function stripCodeAndFrontmatter(content: string): string {
  const fm = getFrontmatter(content);
  let s = content;
  if (fm) {
    const fmText = s.slice(0, fm.end);
    s = fmText.replace(/[^\n]/g, " ") + s.slice(fm.end);
  }
  s = s.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " "));
  s = s.replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
  return s;
}

function lineOf(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

/**
 * Replace every em dash in prose (skipping frontmatter, fenced code blocks,
 * and inline code) with ", ". Surrounding whitespace is collapsed so
 * `foo — bar` becomes `foo, bar`, not `foo,  bar`. Idempotent.
 */
function fixEmDashesInProse(content: string): string {
  const masked = stripCodeAndFrontmatter(content);
  const out: string[] = [];
  let i = 0;
  while (i < content.length) {
    const idx = masked.indexOf("—", i);
    if (idx === -1) {
      out.push(content.slice(i));
      break;
    }
    let start = idx;
    let end = idx + 1;
    while (start > i && /[ \t]/.test(masked[start - 1] ?? "")) start--;
    while (end < masked.length && /[ \t]/.test(masked[end] ?? "")) end++;
    out.push(content.slice(i, start));
    out.push(", ");
    i = end;
  }
  return out.join("");
}

/**
 * R009 — voice rules. Flags em dashes and AI-vocabulary words/phrases in
 * skill prose. Code blocks, inline code, and frontmatter are exempt. No
 * auto-fix: voice rewrites need human judgment. One diagnostic per banned
 * term (not per occurrence) to avoid spam.
 */
function ruleR009(content: string): Diagnostic[] {
  const prose = stripCodeAndFrontmatter(content);
  const diagnostics: Diagnostic[] = [];

  const emDashIdx = prose.indexOf("—");
  if (emDashIdx !== -1) {
    diagnostics.push({
      rule: "R009",
      severity: "warning",
      message: "Em dash found in prose. Voice rules ban it; use commas, periods, or \"...\". Wrap legitimate uses in backticks to exempt.",
      line: lineOf(content, emDashIdx),
      fix: fixEmDashesInProse,
    });
  }

  const lowerProse = prose.toLowerCase();
  const flaggedWords: Array<{ word: string; line: number }> = [];
  for (const word of BANNED_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, "i");
    const m = re.exec(prose);
    if (m && m.index !== undefined) {
      flaggedWords.push({ word, line: lineOf(content, m.index) });
    }
  }
  if (flaggedWords.length > 0) {
    const sample = flaggedWords.slice(0, 5).map((f) => `"${f.word}" (line ${f.line})`).join(", ");
    const more = flaggedWords.length > 5 ? `, +${flaggedWords.length - 5} more` : "";
    diagnostics.push({
      rule: "R009",
      severity: "warning",
      message: `AI vocabulary found: ${sample}${more}. See voice rules — wrap legit technical uses in backticks.`,
      line: flaggedWords[0]!.line,
    });
  }

  for (const phrase of BANNED_PHRASES) {
    const idx = lowerProse.indexOf(phrase);
    if (idx !== -1) {
      diagnostics.push({
        rule: "R009",
        severity: "warning",
        message: `Banned phrase "${phrase}" — voice rules call this hype. Cut or rewrite.`,
        line: lineOf(content, idx),
      });
    }
  }

  // "leverage" as a verb is banned; "leverage" as a noun (financial,
  // mechanical) is fine. We can't disambiguate syntactically, but a useful
  // heuristic: verb form follows "to ", "we ", "you ", "I ", etc.
  const leverageVerb = /\b(?:to|we|you|i|they|will|can|should|would|could|may|might|must|let's|lets)\s+leverage\b/i;
  const lv = leverageVerb.exec(prose);
  if (lv) {
    diagnostics.push({
      rule: "R009",
      severity: "warning",
      message: '"leverage" used as a verb — voice rules ban it. Use "use" or "rely on".',
      line: lineOf(content, lv.index),
    });
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// R010 — extractable shell sequences
// ---------------------------------------------------------------------------

/**
 * Count "command lines" inside a code-block body: non-empty lines that look
 * like shell commands (not comments, not output, not `$`/`>` prompts alone).
 * Comments (`# ...`) DO count because they typically annotate steps inside a
 * script.
 */
function countCommandLines(blockBody: string): number {
  let count = 0;
  for (const raw of blockBody.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line === "$" || line === ">") continue;
    // Output lines starting with whitespace after a prompt — heuristic: skip
    // lines that look like terminal output (no shell metachar, no command at
    // start). For simplicity, only skip pure ASCII art separators.
    if (/^[-=]{3,}$/.test(line)) continue;
    count++;
  }
  return count;
}

/**
 * R010 — flag skills with a fenced bash/sh block containing 8+ command lines.
 * Signal: the skill is describing a multi-step shell workflow inline. A
 * helper script under `scripts/` would reduce copy-paste errors for users
 * and make the steps reproducible. No auto-fix (script design needs human
 * judgment about parameters, error handling, idempotency).
 */
function ruleR010(content: string): Diagnostic[] {
  const fm = getFrontmatter(content);
  const body = fm ? content.slice(fm.end) : content;
  const blockRe = /^```(bash|sh|zsh|shell)?\s*\n([\s\S]*?)\n```/gm;
  const candidates: Array<{ lines: number; offset: number }> = [];
  for (const m of body.matchAll(blockRe)) {
    const lang = (m[1] ?? "").toLowerCase();
    // Untagged code blocks are too often non-shell (json, log, etc.) to
    // include reliably. Only count explicit shell-tagged blocks.
    if (lang === "" || (lang !== "bash" && lang !== "sh" && lang !== "zsh" && lang !== "shell")) continue;
    const lines = countCommandLines(m[2] ?? "");
    if (lines >= 8) {
      candidates.push({ lines, offset: m.index ?? 0 });
    }
  }
  if (candidates.length === 0) return [];

  const biggest = candidates.reduce((a, b) => (a.lines >= b.lines ? a : b));
  const fmOffset = fm ? fm.end : 0;
  const blockLine = lineOf(content, fmOffset + biggest.offset);
  const more = candidates.length > 1 ? ` (+${candidates.length - 1} other ${candidates.length - 1 === 1 ? "block" : "blocks"})` : "";
  return [{
    rule: "R010",
    severity: "info",
    message: `Shell block at line ${blockLine} has ${biggest.lines} command lines${more}. Extract to \`scripts/<name>.sh\` next to SKILL.md so users run one command, not eight.`,
    line: blockLine,
  }];
}

// ---------------------------------------------------------------------------
// R014 — zombie skill (no invocations in the telemetry window)
//
// Off by default. Opt-in via lint-skill --check-zombie <analytics.jsonl>.
// Reads structured `skill_invoked` events and flags skills with zero hits
// in the last 30 days. Silent no-op when the file is missing or the user
// hasn't enabled telemetry.
// ---------------------------------------------------------------------------

export interface ZombieCheckOptions {
  /** Path to ~/.config/cue/analytics.jsonl (or compatible JSONL log). */
  analyticsPath: string;
  /** Days back to consider; default 30. */
  windowDays?: number;
}

/**
 * Check a single skill against the analytics log. Returns an R014 diagnostic
 * if no `skill_invoked` event names this skill in the window. Lives outside
 * the per-file ALL_RULES set because it needs a path argument; the CLI opts
 * in via a flag.
 */
export function checkZombie(content: string, opts: ZombieCheckOptions): Diagnostic[] {
  const fm = getFrontmatter(content);
  if (!fm) return [];
  const name = fmField(fm.yaml, "name");
  if (!name) return [];

  const windowDays = opts.windowDays ?? 30;
  const cutoffMs = Date.now() - windowDays * 24 * 3600 * 1000;

  let analyticsRaw: string;
  try {
    const { readFileSync, existsSync } = require("node:fs") as typeof import("node:fs");
    if (!existsSync(opts.analyticsPath)) return [];
    analyticsRaw = readFileSync(opts.analyticsPath, "utf8");
  } catch {
    return [];
  }

  let invocations = 0;
  let lastInvocationTs: string | null = null;
  for (const line of analyticsRaw.split("\n")) {
    if (!line.trim()) continue;
    let parsed: { event?: string; skill?: string; ts?: string };
    try { parsed = JSON.parse(line) as typeof parsed; } catch { continue; }
    if (parsed.event !== "skill_invoked") continue;
    if (parsed.skill !== name) continue;
    if (parsed.ts) {
      const ts = Date.parse(parsed.ts);
      if (!Number.isNaN(ts) && ts < cutoffMs) continue;
      if (!lastInvocationTs || parsed.ts > lastInvocationTs) lastInvocationTs = parsed.ts;
    }
    invocations++;
  }

  if (invocations > 0) return [];

  return [{
    rule: "R014",
    severity: "info",
    message: `Zombie skill: 0 invocations in last ${windowDays} day(s) per local telemetry. Consider removing or tightening the description/triggers.`,
  }];
}

// ---------------------------------------------------------------------------
// R013 — description/body coherence
// ---------------------------------------------------------------------------

const COHERENCE_STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "these", "those", "from",
  "into", "onto", "over", "under", "than", "then", "they", "them", "their",
  "your", "yours", "user", "users", "use", "uses", "used", "using", "when",
  "what", "how", "where", "why", "who", "which", "asks", "ask", "asking",
  "mentions", "mention", "mentioning", "needs", "need", "needed", "needing",
  "triggers", "trigger", "triggered", "triggering", "phrases", "phrase",
  "like", "also", "only", "any", "all", "some", "each", "every", "such",
  "very", "much", "more", "less", "most", "least", "many", "few", "lot",
  "lots", "well", "rather", "quite", "just", "still", "yet", "already",
  "should", "could", "would", "might", "must", "will", "can", "may",
  "does", "doing", "done", "make", "makes", "making", "made", "get",
  "gets", "getting", "got", "have", "has", "had", "having", "be", "is",
  "are", "was", "were", "been", "being", "do", "did",
  "skill", "skills", "claude", "agent", "agents", "input", "inputs",
  "output", "outputs", "set", "sets", "setting",
]);

function coherenceWords(text: string): Set<string> {
  const matches = text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  return new Set(matches.filter((w) => !COHERENCE_STOPWORDS.has(w) && w.length >= 3));
}

/**
 * R013 — flag skills whose description doesn't mention key nouns from the
 * body (or vice versa). Signal: stale description. Computes Jaccard-style
 * overlap; if the description has 5+ content words and <30% of them appear
 * in the body, flag info. No auto-fix.
 */
function ruleR013(content: string): Diagnostic[] {
  const fm = getFrontmatter(content);
  if (!fm) return [];
  const desc = fmField(fm.yaml, "description");
  if (!desc) return [];

  // Strip code blocks from body before extracting words — code identifiers
  // shouldn't count toward conceptual coherence.
  const bodyProse = stripCodeAndFrontmatter(content).slice(fm.end);
  const descWords = coherenceWords(desc);
  if (descWords.size < 5) return [];

  const bodyWords = coherenceWords(bodyProse);
  if (bodyWords.size === 0) return [];

  let overlap = 0;
  const missing: string[] = [];
  for (const w of descWords) {
    if (bodyWords.has(w)) overlap++;
    else missing.push(w);
  }
  const ratio = overlap / descWords.size;
  if (ratio >= 0.3) return [];

  const sample = missing.slice(0, 5).join(", ");
  return [{
    rule: "R013",
    severity: "info",
    message: `Description/body overlap is ${Math.round(ratio * 100)}% (${overlap}/${descWords.size} words). Description mentions: ${sample}. Body doesn't. Possible stale description.`,
  }];
}

// ---------------------------------------------------------------------------
// R011 — example block missing
// ---------------------------------------------------------------------------

/**
 * R011 — skills without at least one example block get poor discovery. Per
 * the profile principles, examples lift activation from ~50% to ~90%.
 * Accepts any of: `<example>` tag, `## Example` / `## Examples` heading,
 * `### Example(s)` heading, or `Example:` lead-in line. Info-level: a tiny
 * single-purpose skill can sometimes get away without one. No auto-fix
 * (example content needs human authorship).
 */
function ruleR011(content: string): Diagnostic[] {
  const body = bodyAfterFrontmatter(content);
  if (/<example[\s>]/i.test(body)) return [];
  if (/^#{2,3}\s+Examples?\b/im.test(body)) return [];
  if (/^Examples?\s*:/im.test(body)) return [];
  return [{
    rule: "R011",
    severity: "info",
    message: "No `<example>` tag, `## Example` heading, or `Example:` lead-in. Examples lift Claude's activation rate from ~50% to ~90%.",
  }];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const ALL_RULES = [ruleR001, ruleR002, ruleR003, ruleR004, ruleR005, ruleR006, ruleR007, ruleR008, ruleR009, ruleR010, ruleR011, ruleR013];

/** Run every rule against the SKILL.md content. */
export function lint(content: string): LintResult {
  const ignores = parseIgnores(content);
  const diagnostics: Diagnostic[] = [];
  for (const rule of ALL_RULES) {
    for (const diag of rule(content)) {
      if (!isIgnored(diag, ignores)) diagnostics.push(diag);
    }
  }
  return {
    diagnostics,
    fixable: diagnostics.filter((d) => d.fix).length,
    score: scoreDiagnostics(diagnostics),
  };
}

// ---------------------------------------------------------------------------
// R012 — cross-skill overlap detection.
//
// Lives outside the per-file rule set because it needs a corpus of OTHER
// skills to compare against. Callers (the lint-skill CLI) opt in via a
// dedicated flag and pre-load the corpus.
// ---------------------------------------------------------------------------

const OVERLAP_STOPWORDS = new Set([
  ...COHERENCE_STOPWORDS,
  "name", "description", "tags", "category", "version", "yes", "no",
]);

function overlapKeywords(content: string): Set<string> {
  const fm = getFrontmatter(content);
  if (!fm) return new Set();
  const desc = fmField(fm.yaml, "description");
  const tags = fmField(fm.yaml, "tags");
  const name = fmField(fm.yaml, "name");
  const text = [name, desc, tags].join(" ");
  const matches = text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [];
  return new Set(matches.filter((w) => !OVERLAP_STOPWORDS.has(w) && w.length >= 4));
}

export interface OverlapCorpusEntry {
  path: string;
  content: string;
}

/**
 * R012 — find skills in the corpus whose keyword set overlaps the target's
 * by ≥50% (Sorensen-Dice). Skills with fewer than 4 keywords are exempt
 * (too noisy). Self-match suppressed by path equality.
 */
export function findOverlap(
  targetPath: string,
  targetContent: string,
  corpus: OverlapCorpusEntry[],
): Diagnostic[] {
  const targetKeywords = overlapKeywords(targetContent);
  if (targetKeywords.size < 4) return [];

  const matches: Array<{ path: string; ratio: number; shared: string[] }> = [];
  for (const entry of corpus) {
    if (entry.path === targetPath) continue;
    const other = overlapKeywords(entry.content);
    if (other.size < 4) continue;
    const intersection = [...targetKeywords].filter((w) => other.has(w));
    if (intersection.length === 0) continue;
    const dice = (2 * intersection.length) / (targetKeywords.size + other.size);
    if (dice >= 0.5) {
      matches.push({ path: entry.path, ratio: dice, shared: intersection });
    }
  }
  if (matches.length === 0) return [];

  matches.sort((a, b) => b.ratio - a.ratio);
  const top = matches.slice(0, 3);
  const lines = top.map((m) => `${m.path} (${Math.round(m.ratio * 100)}%, shared: ${m.shared.slice(0, 5).join(", ")})`).join("; ");
  return [{
    rule: "R012",
    severity: "warning",
    message: `Possible duplicate of ${matches.length} skill(s): ${lines}. Review for overlap before shipping; "overlap kills" is a profile principle.`,
  }];
}

// ---------------------------------------------------------------------------
// Baseline support: snapshot current diagnostics so subsequent runs only
// surface NEW issues. Used to adopt new rules without big-bang cleanup.
// ---------------------------------------------------------------------------

export interface LintBaseline {
  version: 1;
  generatedAt: string;
  /** Per-file ledger of rules currently accepted as baseline. */
  files: Record<string, string[]>;
}

/**
 * Build a baseline from a list of (relative-file-path, diagnostics) pairs.
 * Stores the unique set of rule ids per file. Sorted for deterministic diffs.
 */
export function buildBaseline(
  entries: Array<{ path: string; diagnostics: Diagnostic[] }>,
): LintBaseline {
  const files: Record<string, string[]> = {};
  for (const { path, diagnostics } of entries) {
    const rules = [...new Set(diagnostics.map((d) => d.rule))].sort();
    if (rules.length > 0) files[path] = rules;
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/**
 * Filter diagnostics through a baseline. Any (file, rule) pair listed in the
 * baseline is suppressed. New rule ids on a baselined file still surface.
 */
export function applyBaseline(
  filePath: string,
  diagnostics: Diagnostic[],
  baseline: LintBaseline | null,
): Diagnostic[] {
  if (!baseline) return diagnostics;
  const allowed = new Set(baseline.files[filePath] ?? []);
  if (allowed.size === 0) return diagnostics;
  return diagnostics.filter((d) => !allowed.has(d.rule));
}

/** Apply every fixable diagnostic. Idempotent if rules are well-behaved. */
export function applyFixes(content: string): { fixed: string; applied: string[] } {
  let current = content;
  const applied: string[] = [];
  // Re-lint after each fix so rules see the updated content.
  // Cap iterations to avoid infinite loops if a fix re-triggers another rule.
  for (let i = 0; i < 5; i++) {
    const { diagnostics } = lint(current);
    const next = diagnostics.find((d) => d.fix);
    if (!next) break;
    current = next.fix!(current);
    applied.push(next.rule);
  }
  return { fixed: current, applied };
}

// ---------------------------------------------------------------------------
// PR body generator — meaningful pull request body for the auto-PR flow.
// Caller is responsible for repo forking, branching, pushing, and `gh pr create`.
// ---------------------------------------------------------------------------

export interface PrFile {
  path: string;
  before: string;
  after: string;
  fixedRules: string[];      // rule ids that touched this file
}

export interface PrBodyInput {
  repo: string;                   // owner/name
  files: PrFile[];                // every file the PR touches
  diagnosticsFixed: Diagnostic[]; // aggregated across files (deduped by rule)
  diagnosticsLeft: Diagnostic[];  // unfixable ones the maintainer can act on
}

const RULE_SUMMARIES: Record<string, string> = {
  R001: "Added missing `name:` field (derived from first H1)",
  R002: "Flagged missing `description:` for human review",
  R003: "Description exceeds 200 chars — Claude's discovery truncates it",
  R004: "Description lacks a trigger phrase (e.g. \"Use when …\")",
  R005: "Fixed `allowed-tools:` syntax to use `Bash(name:*)` form",
  R006: "Added `## Prerequisites` section listing CLI dependencies",
  R007: "Flagged missing `tags:` / `domain:` (hurts discoverability)",
  R008: "Flagged broken in-document anchor link(s)",
  R009: "Flagged voice-rule violations (AI vocabulary, em dashes, banned phrases)",
  R010: "Flagged large shell blocks as script-extraction candidates",
  R011: "Flagged missing example block (hurts Claude's activation rate)",
  R012: "Flagged possible duplicate skill (high keyword overlap with another skill)",
  R013: "Flagged description/body word-overlap mismatch (possible stale description)",
  R014: "Flagged zombie skill (0 invocations in telemetry window)",
};

const RULE_TITLE_PHRASES: Record<string, string> = {
  R001: "add missing `name:`",
  R002: "flag missing `description:`",
  R003: "shorten over-long description",
  R004: "rewrite description with trigger phrase",
  R005: "fix `allowed-tools` syntax",
  R006: "add `Prerequisites` section",
  R007: "flag missing `tags:`/`domain:`",
  R008: "flag broken anchor links",
  R009: "flag voice-rule violations",
  R010: "flag script-extraction candidates",
  R011: "flag missing example block",
  R012: "flag possible duplicate skills",
  R013: "flag stale description (low body overlap)",
  R014: "flag zombie skill (no telemetry invocations)",
};

/**
 * Compose a meaningful PR title from the list of rules actually fixed.
 * Examples:
 *   1 rule    → "cue: fix allowed-tools syntax"
 *   2 rules   → "cue: fix allowed-tools syntax + add Prerequisites"
 *   3 rules   → "cue: fix allowed-tools syntax, add Prerequisites, +1 more"
 *   0 rules   → "cue: SKILL.md spec issues need review (R002, R007)"
 */
export function buildPrTitle(fixedRules: string[], flaggedRules: string[]): string {
  const dedup = [...new Set(fixedRules)];
  if (dedup.length === 0) {
    const flags = [...new Set(flaggedRules)].slice(0, 3);
    return `cue: SKILL.md spec issues need review (${flags.join(", ")})`;
  }
  const phrases = dedup.map((r) => RULE_TITLE_PHRASES[r] ?? r).filter(Boolean);
  if (phrases.length === 1) return `cue: ${phrases[0]}`;
  if (phrases.length === 2) return `cue: ${phrases[0]} + ${phrases[1]}`;
  return `cue: ${phrases.slice(0, 2).join(", ")}, +${phrases.length - 2} more`;
}

/**
 * Render a unified-diff-style block for a single file. Not a true Myers diff
 * — just lines that differ between before and after. Adequate for the small
 * frontmatter/Prerequisites edits cue typically makes.
 */
function renderInlineDiff(path: string, before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  // Simple LCS-free diff: find the first and last differing lines, emit a hunk.
  let firstDiff = 0;
  while (firstDiff < beforeLines.length && firstDiff < afterLines.length && beforeLines[firstDiff] === afterLines[firstDiff]) firstDiff++;

  let lastDiffBefore = beforeLines.length - 1;
  let lastDiffAfter = afterLines.length - 1;
  while (
    lastDiffBefore > firstDiff && lastDiffAfter > firstDiff &&
    beforeLines[lastDiffBefore] === afterLines[lastDiffAfter]
  ) { lastDiffBefore--; lastDiffAfter--; }

  // Show a small context window before/after
  const ctx = 2;
  const ctxStart = Math.max(0, firstDiff - ctx);
  const ctxEndAfter = Math.min(afterLines.length, lastDiffAfter + 1 + ctx);

  const lines: string[] = [];
  for (let i = ctxStart; i < firstDiff; i++) lines.push("  " + beforeLines[i]);
  for (let i = firstDiff; i <= lastDiffBefore; i++) lines.push("- " + beforeLines[i]);
  for (let i = firstDiff; i <= lastDiffAfter; i++) lines.push("+ " + afterLines[i]);
  // Trailing context comes from the after version since lines may have shifted.
  for (let i = lastDiffAfter + 1; i < ctxEndAfter; i++) lines.push("  " + afterLines[i]);

  return `### \`${path}\`\n\n\`\`\`diff\n${lines.join("\n")}\n\`\`\``;
}

export function buildPrBody(input: PrBodyInput): { title: string; body: string } {
  const fixedRuleIds = [...new Set(input.diagnosticsFixed.map((d) => d.rule))];
  const flaggedRuleIds = [...new Set(input.diagnosticsLeft.map((d) => d.rule))];

  const fixedList = input.diagnosticsFixed.length > 0
    ? input.diagnosticsFixed.map((d) => `- **${d.rule}** — ${RULE_SUMMARIES[d.rule] ?? d.message}`).join("\n")
    : "_(none — only flags, no automatic fixes)_";

  const leftList = input.diagnosticsLeft.length > 0
    ? input.diagnosticsLeft.map((d) => `- **${d.rule}** _(${d.severity})_ — ${d.message}`).join("\n")
    : "_(none — the file is clean after this PR)_";

  const title = buildPrTitle(fixedRuleIds, flaggedRuleIds);

  // Per-file diff blocks (only for files that actually changed)
  const diffBlocks = input.files
    .filter((f) => f.before !== f.after)
    .map((f) => renderInlineDiff(f.path, f.before, f.after))
    .join("\n\n");

  const skillPathDesc = input.files.length === 1
    ? input.files[0]!.path
    : `${input.files.filter((f) => f.before !== f.after).length} of ${input.files.length} SKILL.md files`;

  const body = `# SKILL.md quality fixes from \`cue\`

Hi! [\`cue\`](https://github.com/opencue/claude-code-skills) is an open-source agent profile manager that auto-discovers Claude Code skills via GitHub Code Search. We indexed **${skillPathDesc}** in [${input.repo}](https://github.com/${input.repo}) and ran our SKILL.md linter against it.

This PR applies the **safe, mechanical fixes** below. It does **not** add any branding, badges, or marketing — only spec-compliance changes that improve how Claude's skill discovery sees your skill.

## What this PR changes

${fixedList}

${diffBlocks ? `## Inline diff\n\n${diffBlocks}\n` : ""}
## What's flagged for your review (no diff)

These are issues we won't auto-fix because they need your judgment:

${leftList}

## Why each rule exists

| Rule | Source |
|---|---|
| R001 \`name:\` | Required for Claude Code's skill registry |
| R002 \`description:\` | Used as the trigger string by Claude's discovery |
| R003 desc length | Anthropic's discovery truncates >200 chars |
| R004 trigger phrase | Verb-leading descriptions fire ~3× more reliably |
| R005 \`allowed-tools\` syntax | Malformed tool declarations get silently ignored |
| R006 Prerequisites | Users don't know which CLIs to install otherwise |
| R007 tags/domain | Required for skill marketplace indexing |
| R009 voice rules | Bans AI vocabulary + em dashes; voice rules live in resources/skills/skills/meta/skill-reviewer/references/voice.md |
| R010 script extraction | Long inline shell sequences should live in \`scripts/\` so users run one command, not many |
| R011 example block | Skills with examples activate ~90% of the time; without, ~50% |

## How to opt out

If you'd rather we don't open PRs like this on your repo, add a line to your README:

\`\`\`
<!-- cue: ignore -->
\`\`\`

We'll skip your repo on every future scan. **No follow-up PRs without you re-inviting us.**

You can also run the linter yourself by adding our GitHub Action (no PRs needed):

\`\`\`yaml
# .github/workflows/lint-skill-md.yml
on: [pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: opencue/claude-code-skills/skill-md-lint-action@main
\`\`\`

---

🤖 Generated by \`cue\` · [report a bad fix](https://github.com/opencue/claude-code-skills/issues/new?title=cue+lint+bad+fix:+${encodeURIComponent(input.repo)})
`;

  return { title, body };
}
