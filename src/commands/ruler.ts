/**
 * `cue ruler` — distribute the active profile's rules into every target agent's
 * native rule file (CLAUDE.md, AGENTS.md, .cursorrules, .clinerules, …).
 *
 * cue's rule library (resources/rules/) is declared per-profile via `rules: [...]`
 * but historically only ever reached Claude. `materialize` already fans skills +
 * MCPs out to many agents; `ruler` closes the loop for rules — the good idea from
 * github.com/intellectronica/ruler, made cue-native.
 *
 * Examples:
 *   cue ruler                     # → the profile's own agents (e.g. claude-code, codex)
 *   cue ruler --all               # → every agent cue knows
 *   cue ruler --agents cursor,codex
 *   cue ruler --dry-run --all     # preview, write nothing
 *   cue ruler --revert --all      # restore .bak / remove generated files
 */

import { relative } from "node:path";

import { loadProfile } from "../lib/profile-loader";
import { resolveActiveProfile } from "../lib/cwd-resolver";
import { getAdapter, AGENT_IDS, type AgentAdapter } from "../lib/agent-adapters";
import {
  gatherRules,
  concatRules,
  applyRuler,
  revertRuler,
  updateGitignore,
  revertGitignore,
  type RulerAction,
} from "../lib/ruler";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function flagValue(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1]! : null;
}

function rel(targetDir: string, p: string | null): string {
  if (!p) return "";
  const r = relative(targetDir, p);
  return r.startsWith("..") ? p : r;
}

function printAction(targetDir: string, name: string, a: RulerAction): void {
  const p = rel(targetDir, a.path);
  const bak = a.backupPath ? rel(targetDir, a.backupPath) : "";
  switch (a.kind) {
    case "write":
      process.stdout.write(`${GREEN}✅${RESET} ${name} → ${p}\n`);
      break;
    case "backup+write":
      process.stdout.write(`${GREEN}✅${RESET} ${name} → ${p} ${DIM}(backed up → ${bak})${RESET}\n`);
      break;
    case "dry-write":
      process.stdout.write(`${YELLOW}[dry-run]${RESET} ${name} → would write ${p}\n`);
      break;
    case "dry-backup+write":
      process.stdout.write(`${YELLOW}[dry-run]${RESET} ${name} → would back up ${p} → ${bak}, then write\n`);
      break;
    case "skip-shared":
      process.stdout.write(`${DIM}↳ ${name}: shares ${p} (already written)${RESET}\n`);
      break;
    case "skip-no-file":
      process.stdout.write(`${DIM}– ${name}: no native rules file, skipped${RESET}\n`);
      break;
    case "revert-restore":
      process.stdout.write(`${GREEN}↩${RESET} ${name}: restored ${p} from .bak\n`);
      break;
    case "dry-revert-restore":
      process.stdout.write(`${YELLOW}[dry-run]${RESET} ${name}: would restore ${p} from .bak\n`);
      break;
    case "revert-delete":
      process.stdout.write(`${GREEN}🗑${RESET}  ${name}: removed generated ${p}\n`);
      break;
    case "dry-revert-delete":
      process.stdout.write(`${YELLOW}[dry-run]${RESET} ${name}: would remove generated ${p}\n`);
      break;
    case "revert-foreign":
      process.stdout.write(`${DIM}– ${name}: ${p} not cue-generated, left intact${RESET}\n`);
      break;
    case "revert-none":
      process.stdout.write(`${DIM}– ${name}: nothing to revert${RESET}\n`);
      break;
  }
}

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue ruler — distribute the active profile's rules into every agent's native rule file

Usage: cue ruler [--all | --agents <a,b,...>] [--dir <path>] [options]
       cue ruler --revert [--all | --agents <a,b,...>] [--keep-backups]

Targets:
  (default)            the profile's own agents (its agents: list)
  --all                every agent cue knows: ${AGENT_IDS.join(", ")}
  --agents <a,b,...>   explicit comma-separated agent ids

Options:
  --dir <path>         target project dir (default: cwd)
  --profile <name>     use a specific profile (default: resolved from .cue.profile)
  --dry-run            preview; write nothing
  --gitignore          add the generated rule files (+ .bak) to .gitignore
  --revert             restore .bak files / remove cue-generated rule files
  --keep-backups       on --revert, keep the .bak files after restoring

