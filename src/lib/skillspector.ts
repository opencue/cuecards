/**
 * NVIDIA SkillSpector integration — deep security scan for freshly-fetched skills.
 *
 * SkillSpector (https://github.com/NVIDIA/SkillSpector) is a security scanner for
 * agent skills: 68 vulnerability patterns across 17 categories (prompt injection,
 * data exfiltration, supply chain, excessive agency, dangerous code via AST,
 * YARA signatures, MCP tool poisoning, …). cue runs it as an install gate in
 * front of every path that lands a new skill on disk.
 *
 * Contract we rely on (documented as stable by upstream):
 *   `skillspector scan <path> --no-llm --format json` writes a JSON report to
 *   stdout with `risk_assessment.{score,severity,recommendation}` and `issues[]`.
 *   Exit codes: 0 = SAFE|CAUTION, 1 = DO_NOT_INSTALL, 2 = error. We read the
 *   `recommendation` field rather than the exit code so CAUTION and SAFE can be
 *   treated differently (see security.ts for the policy).
 *
 * Runner resolution order (first hit wins, cached per process):
 *   1. $SKILLSPECTOR_BIN         explicit override
 *   2. `skillspector` on PATH    uv tool install / pip install
 *   3. `uvx --from git+…`        no install step; uv caches after first run
 *   4. `docker run skillspector` only if the image is already built locally
 *
 * Privacy: we always pass `--no-llm`, so file contents never leave the machine.
 * The supply-chain check (SC4) still queries OSV.dev with dependency names only,
 * and falls back to a bundled list when offline.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";

import { repoRoot } from "./repo-root";

/** Upstream package spec for the uvx fallback. */
export const SKILLSPECTOR_PKG = "git+https://github.com/NVIDIA/skillspector.git";

/** Install hint printed when no runner is available. */
export const SKILLSPECTOR_INSTALL_HINT =
  "uv tool install git+https://github.com/NVIDIA/skillspector.git";

const DEFAULT_TIMEOUT_MS = 180_000;

export type Recommendation = "SAFE" | "CAUTION" | "DO_NOT_INSTALL";

export interface SkillSpectorFinding {
  id: string;
  category: string;
  severity: string;
  file?: string;
  line?: number;
}

export interface SkillSpectorReport {
  /** ok = scan produced a verdict; the rest mean we have no verdict. */
  status: "ok" | "disabled" | "unavailable" | "error";
  /** Human-readable command used, for logs. */
  runner?: string;
  recommendation?: Recommendation;
  score?: number;
  severity?: string;
  findings: SkillSpectorFinding[];
  /** Findings dropped by a baseline. They do not count toward the score. */
  suppressed?: number;
  /** Baseline file applied to this scan, if any. */
  baseline?: string;
  error?: string;
}

/**
 * Baselines suppress reviewed false positives. They are resolved ONLY from
 * cue-owned directories, never from inside the skill being scanned — a skill
 * that shipped its own `.skillspector-baseline.yaml` could otherwise suppress
 * every finding against itself.
 *
 * Repo baseline wins over the user one so a checkout stays reproducible.
 *
 * These live in the cue repo, NOT under `resources/skills/` — that path is a
 * git submodule, so a baseline written there would land in a different repo
 * than the gate that reads it.
 */
export function baselineDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const root = env.CUE_REPO_ROOT ?? repoRoot();
  return [
    join(root, "resources", "skillspector-baselines"),
    join(homedir(), ".config", "cue", "skillspector-baselines"),
  ];
}

/**
 * Find the baseline for a skill id (`meta/smart-loader` → `meta/smart-loader.yaml`).
 * Returns null when there is none, which is the common case.
 */
