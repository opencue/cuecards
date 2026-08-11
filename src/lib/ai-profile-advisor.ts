/** Best-effort AI profile advice for the interactive launch picker. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { cacheDir } from "./config-paths";
import type { DetectionResultV2 } from "./auto-detect";

export const ADVISOR_CACHE_VERSION = 1;
export const ADVISOR_TIMEOUT_MS = 12_000;

export interface ProfileAdvice {
  suggestions: DetectionResultV2[];
  summary: string;
}

export type AdvisorRunner = (agent: "claude" | "codex", prompt: string) => string | null | Promise<string | null>;

function gitHead(cwd: string): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    timeout: 2_000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() : "no-git-head";
}

export function advisorCacheKey(cwd: string, head: string): string {
  return createHash("sha256").update(`${resolve(cwd)}\0${head}`).digest("hex");
}

function repoEvidence(cwd: string): string {
  const files = readdirSync(cwd, { withFileTypes: true })
    .filter((entry) => ![".git", "node_modules", "dist", "build", ".next"].includes(entry.name))
    .slice(0, 80)
    .map((entry) => `${entry.isDirectory() ? "dir" : "file"}:${entry.name}`);
  const excerpts: string[] = [];
  for (const file of ["package.json", "README.md", "AGENTS.md", "CLAUDE.md", "pyproject.toml", "docker-compose.yml"] as const) {
    try {
      excerpts.push(`--- ${file} ---\n${readFileSync(join(cwd, file), "utf8").slice(0, 4_000)}`);
    } catch { /* optional evidence */ }
  }
  return `repository: ${basename(resolve(cwd))}\nentries:\n${files.join("\n")}\n${excerpts.join("\n")}`.slice(0, 16_000);
}

function promptFor(cwd: string, knownProfiles: string[], currentProfile?: string): string {
  return `You select Cue profiles for a repository. Analyze its PRIMARY work domain, not merely deployment files.
Advertising/domain signals (google-ads, claude-ads, marketing, ads-manager) outrank generic Docker/Coolify signals unless infrastructure is the repository's primary product.
Return JSON only, with this exact shape:
{"summary":"one short sentence","suggestions":[{"profile":"existing-name","confidence":0.0,"reasons":["short evidence"]}]}
Return at most 3 suggestions. Profiles MUST be selected only from this list:
${JSON.stringify(knownProfiles)}
Current profile (context only; never assume it is correct): ${currentProfile ?? "none"}
Repository evidence:
${repoEvidence(cwd)}`;
}

async function defaultRunner(agent: "claude" | "codex", prompt: string): Promise<string | null> {
  // Reuse cue's isolated, bounded classifier instead of spawning the bare
  // agent name (which may be cue's own shim and recurse into launch).
  if (agent === "claude") {
    const { runClassifier } = await import("./claude-classifier");
    const result = await runClassifier(prompt, ADVISOR_TIMEOUT_MS);
    return result.ok ? result.output : null;
  }
  const { findRealAgentBin } = await import("./claude-binary");
  const bin = findRealAgentBin("codex");
  if (!bin) return null;
  const result = spawnSync(bin, ["exec", "--skip-git-repo-check", prompt], {
    encoding: "utf8",
    timeout: ADVISOR_TIMEOUT_MS,
    maxBuffer: 256 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, CUE_BYPASS: "1" },
  });
  return result.status === 0 ? result.stdout : null;
}

export function parseProfileAdvice(raw: string, knownProfiles: ReadonlySet<string>): ProfileAdvice | null {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end < start) return null;
    const value = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof value.summary !== "string" || !Array.isArray(value.suggestions)) return null;
    const suggestions: DetectionResultV2[] = [];
    const seen = new Set<string>();
    for (const item of value.suggestions.slice(0, 3)) {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      if (typeof row.profile !== "string" || !knownProfiles.has(row.profile) || seen.has(row.profile)) return null;
      if (typeof row.confidence !== "number" || row.confidence < 0 || row.confidence > 1) return null;
      if (!Array.isArray(row.reasons) || row.reasons.length === 0 || !row.reasons.every((r) => typeof r === "string")) return null;
      seen.add(row.profile);
      suggestions.push({ profile: row.profile, confidence: row.confidence, reasons: row.reasons.slice(0, 3) as string[] });
    }
    if (suggestions.length === 0) return null;
    return { summary: value.summary.slice(0, 240), suggestions };
  } catch {
    return null;
  }
}

export async function adviseProfiles(opts: {
  cwd: string;
  knownProfiles: string[];
  currentProfile?: string;
  preferredAgent?: "claude" | "codex";
  cacheRoot?: string;
  runner?: AdvisorRunner;
  head?: string;
}): Promise<ProfileAdvice | null> {
  const head = opts.head ?? gitHead(opts.cwd);
  const dir = join(opts.cacheRoot ?? cacheDir(), "profile-advisor");
  const path = join(dir, `${advisorCacheKey(opts.cwd, head)}.json`);
  const known = new Set(opts.knownProfiles);
  try {
    const cached = JSON.parse(readFileSync(path, "utf8")) as { version?: number; advice?: unknown };
    if (cached.version === ADVISOR_CACHE_VERSION) {
      const parsed = parseProfileAdvice(JSON.stringify(cached.advice), known);
      if (parsed) return parsed;
    }
  } catch { /* cache miss/corruption */ }

  const runner = opts.runner ?? defaultRunner;
  const order: Array<"claude" | "codex"> = opts.preferredAgent === "codex" ? ["codex", "claude"] : ["claude", "codex"];
  const prompt = promptFor(opts.cwd, opts.knownProfiles, opts.currentProfile);
  let advice: ProfileAdvice | null = null;
  for (const agent of order) {
    const raw = await runner(agent, prompt);
    if (raw && (advice = parseProfileAdvice(raw, known))) break;
  }
  if (!advice) return null;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify({ version: ADVISOR_CACHE_VERSION, cwd: resolve(opts.cwd), head, advice }) + "\n");
  } catch { /* cache failure must not block launch */ }
  return advice;
}
