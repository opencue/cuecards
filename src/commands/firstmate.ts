/** Firstmate owns orchestration; Cue selects its primary or offers live adoption. */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { constants } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import * as p from "@clack/prompts";

import { findRealAgentBin } from "../lib/claude-binary";
import { canonicalCodexHome } from "../lib/codex-config";
import { configDir } from "../lib/config-paths";
import { resolveClaudeCredentialsSource } from "../lib/runtime-install";
import { shimDir, stripShimDirFromPath } from "../lib/shim-dir";

const REPOSITORY = "https://github.com/NagyVikt/firstmate.git";
const HARNESSES = ["claude", "codex", "grok", "pi", "pi-signed", "omp", "opencode", "cursor-agent"];

function usage(): void {
  process.stdout.write(
    "cue firstmate [--agent <harness>] [--repo <path>] [-- <agent args>]\n" +
    "cue firstmate --setup [--repo <path>]\n\n" +
    "cue firstmate promote [--accept] [--repo <path>]\n\n" +
    `Harnesses: ${HARNESSES.join(", ")}\n` +
    "Without --agent, opens an interactive coordinator picker.\n" +
    "promote prints a no-restart handoff for the running agent; --accept verifies adoption and adds its tmux badge.\n" +
    "--setup explicitly downloads NagyVikt/firstmate; it never installs tools or launches agents.\n" +
    "Checkout: --repo, then CUE_FIRSTMATE_REPO, then <cue config>/firstmate.\n" +
    "Firstmate runs from its own checkout, without a Cue profile or OMX wrapper.\n" +
    "Its upstream hooks, trust prompts, credentials and crew permission settings still apply.\n",
  );
}

function isCheckout(repo: string): boolean {
  try {
    return existsSync(join(repo, ".git")) &&
      ["AGENTS.md", "CLAUDE.md", "bin/fm-session-start.sh", ".claude/settings.json", ".codex/hooks.json"]
        .every(file => statSync(join(repo, file)).isFile()) &&
      statSync(join(repo, ".agents/skills")).isDirectory();
  } catch {
    return false;
  }
}

export async function run(args: string[]): Promise<number> {
  const promote = args[0] === "promote";
  if (promote) args = args.slice(1);
  const separator = args.indexOf("--");
  const passthrough = separator < 0 ? [] : args.slice(separator + 1);
  let values;
  try {
    ({ values } = parseArgs({
      args: separator < 0 ? args : args.slice(0, separator),
      options: {
        agent: { type: "string" }, repo: { type: "string" },
        setup: { type: "boolean" }, help: { type: "boolean", short: "h" },
        accept: { type: "boolean" },
      },
      strict: true, allowPositionals: false,
    }));
    if ((promote && (values.setup || values.agent !== undefined || separator >= 0)) || (!promote && values.accept)) {
      throw new Error("promote [--accept] is separate from launch/--setup and takes no agent arguments");
    }
    if (values.agent !== undefined && !HARNESSES.includes(values.agent)) {
      throw new Error(`--agent must be one of: ${HARNESSES.join(", ")}`);
    }
    if (values.setup && (values.agent !== undefined || passthrough.length > 0)) {
      throw new Error("--setup only prepares the checkout; select --agent in a separate launch");
    }
    if (passthrough.some(arg => arg === "-C" || arg.startsWith("-C") || arg === "--cd" || arg.startsWith("--cd="))) {
      throw new Error("agent cwd overrides are not supported; Firstmate must run from its checkout");
    }
  } catch (error) {
    process.stderr.write(`cue firstmate: ${error instanceof Error ? error.message : "invalid arguments"}\n`);
    return 2;
  }
  if (values.help) { usage(); return 0; }
  if (process.platform === "win32") {
    process.stderr.write("cue firstmate: use WSL; the upstream runtime requires a Unix shell.\n");
    return 1;
  }

  const requested = values.repo ?? process.env.CUE_FIRSTMATE_REPO ?? join(configDir(), "firstmate");
  if (!requested.trim() || /[\x00-\x1f\x7f]/.test(requested)) {
    process.stderr.write("cue firstmate: invalid checkout path\n");
    return 2;
  }
  const repo = resolve(requested);
  if (values.setup && !existsSync(repo)) {
    await mkdir(dirname(repo), { recursive: true });
    // Explicit --setup is download consent. Never pull/reset an existing checkout.
    const clone = spawnSync("git", ["clone", "--", REPOSITORY, repo], { stdio: "inherit" });
    if (clone.error || clone.status !== 0) {
      process.stderr.write("cue firstmate: clone failed; inspect the destination before retrying.\n");
      return 1;
    }
  }
  if (!isCheckout(repo)) {
    process.stderr.write(`cue firstmate: not a complete Firstmate checkout: ${repo}\n` +
      "Use --setup to download into a new directory, or --repo for an existing checkout.\n");
    return 1;
  }
  if (values.setup) {
    process.stdout.write(`Firstmate ready: ${repo}\nRun cue firstmate --repo ${JSON.stringify(repo)} to select the coordinator.\n`);
    return 0;
  }
  if (promote) {
    const { promoteFirstmate } = await import("../lib/firstmate-live");
    return promoteFirstmate(repo, values.accept ?? false);
  }

  let agent = values.agent;
  if (!agent) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      process.stderr.write("cue firstmate: non-interactive launch requires --agent <harness>\n");
      return 2;
    }
    const selected = await p.select({
      message: "Which agent should be your Firstmate coordinator?",
      options: HARNESSES.map(value => ({
        value, label: value,
        hint: findRealAgentBin(value) ? "installed" : "not found on PATH",
      })),
    });
    if (p.isCancel(selected)) return 130;
    agent = selected;
  }
  const bin = findRealAgentBin(agent);
  if (!bin) {
    process.stderr.write(`cue firstmate: ${agent} CLI not found outside Cue's shim; no tools were installed.\n`);
    return 127;
  }

  const env = { ...process.env };
  // Do not attach this primary or its crew to a caller's temporary profile/home.
  for (const key of ["CUE_REAL_CODEX", "CUE_REAL_CLAUDE", "CUE_LAUNCHING",
    "FM_ROOT_OVERRIDE", "FM_STATE_OVERRIDE", "FM_DATA_OVERRIDE", "FM_CONFIG_OVERRIDE", "FM_PROJECTS_OVERRIDE"]) {
    delete env[key];
  }
  env.FM_HOME = repo;
  env.CODEX_HOME = canonicalCodexHome();
  env.CLAUDE_CONFIG_DIR = await resolveClaudeCredentialsSource();
  env.PATH = stripShimDirFromPath(env.PATH, shimDir());
  // Also protects crew launches through legacy Cue shims left elsewhere on PATH.
  env.CUE_BYPASS = "1";
  process.stderr.write(`⚓ Firstmate — ${agent} coordinator in ${repo}\n`);
  const { setFirstmateBadge } = await import("../lib/firstmate-live");
  return new Promise(resolveExit => {
    const child = spawn(bin, passthrough, { cwd: repo, env, stdio: "inherit" });
    child.on("spawn", () => {
      if (!process.env.TMUX_PANE || !child.pid) return;
      try { setFirstmateBadge(child.pid); }
      catch (error) { process.stderr.write(`cue firstmate: badge unavailable (${error instanceof Error ? error.message : "tmux error"}); agent launch unchanged.\n`); }
    });
    child.on("error", error => {
      process.stderr.write(`cue firstmate: failed to launch ${agent}: ${error.message}\n`);
      resolveExit(127);
    });
    child.on("exit", (code, signal) => resolveExit(code ?? (signal ? 128 + constants.signals[signal] : 1)));
  });
}
