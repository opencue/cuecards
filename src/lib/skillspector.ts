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
  error?: string;
}

export type RunnerKind = "bin" | "path" | "uvx" | "docker";

export interface Runner {
  kind: RunnerKind;
  cmd: string;
  args: string[];
  /** Path to hand to `scan` — differs from the host path under docker. */
  target: string;
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
 * Build the argv for a given runner kind. Pure — the docker case rewrites the
 * scan target to the container mount point, which is why callers must use
 * `runner.target` instead of the host path they passed in.
 */
export function buildRunner(kind: RunnerKind, dir: string, bin?: string): Runner {
  switch (kind) {
    case "bin":
      return { kind, cmd: bin!, args: [], target: dir, label: bin! };
    case "path":
      return { kind, cmd: "skillspector", args: [], target: dir, label: "skillspector" };
    case "uvx":
      return {
        kind,
        cmd: "uvx",
        args: ["--from", SKILLSPECTOR_PKG, "skillspector"],
        target: dir,
        label: "uvx skillspector",
      };
    case "docker":
      return {
        kind,
        cmd: "docker",
        args: ["run", "--rm", "-v", `${dir}:/scan:ro`, "skillspector"],
        target: "/scan",
        label: "docker skillspector",
      };
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
  opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
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

  const runner = buildRunner(detected.kind, dir, detected.bin);
  const timeout = Number(env.CUE_SKILLSPECTOR_TIMEOUT_MS ?? opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const res = spawnSync(
    runner.cmd,
    [...runner.args, "scan", runner.target, "--no-llm", "--format", "json"],
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
  return `SkillSpector: ${report.recommendation}${score}${tail}`;
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