export function resolveBaselineFor(
  skillId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  // Skill ids come from directory names; refuse anything that could climb out
  // of the baselines directory.
  if (!skillId || skillId.includes("..") || isAbsolute(skillId)) return null;
  for (const dir of baselineDirs(env)) {
    for (const ext of [".yaml", ".yml", ".json"]) {
      const candidate = join(dir, `${skillId}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export type RunnerKind = "bin" | "path" | "uvx" | "docker";

export interface Runner {
  kind: RunnerKind;
  cmd: string;
  args: string[];
  /** Path to hand to `scan` — differs from the host path under docker. */
  target: string;
  /** Path to hand to `--baseline`, or undefined when no baseline applies. */
  baselineTarget?: string;
  label: string;
}

/**
 * Is the gate active? Enabled by default.
 *
 * `CUE_SKILLSPECTOR=0|false|off` turns it off. Test runs are off unless the
 * variable is explicitly truthy, so a `bun test` never shells out to uvx or
 * reaches the network.
 */
export function isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.CUE_SKILLSPECTOR ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  const explicitlyOn = raw === "1" || raw === "true" || raw === "on" || raw === "yes";
  if (env.NODE_ENV === "test" && !explicitlyOn) return false;
  return true;
}

function which(bin: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  return spawnSync(probe, [bin], { stdio: "ignore" }).status === 0;
}

function hasDockerImage(): boolean {
  if (!which("docker")) return false;
  return spawnSync("docker", ["image", "inspect", "skillspector"], { stdio: "ignore" }).status === 0;
}

/**
 * Build the argv for a given runner kind. Pure — the docker case rewrites both
 * the scan target and the baseline path to container mount points, which is why
 * callers must use `runner.target` / `runner.baselineTarget` rather than the
 * host paths they passed in.
 */
export function buildRunner(kind: RunnerKind, dir: string, bin?: string, baseline?: string): Runner {
  switch (kind) {
    case "bin":
      return { kind, cmd: bin!, args: [], target: dir, baselineTarget: baseline, label: bin! };
    case "path":
      return {
        kind,
        cmd: "skillspector",
        args: [],
        target: dir,
        baselineTarget: baseline,
        label: "skillspector",
      };
    case "uvx":
      return {
        kind,
        cmd: "uvx",
        args: ["--from", SKILLSPECTOR_PKG, "skillspector"],
        target: dir,
        baselineTarget: baseline,
        label: "uvx skillspector",
      };
    case "docker": {
      // The baseline lives outside the scanned directory, so it needs its own
      // read-only mount to be visible inside the container.
      const mounts = ["-v", `${dir}:/scan:ro`];
      if (baseline) mounts.push("-v", `${baseline}:/baseline.yaml:ro`);
      return {
        kind,
        cmd: "docker",
        args: ["run", "--rm", ...mounts, "skillspector"],
        target: "/scan",
        baselineTarget: baseline ? "/baseline.yaml" : undefined,
        label: "docker skillspector",
      };
    }
  }
}

let cachedKind: { kind: RunnerKind; bin?: string } | null | undefined;

/** Reset the memoized runner lookup (tests). */
export function resetRunnerCache(): void {
  cachedKind = undefined;
}

function detectRunnerKind(env: NodeJS.ProcessEnv): { kind: RunnerKind; bin?: string } | null {
  if (cachedKind !== undefined) return cachedKind;
  let found: { kind: RunnerKind; bin?: string } | null = null;
  const bin = env.SKILLSPECTOR_BIN?.trim();
  if (bin) found = { kind: "bin", bin };
  else if (which("skillspector")) found = { kind: "path" };
  else if (which("uvx")) found = { kind: "uvx" };
  else if (hasDockerImage()) found = { kind: "docker" };
  cachedKind = found;
  return found;
}

/**
 * Pull the JSON report out of stdout. SkillSpector writes the report to stdout
 * with `--format json`, but we slice from the first `{` so any progress noise
 * on the same stream can't break parsing.
 */
export function parseSkillSpectorJson(stdout: string): SkillSpectorReport {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return { status: "error", findings: [], error: "no JSON report in scanner output" };
  }

  let raw: any;
  try {
    raw = JSON.parse(stdout.slice(start, end + 1));
  } catch (e) {
    return { status: "error", findings: [], error: `unparseable JSON report: ${(e as Error).message}` };
  }

  const assessment = raw?.risk_assessment ?? {};
  const severity = typeof assessment.severity === "string" ? assessment.severity.toUpperCase() : undefined;
  let recommendation: Recommendation | undefined;
  const rec = typeof assessment.recommendation === "string" ? assessment.recommendation.toUpperCase() : "";
  if (rec === "SAFE" || rec === "CAUTION" || rec === "DO_NOT_INSTALL") {
    recommendation = rec;
  } else if (severity) {
    // Upstream's documented severity → recommendation mapping, used only when
    // the field is absent (older builds).
    recommendation = severity === "LOW" ? "SAFE" : severity === "MEDIUM" ? "CAUTION" : "DO_NOT_INSTALL";
  }

  if (!recommendation) {
    return { status: "error", findings: [], error: "report has no risk_assessment.recommendation" };
  }

  const findings: SkillSpectorFinding[] = Array.isArray(raw?.issues)
    ? raw.issues.map((i: any) => ({
        id: String(i?.id ?? "?"),
        category: String(i?.category ?? "uncategorized"),
        severity: String(i?.severity ?? "unknown").toUpperCase(),
        file: typeof i?.location?.file === "string" ? i.location.file : undefined,
        line: typeof i?.location?.start_line === "number" ? i.location.start_line : undefined,
      }))
    : [];

  return {
    status: "ok",
    recommendation,
    score: typeof assessment.score === "number" ? assessment.score : undefined,
    severity,
    findings,
    suppressed:
      typeof raw?.suppressed_count === "number"
        ? raw.suppressed_count
        : Array.isArray(raw?.suppressed)
          ? raw.suppressed.length
          : undefined,
  };
}

/**
 * Scan a skill directory (or SKILL.md) with SkillSpector.
 *
 * Never throws: a missing scanner, a crash, or a timeout comes back as a
 * non-`ok` status so the caller can decide the policy. Blocking decisions are
 * made by the caller from `recommendation`, not from the exit code.
 */
export function runSkillSpector(
  dir: string,
  opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number; baseline?: string | null } = {},
): SkillSpectorReport {
  const env = opts.env ?? process.env;
  if (!isEnabled(env)) {
    return { status: "disabled", findings: [] };
  }

  const detected = detectRunnerKind(env);
  if (!detected) {
    return {
      status: "unavailable",
      findings: [],
      error: `SkillSpector not found. Install it with: ${SKILLSPECTOR_INSTALL_HINT}`,
    };
  }

  // A baseline path that does not exist makes the scanner exit 2, so drop it
  // rather than turning a clean scan into an error.
  const baseline = opts.baseline && existsSync(opts.baseline) ? opts.baseline : undefined;
  const runner = buildRunner(detected.kind, dir, detected.bin, baseline);
  const timeout = Number(env.CUE_SKILLSPECTOR_TIMEOUT_MS ?? opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const res = spawnSync(
    runner.cmd,
    [
      ...runner.args,
      "scan",
      runner.target,
      "--no-llm",
      "--format",
      "json",
      ...(runner.baselineTarget ? ["--baseline", runner.baselineTarget] : []),
    ],
    { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"], env: env as NodeJS.ProcessEnv },
  );

  if (res.error) {
    const timedOut = (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
    return {
      status: timedOut ? "error" : "unavailable",
      runner: runner.label,
      findings: [],
      error: timedOut ? `scan timed out after ${timeout}ms` : res.error.message,
    };
  }

  const report = parseSkillSpectorJson(res.stdout ?? "");
  report.runner = runner.label;
  if (baseline) report.baseline = baseline;
  if (report.status !== "ok" && res.status === 2) {
    // Exit 2 is upstream's "bad input / internal failure" — surface its stderr.
    report.error = (res.stderr ?? "").trim().split("\n").pop() || report.error;
  }
  return report;
}

/** One-line summary for CLI output, e.g. `SkillSpector: CAUTION (risk 34/100, MEDIUM)`. */
export function formatVerdict(report: SkillSpectorReport): string {
  if (report.status !== "ok") return `SkillSpector: not run (${report.error ?? report.status})`;
  const score = report.score === undefined ? "" : ` (risk ${report.score}/100, ${report.severity})`;
  const count = report.findings.length;
  const tail = count > 0 ? ` — ${count} finding(s): ${summarizeCategories(report.findings)}` : "";
  const muted = report.suppressed ? ` [${report.suppressed} baselined]` : "";
  return `SkillSpector: ${report.recommendation}${score}${tail}${muted}`;
}

function summarizeCategories(findings: SkillSpectorFinding[]): string {
  const seen: string[] = [];
  for (const f of findings) {
    if (!seen.includes(f.category)) seen.push(f.category);
    if (seen.length === 4) break;
  }
  const extra = new Set(findings.map((f) => f.category)).size - seen.length;
  return extra > 0 ? `${seen.join(", ")} +${extra} more` : seen.join(", ");
}

/**
 * Warning line for the cases where we have no verdict, so every call site
 * reports a skipped scan the same way. Returns null when a scan did run.
 */
export function unavailableNote(report: SkillSpectorReport): string | null {
  if (report.status === "ok" || report.status === "disabled") return null;
  return `⚠️  SkillSpector scan skipped: ${report.error ?? report.status}`;
}
