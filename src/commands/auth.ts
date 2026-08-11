/** Unified authentication UX for the Claude and Codex CLIs used through cue. */
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { findRealAgentBin } from "../lib/claude-binary";
import { configDir } from "../lib/config-paths";
import { codexAuthFreshness, syncCodexAuth } from "../lib/codex-auth";
import { resolveClaudeCredentialsSource } from "../lib/runtime-install";

type Agent = "claude" | "codex";

function usage(): void {
  process.stdout.write(
    "cue auth [status]\n" +
    "cue auth login <claude|codex>\n" +
    "cue auth logout <claude|codex>\n" +
    "cue auth repair\n\n" +
    "Status is read-only. Login/logout operate on the canonical account store,\n" +
    "not one profile runtime. Repair reconciles fresher runtime credentials.\n",
  );
}

function canonicalEnv(agent: Agent, claudeSource: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(agent === "claude" ? { CLAUDE_CONFIG_DIR: claudeSource } : { CODEX_HOME: join(homedir(), ".codex") }),
  };
}

function runAgent(agent: Agent, args: string[], claudeSource: string): number {
  const bin = findRealAgentBin(agent);
  if (!bin) {
    process.stderr.write(`cue auth: ${agent} CLI not found outside cue's shim\n`);
    return 1;
  }
  const result = spawnSync(bin, args, { stdio: "inherit", env: canonicalEnv(agent, claudeSource) });
  return result.status ?? 1;
}

async function status(claudeSource: string): Promise<number> {
  process.stdout.write(`Claude (${claudeSource})\n`);
  const claude = runAgent("claude", ["auth", "status"], claudeSource);
  process.stdout.write(`\nCodex (${join(homedir(), ".codex")})\n`);
  const codex = runAgent("codex", ["login", "status"], claudeSource);
  return claude === 0 && codex === 0 ? 0 : 1;
}

export async function repair(
  claudeSource: string,
  options: {
    canonical?: string;
    runtimeRoot?: string;
    healClaude?: () => Promise<unknown>;
  } = {},
): Promise<number> {
  // Calling with healFromRuntime performs Claude's UUID-guarded freshness sweep.
  await (options.healClaude ?? (() => resolveClaudeCredentialsSource({ healFromRuntime: true })))();

  const canonical = options.canonical ?? join(homedir(), ".codex", "auth.json");
  const runtimeRoot = options.runtimeRoot ?? join(configDir(), "runtime");
  const candidates: string[] = [];
  try {
    for (const key of await readdir(runtimeRoot)) candidates.push(join(runtimeRoot, key, "codex", "auth.json"));
  } catch { /* no runtimes yet */ }

  let freshest = canonical;
  let freshestAt = await codexAuthFreshness(canonical) ?? -1;
  for (const path of candidates) {
    const at = await codexAuthFreshness(path);
    if (at !== undefined && at > freshestAt) {
      freshest = path;
      freshestAt = at;
    }
  }
  if (freshestAt < 0) {
    process.stderr.write("Auth repair failed: no valid Codex credentials were found.\n");
    return 1;
  }
  if (freshest !== canonical) {
    await syncCodexAuth(freshest, canonical);
    const promotedAt = await codexAuthFreshness(canonical);
    if (promotedAt === undefined || promotedAt < freshestAt) {
      process.stderr.write("Auth repair failed: could not update canonical Codex credentials.\n");
      return 1;
    }
  }
  let updated = 0;
  let failed = 0;
  const canonicalAt = await codexAuthFreshness(canonical);
  for (const path of candidates) {
    if (await syncCodexAuth(canonical, path)) {
      updated++;
      continue;
    }
    const runtimeAt = await codexAuthFreshness(path);
    if (canonicalAt !== undefined && (runtimeAt === undefined || runtimeAt < canonicalAt)) failed++;
  }

  if (failed > 0) {
    process.stderr.write(`Auth repair incomplete: ${failed} Codex runtime(s) could not be updated.\n`);
    return 1;
  }

  process.stdout.write(`Auth repair complete. Claude source: ${claudeSource}; Codex runtimes updated: ${updated}.\n`);
  return 0;
}

export async function run(args: string[]): Promise<number> {
  const action = args[0] ?? "status";
  if (action === "-h" || action === "--help" || action === "help") {
    usage();
    return 0;
  }

  // Ignore an inherited cue runtime when choosing where login should persist.
  const inherited = process.env.CLAUDE_CONFIG_DIR;
  const runtimeRoot = join(configDir(), "runtime");
  if (inherited?.startsWith(runtimeRoot)) delete process.env.CLAUDE_CONFIG_DIR;
  const claudeSource = await resolveClaudeCredentialsSource();

  if (action === "status") return status(claudeSource);
  if (action === "repair") return repair(claudeSource);
  if (action === "login" || action === "logout") {
    const agent = args[1] as Agent | undefined;
    if (agent !== "claude" && agent !== "codex") {
      process.stderr.write(`cue auth ${action}: choose claude or codex\n`);
      return 1;
    }
    return runAgent(agent, agent === "claude" ? ["auth", action] : [action], claudeSource);
  }

  usage();
  return 1;
}
