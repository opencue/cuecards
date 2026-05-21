/**
 * `soul launch <agent>` — the hot path.
 *
 * Flow: resolve(cwd) → if none, runPicker() → materializeRuntime() → exec.
 *
 * Bypass paths:
 *   --cue-profile <name>   force this profile
 *   --cue-pick             always open picker (ignore pins)
 *   --dry-run              everything except the final exec; prints env
 *
 * Recursion guard via CUE_LAUNCHING=1 in child env.
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

import { loadProfile, listProfiles } from "../lib/profile-loader";
import { resolveProfileForCwd } from "../lib/cwd-resolver";
import { runPicker, type PickerOption } from "../lib/picker";
import { materializeRuntime } from "../lib/runtime-materializer";
import { resolveLocalSkill } from "../lib/resolver-local";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  agent: "claude" | "codex" | null;
  override: string | null;
  forcePick: boolean;
  dryRun: boolean;
  passthrough: string[];
}

function parse(args: string[]): ParsedArgs {
  let agent: ParsedArgs["agent"] = null;
  let override: string | null = null;
  let forcePick = false;
  let dryRun = false;
  const passthrough: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (i === 0 && (a === "claude" || a === "codex")) {
      agent = a;
    } else if (a === "--cue-profile") {
      override = args[++i] ?? null;
    } else if (a === "--cue-pick") {
      forcePick = true;
    } else if (a === "--dry-run") {
      dryRun = true;
    } else {
      passthrough.push(a!);
    }
  }
  return { agent, override, forcePick, dryRun, passthrough };
}

// ---------------------------------------------------------------------------
// Config dir helper
// ---------------------------------------------------------------------------

function configDir(): string {
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "cue")
    : join(homedir(), ".config", "cue");
}

// ---------------------------------------------------------------------------
// Exec helper — spawn with inherited stdio so interactive sessions work
// ---------------------------------------------------------------------------

function execAgent(bin: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((res) => {
    const child = spawn(bin, args, { env, stdio: "inherit" });
    child.on("exit", (code) => res(code ?? 0));
    child.on("error", () => res(127));
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function listProfileOptions(): Promise<PickerOption[]> {
  const names = await listProfiles();
  const opts: PickerOption[] = [];
  for (const name of names) {
    try {
      const p = await loadProfile(name);
      opts.push({ value: name, label: name, hint: p.description });
    } catch {
      opts.push({ value: name, label: name, hint: "" });
    }
  }
  return opts;
}

async function loadMcpRegistry(agent: "claude-code" | "codex"): Promise<Record<string, unknown>> {
  const file = agent === "claude-code" ? "claude.sanitized.json" : "codex.sanitized.json";
  const root = process.env.SOUL_REPO_ROOT ?? resolve(
    new URL(import.meta.url).pathname,
    "..",
    "..",
    "..",
    "..",
  );
  const path = join(root, "mcps", "configs", file);
  try {
    const text = await readFile(path, "utf8");
    const raw = JSON.parse(text) as { servers?: Record<string, unknown> };
    return raw.servers ?? {};
  } catch {
    return {};
  }
}

async function readUserClaudeMd(agent: "claude-code" | "codex"): Promise<string> {
  const path =
    agent === "claude-code"
      ? join(homedir(), ".claude", "CLAUDE.md")
      : join(homedir(), ".codex", "AGENTS.md");
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function findRealBinary(name: string): Promise<string | null> {
  const shimDir = join(homedir(), ".local", "bin");
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(":")) {
    if (resolve(dir) === resolve(shimDir)) continue;
    const candidate = join(dir, name);
    try {
      const { stat } = await import("node:fs/promises");
      const st = await stat(candidate);
      if (st.isFile() && (st.mode & 0o111) !== 0) return candidate;
    } catch {
      // not in this dir
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function run(args: string[]): Promise<number> {
  // Recursion guard
  if (process.env.CUE_LAUNCHING === "1") {
    process.stderr.write(
      "cue: shim recursion detected — check PATH ordering (~/.local/bin must precede the real claude/codex location)\n",
    );
    return 2;
  }

  const parsed = parse(args);
  if (!parsed.agent) {
    process.stderr.write("cue launch: missing agent (use 'claude' or 'codex')\n");
    return 1;
  }
  const agentKind = parsed.agent === "claude" ? "claude-code" : "codex";

  // Resolve profile.
  const cwd = process.cwd();
  const resolved = parsed.forcePick
    ? { source: "none" as const }
    : await resolveProfileForCwd({
        cwd,
        homeDir: homedir(),
        configDir: configDir(),
        override: parsed.override,
      });

  let profileName: string;
  if (resolved.source === "none") {
    if (!process.stdin.isTTY) {
      process.stderr.write(
        "cue launch: no profile resolved and stdin is not a TTY; pass --cue-profile <name>\n",
      );
      return 1;
    }
    const options = await listProfileOptions();
    const picked = await runPicker({ cwd, options });
    profileName = picked.profile;
  } else {
    profileName = (resolved as { source: string; profile: string }).profile;
  }

  // Load + materialize.
  let profile;
  try {
    profile = await loadProfile(profileName);
  } catch (err) {
    process.stderr.write(`cue launch: ${(err as Error).message}\n`);
    return 1;
  }

  const runtime = await materializeRuntime({
    profile,
    agent: agentKind,
    runtimeRoot: join(configDir(), "runtime"),
    skillSourceLookup: (id) => resolveLocalSkill(id),
    mcpRegistry: await loadMcpRegistry(agentKind),
    userClaudeMd: await readUserClaudeMd(agentKind),
  });

  const envKey = agentKind === "claude-code" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    [envKey]: runtime.runtimeDir,
    CUE_LAUNCHING: "1",
  };

  if (parsed.dryRun) {
    process.stdout.write(
      JSON.stringify(
        {
          profile: profileName,
          agent: agentKind,
          runtimeDir: runtime.runtimeDir,
          rebuilt: runtime.rebuilt,
          hash: runtime.hash,
          env: { [envKey]: childEnv[envKey] },
          command: [parsed.agent, ...parsed.passthrough],
        },
        null,
        2,
      ) + "\n",
    );
    return 0;
  }

  // Exec the real agent binary.
  const realBin = await findRealBinary(parsed.agent);
  if (!realBin) {
    process.stderr.write(
      `cue launch: couldn't find the real '${parsed.agent}' binary on PATH=${process.env.PATH}\n`,
    );
    return 127;
  }

  return execAgent(realBin, parsed.passthrough, childEnv);
}
