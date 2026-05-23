#!/usr/bin/env bun
/**
 * cue CLI entrypoint.
 *
 * Pure dispatch: parse the leading flags (--help, --version), pick a
 * subcommand from the registry in commands/_index.ts, and hand the rest of
 * argv to that command's `run(args)`. All real logic lives in command modules.
 *
 * Exit codes:
 *   0  success
 *   1  user error (unknown command, bad args, missing profile)
 *   2  internal error (uncaught exception, missing dep)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { COMMANDS, type CommandName } from "./commands/_index";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.CUE_REPO_ROOT ?? process.env.SOUL_REPO_ROOT ?? resolve(HERE, "..");

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printHelp(): void {
  const groups: Record<string, [string, string][]> = {
    "Profile Management": [
      ["list", "List available profiles"],
      ["use", "Activate a profile for the current directory"],
      ["current", "Show the active profile"],
      ["new", "Scaffold a new profile"],
      ["create-profile", "Create profile from skills/MCPs list"],
      ["icon", "Pick an emoji icon for a profile"],
      ["init", "Interactive project scanner + profile wizard"],
      ["auto-detect", "Detect project type and suggest a profile"],
      ["diff", "Compare two profiles side-by-side"],
      ["tree", "Visualize profile inheritance tree"],
      ["lock", "Lock a profile to prevent modifications"],
      ["unlock", "Unlock a previously locked profile"],
    ],
    "Skills": [
      ["skills", "Manage skills: list, search, rank, add/remove"],
      ["skills add", "Install skills from GitHub with profile hook"],
      ["skills rank", "Show skill usage leaderboard"],
      ["packs", "Manage skill packs (grouped bundles)"],
    ],
    "MCPs & Marketplace": [
      ["mcps", "Manage MCP servers: list, add, remove"],
      ["marketplace", "Search and install from remote registry"],
      ["sources", "Show GitHub repos providing skills"],
    ],
    "Diagnostics & Optimization": [
      ["optimizer", "Review profiles: skills, MCPs, CLIs dashboard"],
      ["doctor", "Diff declared vs actual state; --fix repairs"],
      ["validate", "Schema + lint checks for profiles"],
      ["cost", "Estimate token budget for a profile"],
      ["stats", "Profile usage analytics"],
      ["scan", "Tree of installed skills/plugins by domain"],
      ["why", "Trace why a skill/MCP is loaded"],
    ],
    "Launch & Shell": [
      ["launch", "Resolve + materialize + exec claude/codex"],
      ["shell", "Install/uninstall shims (~/.local/bin)"],
      ["update", "Self-update: git pull + bun install"],
      ["upgrade", "Pull new skills from the registry"],
      ["clean", "Prune stale runtimes and cache"],
      ["migrate", "Auto-migrate profiles to latest schema"],
    ],
    "Multi-Agent": [
      ["colony-dispatch", "Resolve profile for a Colony task"],
      ["handoff", "Pass skill context between agents"],
      ["trace", "Live session inspector"],
      ["replay", "Replay session with different profile"],
      ["replay --what-if", "Simulate session with alternate profile"],
    ],
    "Intelligence": [
      ["ai", "Create profile from natural language"],
      ["suggest", "Usage-based profile recommendations"],
      ["score", "Profile efficiency score (A+ to F)"],
      ["benchmark", "Measure token usage from transcripts"],
    ],
    "Import / Export": [
      ["import", "Import profile from URL, file, or repo"],
      ["export", "Export profile as portable YAML"],
      ["snapshot", "Export/restore current profile state"],
      ["share", "Publish/browse community profiles"],
    ],
  };

  process.stdout.write(
    "\x1b[1mcue\x1b[0m — Agent Profile Manager for Claude Code & Codex\n" +
    "Pick a profile. Launch with the right skills, MCPs, and plugins.\n\n" +
    "\x1b[1mUsage:\x1b[0m cue <command> [args...]\n\n"
  );

  for (const [group, cmds] of Object.entries(groups)) {
    process.stdout.write(`\x1b[1m${group}:\x1b[0m\n`);
    for (const [name, desc] of cmds) {
      process.stdout.write(`  ${name.padEnd(18)}${desc}\n`);
    }
    process.stdout.write("\n");
  }

  process.stdout.write(
    "\x1b[1mGlobal flags:\x1b[0m\n" +
    "  -h, --help       Show this help\n" +
    "  -v, --version    Print version\n\n" +
    "\x1b[2mRun `cue <command> --help` for command-specific usage.\x1b[0m\n"
  );
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  // Substring match
  if (b.includes(a) || a.includes(b)) return 0.8;
  // Bigram similarity
  const bigramsA = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));
  let matches = 0;
  for (let i = 0; i < b.length - 1; i++) {
    if (bigramsA.has(b.slice(i, i + 2))) matches++;
  }
  return (2 * matches) / (a.length - 1 + b.length - 1);
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);

  if (args.length === 0) {
    // Show status dashboard by default (like `git status`)
    const statusCmd = COMMANDS["status"];
    try {
      const mod = await statusCmd.load();
      return await mod.run([]);
    } catch {
      printHelp();
      return 0;
    }
  }

  if (args[0] === "-h" || args[0] === "--help" || args[0] === "help") {
    printHelp();
    return 0;
  }

  if (args[0] === "-v" || args[0] === "--version" || args[0] === "version") {
    process.stdout.write(readVersion() + "\n");
    return 0;
  }

  const name = args[0] as CommandName;
  const cmd = COMMANDS[name];
  if (!cmd) {
    process.stderr.write(`cue: unknown command "${name}"\n`);
    // Suggest similar commands
    const allCmds = Object.keys(COMMANDS);
    const similar = allCmds
      .map((c) => ({ name: c, score: similarity(name, c) }))
      .filter((c) => c.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (similar.length > 0) {
      process.stderr.write(`\nDid you mean?\n`);
      for (const s of similar) {
        process.stderr.write(`  cue ${s.name}\n`);
      }
    }
    process.stderr.write(`\nRun "cue --help" for all commands.\n`);
    return 1;
  }

  try {
    const mod = await cmd.load();
    return await mod.run(args.slice(1));
  } catch (err) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(`cue: internal error in "${name}": ${msg}\n`);
    return 2;
  }
}

main(process.argv).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`cue: fatal: ${err}\n`);
    process.exit(2);
  },
);
