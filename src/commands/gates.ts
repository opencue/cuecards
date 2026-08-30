/**
 * `cue gates` — inspect and run profile quality gates.
 *
 * Subcommands:
 *   cue gates list [--profile <name>]
 *       Show which gate scripts the active (or named) profile declares,
 *       and whether each resolves to a real file under resources/quality-gates/.
 *
 *   cue gates run [--profile <name>] [--fail-fast]
 *       Execute every declared gate sequentially, OUT-OF-BAND from any
 *       Claude session. Same scripts, same exit codes as the Stop hook,
 *       but never vetoes — exits 0 if everything passed, 1 otherwise.
 *       Useful for "did I fix all the gates yet" before letting Claude run.
 *
 *   cue gates status [--profile <name>] [--all] [--json]
 *       Show the most recent Stop-hook gate run for this profile (or all
 *       profiles with --all). Reads `~/.config/cue/gate-status/*.json`
 *       written by `resources/hooks/cue-quality-gates.sh`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadProfile } from "../lib/profile-loader";
import {
  ensureGateStatusDir,
  readAllGateStatus,
  readGateStatus,
  type GateRun,
} from "../lib/gate-status";

const REPO_ROOT = resolve(new URL(import.meta.url).pathname, "..", "..", "..");
const GATES_RESOURCE_DIR = join(REPO_ROOT, "resources", "quality-gates");

interface ParsedArgs {
  sub: "list" | "run" | "status" | "help";
  profile: string | null;
  failFast: boolean;
  all: boolean;
  json: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    sub: "help",
    profile: null,
    failFast: false,
    all: false,
    json: false,
  };
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") return out;
  const first = argv[0]!;
  if (first === "list" || first === "run" || first === "status") {
    out.sub = first;
  } else {
    return out; // unknown subcommand → fall through to help
  }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--profile") out.profile = argv[++i] ?? null;
    else if (a === "--fail-fast") out.failFast = true;
    else if (a === "--all") out.all = true;
    else if (a === "--json") out.json = true;
  }
  return out;
}

function helpText(): string {
  return [
    "cue gates — inspect and run profile quality gates",
    "",
    "Usage:",
    "  cue gates list   [--profile <name>]",
    "  cue gates run    [--profile <name>] [--fail-fast]",
    "  cue gates status [--profile <name>] [--all] [--json]",
    "",
    "Quality gates are scripts under resources/quality-gates/ that a profile",
    "declares via `qualityGates: [name1, name2, ...]`. The Stop hook executes",
    "them at session end; any non-zero exit vetoes the Stop.",
    "",
  ].join("\n");
}

function resolveActiveProfile(explicit: string | null): string | null {
  if (explicit) return explicit;
  // Pinned to cwd?
  const pin = join(process.cwd(), ".cue.profile");
  if (existsSync(pin)) {
    try {
      const txt = readFileSync(pin, "utf8").trim().split("\n")[0]?.trim();
      if (txt) return txt;
    } catch { /* fall through */ }
  }
  // CUE_PROFILE env (set by an active `cue launch`).
  if (process.env.CUE_PROFILE) return process.env.CUE_PROFILE;
  return null;
}

function gateSourcePath(ref: string): string {
  // qualityGates entries may or may not include .sh — normalize.
  const fname = ref.endsWith(".sh") ? ref : `${ref}.sh`;
  return join(GATES_RESOURCE_DIR, fname);
}

async function gatesForProfile(profileSelector: string): Promise<string[]> {
  // Composite (a+b+c): union of all parts' qualityGates.
  const parts = profileSelector.split("+").map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    try {
      const loaded = await loadProfile(p);
      for (const g of (loaded as { qualityGates?: string[] }).qualityGates ?? []) {
        if (seen.has(g)) continue;
        seen.add(g);
        out.push(g);
      }
    } catch { /* skip — surfaced by doctor */ }
  }
  return out;
}