Notes:
  Source of truth is the profile's rules[] (resolved from resources/rules/).
  Whole-file write: an existing rule file is backed up to <file>.bak on first
  write. --revert restores it. Use --dry-run first when a target file (e.g. a
  hand-written CLAUDE.md) already exists.

  Auto-on-launch: set CUE_RULER_AUTO=1 to sync the profile's rules on every
  \`cue launch\` (safe mode — never overwrites a hand-written file, no-ops when
  already current).
`);
    return 0;
  }

  const dryRun = args.includes("--dry-run");
  const doRevert = args.includes("--revert");
  const keepBackups = args.includes("--keep-backups");
  const doGitignore = args.includes("--gitignore");
  const all = args.includes("--all");
  const targetDir = flagValue(args, "--dir") ?? process.cwd();
  const profileArg = flagValue(args, "--profile");
  const agentsCsv = flagValue(args, "--agents");

  // Resolve the active profile (same pattern as `cue materialize`).
  let profile;
  try {
    const name = profileArg ?? (await resolveActiveProfile());
    if (!name) throw new Error("no active profile");
    profile = await loadProfile(name);
  } catch {
    process.stderr.write("No active profile. Pin one with `echo <name> > .cue.profile`\n");
    return 1;
  }

  // Decide target agents: --agents > --all > the profile's own agents.
  let agentIds: string[];
  if (agentsCsv) {
    agentIds = agentsCsv.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (all) {
    agentIds = [...AGENT_IDS];
  } else {
    agentIds = [...profile.agents];
  }
  if (agentIds.length === 0) {
    process.stderr.write(
      agentsCsv
        ? `--agents had no usable values. Pass ids like: --agents ${AGENT_IDS.slice(0, 2).join(",")}\n`
        : `Profile "${profile.name}" declares no agents. Use --all or --agents <a,b>.\n`,
    );
    return 1;
  }

  const adapters: AgentAdapter[] = [];
  for (const id of agentIds) {
    const adapter = getAdapter(id);
    if (!adapter) {
      process.stderr.write(`Unknown agent: "${id}". Available: ${AGENT_IDS.join(", ")}\n`);
      return 1;
    }
    adapters.push(adapter);
  }

  // --- Revert path -----------------------------------------------------------
  if (doRevert) {
    const actions = revertRuler({ adapters, targetDir, keepBackups, dryRun });
    for (const a of actions) printAction(targetDir, getAdapter(a.agent)?.name ?? a.agent, a);
    // Also undo the .gitignore block a prior --gitignore run may have added.
    if (revertGitignore(targetDir, dryRun)) {
      process.stdout.write(`${DIM}.gitignore: ${dryRun ? "would remove" : "removed"} cue ruler block${RESET}\n`);
    }
    if (dryRun) process.stdout.write(`${YELLOW}dry-run: no files changed${RESET}\n`);
    return 0;
  }

  // --- Apply path ------------------------------------------------------------
  const rules = gatherRules(profile.rules);
  if (rules.length === 0) {
    process.stdout.write(
      `Profile "${profile.name}" has no rules to distribute (rules[] is empty or unresolved).\n`,
    );
    return 0;
  }
  const content = concatRules(rules);

  process.stdout.write(
    `${profile.name}: ${rules.length} rule file(s) → ${adapters.length} agent target(s)\n`,
  );
  const actions = applyRuler({ adapters, content, targetDir, dryRun });
  for (const a of actions) printAction(targetDir, getAdapter(a.agent)?.name ?? a.agent, a);

  if (doGitignore) {
    const writtenPaths = actions
      .filter((a) => a.path && (a.kind === "write" || a.kind === "backup+write" || a.kind === "dry-write" || a.kind === "dry-backup+write"))
      .map((a) => rel(targetDir, a.path));
    const added = updateGitignore(targetDir, writtenPaths, dryRun);
    if (added.length > 0) {
      process.stdout.write(`${DIM}.gitignore: +${added.length} entr${added.length === 1 ? "y" : "ies"}${RESET}\n`);
    }
  }

  if (dryRun) process.stdout.write(`${YELLOW}dry-run: no files written${RESET}\n`);
  return 0;
}
