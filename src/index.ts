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
import { resolve } from "node:path";
import { COMMANDS, type CommandName } from "./commands/_index";
import { runCommand } from "./lib/command-runner";
import { repoRoot } from "./lib/repo-root";


let _version: string | null = null;
function readVersion(): string {
  if (_version !== null) return _version;
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(repoRoot(), "package.json"), "utf8"),
    ) as { version?: string };
    _version = pkg.version ?? "0.0.0";
    return _version;
  } catch {
    return "0.0.0";
  }
}

const ESSENTIAL_COMMANDS: CommandName[] = [
  "setup",
  "use",
  "current",
  "status",
  "list",
  "launch",
  "work",
  "skills",
  "mcps",
  "auth",
  "doctor",
  "validate",
  "sync",
  "tui",
];

function printCommandRows(names: CommandName[]): void {
  const width = Math.max(...names.map((name) => name.length)) + 2;
  for (const name of names) {
    process.stdout.write(`  ${name.padEnd(width)}${COMMANDS[name].summary}\n`);
  }
}

function printHelp(all = false): void {

  process.stdout.write(
    "\x1b[1mcue\x1b[0m — Agent Profile Manager for Claude Code & Codex\n" +
    "Pick a profile. Launch with the right skills, MCPs, and plugins.\n\n" +
    "\x1b[1mUsage:\x1b[0m cue <command> [args...]\n\n"
  );

  const commands = all
    ? (Object.keys(COMMANDS).sort() as CommandName[])
    : ESSENTIAL_COMMANDS;
  process.stdout.write(`\x1b[1m${all ? "All commands" : "Core commands"}:\x1b[0m\n`);
  printCommandRows(commands);
  process.stdout.write("\n");

  process.stdout.write(
    "\x1b[1mGlobal flags:\x1b[0m\n" +
    "  -h, --help       Show this help\n" +
    "      --all        Show the full command catalogue\n" +
    "  -v, --version    Print version\n\n"
  );

  process.stdout.write(
    "\x1b[1mExamples:\x1b[0m\n" +
    "  $ cue                       Show status for the current directory\n" +
    "  $ cue list                  List available profiles\n" +
    "  $ cue use skill-writer      Activate a profile here\n" +
    "  $ cue skills search lint    Find skills matching a keyword\n" +
    "  $ cue doctor --fix          Diagnose and repair the active profile\n\n"
  );

  process.stdout.write(
    "\x1b[1mLearn more:\x1b[0m\n" +
    (all ? "" : "  Run `cue --help --all` for every command.\n") +
    "  Run `cue <command> --help` for command-specific usage.\n" +
    "  Run `cue status` for the current-directory dashboard.\n"
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
    return runCommand("status", [], COMMANDS.status);
  }

  if (args[0] === "-h" || args[0] === "--help" || args[0] === "help") {
    printHelp(args.includes("--all"));
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

  return runCommand(name, args.slice(1), cmd);
}

main(process.argv).then(
  // Let stdout/stderr drain before Node/Bun exits. Calling process.exit()
  // truncates large machine-readable responses (notably `cue list --json`)
  // when the CLI is piped into jq or another consumer.
  (code) => { process.exitCode = code; },
  (err) => {
    process.stderr.write(`cue: fatal: ${err}\n`);
    process.exitCode = 2;
  },
);