async function runList(args: ParsedArgs): Promise<number> {
  const profile = resolveActiveProfile(args.profile);
  if (!profile) {
    process.stderr.write("cue gates list: no profile pinned and --profile not given\n");
    return 1;
  }
  const gates = await gatesForProfile(profile);
  if (gates.length === 0) {
    process.stdout.write(`No quality gates declared for "${profile}".\n`);
    return 0;
  }
  process.stdout.write(`Quality gates for "${profile}":\n`);
  for (const g of gates) {
    const src = gateSourcePath(g);
    const ok = existsSync(src);
    const marker = ok ? "  ✓" : "  ✗";
    const note = ok ? "" : "   (missing — `cue doctor` will flag)";
    process.stdout.write(`${marker} ${g}${note}\n`);
  }
  return 0;
}

async function runRun(args: ParsedArgs): Promise<number> {
  const profile = resolveActiveProfile(args.profile);
  if (!profile) {
    process.stderr.write("cue gates run: no profile pinned and --profile not given\n");
    return 1;
  }
  const gates = await gatesForProfile(profile);
  if (gates.length === 0) {
    process.stdout.write(`No quality gates declared for "${profile}". Nothing to run.\n`);
    return 0;
  }
  let anyFailed = false;
  for (const g of gates) {
    const src = gateSourcePath(g);
    if (!existsSync(src)) {
      process.stderr.write(`✗ ${g}   (source missing at ${src})\n`);
      anyFailed = true;
      if (args.failFast) break;
      continue;
    }
    process.stdout.write(`\n→ ${g}\n`);
    const res = spawnSync("bash", [src], {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env },
    });
    if (res.status !== 0) {
      process.stderr.write(`✗ ${g} (exit ${res.status})\n`);
      anyFailed = true;
      if (args.failFast) break;
    } else {
      process.stdout.write(`✓ ${g}\n`);
    }
  }
  return anyFailed ? 1 : 0;
}

function fmtRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (!Number.isFinite(diff)) return iso;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return iso.slice(0, 10);
}

function printRun(run: GateRun): void {
  const overallGlyph = run.overall === "pass" ? "✓" : run.overall === "fail" ? "✗" : "·";
  process.stdout.write(
    `${overallGlyph} ${run.profile}   ${run.overall.toUpperCase()}   (${fmtRelative(run.ts)})\n`,
  );
  for (const r of run.results) {
    const g = r.ok ? "  ✓" : "  ✗";
    process.stdout.write(`${g} ${r.name}${r.ok ? "" : ` (exit ${r.exit})`}\n`);
    if (!r.ok && r.stderr) {
      // Indent stderr block so it's visually nested under the gate.
      for (const line of r.stderr.split("\n").slice(0, 8)) {
        if (line.length === 0) continue;
        process.stdout.write(`       ${line}\n`);
      }
    }
  }
}

async function runStatus(args: ParsedArgs): Promise<number> {
  if (args.all) {
    const all = readAllGateStatus();
    if (args.json) {
      process.stdout.write(JSON.stringify(all, null, 2) + "\n");
      return 0;
    }
    if (all.length === 0) {
      process.stdout.write(
        "No gate runs recorded yet. They get written by the Stop hook when a session ends.\n",
      );
      return 0;
    }
    for (const run of all) {
      printRun(run);
      process.stdout.write("\n");
    }
    return 0;
  }

  const profile = resolveActiveProfile(args.profile);
  if (!profile) {
    process.stderr.write(
      "cue gates status: no profile pinned and --profile not given (try --all)\n",
    );
    return 1;
  }
  const run = readGateStatus(profile);
  if (args.json) {
    process.stdout.write(JSON.stringify(run, null, 2) + "\n");
    return 0;
  }
  if (!run) {
    process.stdout.write(
      `No gate runs recorded for "${profile}" yet. End a Claude session with this profile active and the Stop hook will populate this.\n`,
    );
    return 0;
  }
  printRun(run);
  return 0;
}

export async function run(argv: string[]): Promise<number> {
  // Touch the status dir lazily so consumers can rely on its existence.
  try { ensureGateStatusDir(); } catch { /* non-fatal */ }
  const args = parseArgs(argv);
  switch (args.sub) {
    case "list": return runList(args);
    case "run": return runRun(args);
    case "status": return runStatus(args);
    case "help":
    default:
      process.stdout.write(helpText());
      return 0;
  }
}

// Re-export so callers can compose without importing the helpers separately.
export { readGateStatus, readAllGateStatus } from "../lib/gate-status";
