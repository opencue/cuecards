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


function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(repoRoot(), "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
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
  "skills",
  "mcps",
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

// ---------------------------------------------------------------------------
// Auto-update check — runs at most once per 24h, non-blocking
// ---------------------------------------------------------------------------

async function checkForUpdate(currentVersion: string): Promise<void> {
  const { existsSync, readFileSync: rf, writeFileSync: wf, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { configDir } = await import("./lib/config-paths");

  const cfgDir = configDir();
  const checkFile = join(cfgDir, ".last-update-check");

  // Only check once per 24 hours
  if (existsSync(checkFile)) {
    const last = parseInt(rf(checkFile, "utf8").trim(), 10) || 0;
    if (Date.now() - last < 86400000) return;
  }

  // Fetch latest version from npm
  const res = await fetch("https://registry.npmjs.org/cue-ai/latest", { signal: AbortSignal.timeout(3000) });
  if (!res.ok) return;
  const data = await res.json() as { version?: string };
  const latest = data.version;
  if (!latest) return;

  // Save check timestamp
  mkdirSync(cfgDir, { recursive: true });
  wf(checkFile, String(Date.now()));

  // Compare versions
  if (latest === currentVersion) return;
  const [cMaj, cMin, cPatch] = currentVersion.split(".").map(Number);
  const [lMaj, lMin, lPatch] = latest.split(".").map(Number);
  if (lMaj! < cMaj! || (lMaj === cMaj && lMin! < cMin!) || (lMaj === cMaj && lMin === cMin && lPatch! <= cPatch!)) return;

  // Prompt user
  process.stderr.write(`\n  ⬆️  Update available: ${currentVersion} → ${latest}\n`);
  process.stderr.write(`     Run: npm install -g cue-ai\n\n`);

  // Auto-install prompt (only in interactive TTY)
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const readline = await import("node:readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    const answer = await new Promise<string>((resolve) => {
      rl.question("     Install now? [y/N] ", (a) => { rl.close(); resolve(a); });
      // Auto-decline after 5 seconds — never install a new global without an
      // affirmative y/yes. Walking away from the terminal must be a no-op.
      setTimeout(() => { rl.close(); resolve("n"); }, 5000);
    });
    if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
      process.stderr.write("     📦 Updating...\n");
      const { spawnSync } = await import("node:child_process");
      const result = spawnSync("npm", ["install", "-g", "cue-ai"], { encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] });
      if (result.status === 0) {
        process.stderr.write(`     ✅ Updated to ${latest}\n\n`);
      } else {
        process.stderr.write(`     ⚠️  Update failed. Run manually: npm install -g cue-ai\n\n`);
      }
    }
  }
}

// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);

  // Update check — never during a live agent launch. The `claude`/`codex`
  // shim is `exec cue launch ...`, so running it here would open a readline on
  // the agent's stdin (stealing keystrokes) and could fire a blocking
  // `npm install -g` mid-session. Skip for any command that spawns an agent
  // (`launch`, plus `quick`/`playground`), for trivial or non-interactive
  // invocations, when launching (CUE_LAUNCHING), or in CI.
  const AGENT_LAUNCH_COMMANDS = new Set(["launch", "quick", "playground"]);
  const TRIVIAL_ARGS = new Set(["--version", "-v", "version", "--help", "-h", "help"]);
  const skipUpdateCheck =
    AGENT_LAUNCH_COMMANDS.has(args[0] ?? "") ||
    TRIVIAL_ARGS.has(args[0] ?? "") ||
    // Any depth counts — CUE_LAUNCHING carries a number now, not just "1".
    !!process.env.CUE_LAUNCHING ||
    !!process.env.CI ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY;
  if (!skipUpdateCheck) checkForUpdate(readVersion()).catch(() => {});

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
