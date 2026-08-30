/**
 * Detect every running Claude/Codex agent session on this machine.
 *
 * Discovery strategy (in order of preference):
 *   1. comm == "claude" | "codex"            — direct binary install
 *   2. comm == "node" | "bun" + cmdline contains "claude"/"codex"
 *
 * Profile resolution (first match wins):
 *   a. CUE_PROFILE env var                                — set by `cue launch`
 *   b. CLAUDE_CONFIG_DIR matches `<runtimeRoot>/<profile>/claude`
 *      — works for plain `claude` wrappers like claude-account2 that
 *        bypass `cue launch` but still point at a cue runtime
 *   c. `.cue.profile` file in the process's cwd
 *   d. "(unpinned)" — agent is running but isn't using a cue profile
 *
 * Linux-only. macOS exposes env via `ps eww` but with different escaping;
 * a fallback could parse that. For now non-Linux returns `[]` and the
 * dashboard card renders a clear "platform not supported" message.
 *
 * Read failures per-pid are silent — short-lived processes disappear mid-walk,
 * and other users' processes return EACCES on /proc/<pid>/environ. Both are
 * expected; we skip them and keep going.
 */

import { existsSync, readdirSync, readFileSync, readlinkSync, } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ActiveSession {
  pid: number;
  profile: string;
  /** How the profile was resolved — useful when the user wonders why a row says "(unpinned)". */
  profileSource: "env" | "config-dir" | "cwd-pin" | "unpinned";
  agent: string | null;
  cwd: string | null;
  /** Process start time, ISO. Falls back to "" when /proc/<pid>/stat isn't readable. */
  startedAt: string;
}

/** True on Linux where /proc is mounted with the layout we need. */
export function supportsProcScan(): boolean {
  return process.platform === "linux" && existsSync("/proc/self/environ");
}

/**
 * Read `/proc/<pid>/environ` (NUL-separated KEY=VALUE pairs) into a map.
 * Returns null when unreadable so the caller knows to skip the pid.
 */
function readEnviron(pid: number): Map<string, string> | null {
  try {
    const raw = readFileSync(`/proc/${pid}/environ`, "utf8");
    const map = new Map<string, string>();
    for (const entry of raw.split("\0")) {
      const eq = entry.indexOf("=");
      if (eq <= 0) continue;
      map.set(entry.slice(0, eq), entry.slice(eq + 1));
    }
    return map;
  } catch {
    return null;
  }
}

function bootTimeMs(): number | null {
  try {
    const raw = readFileSync("/proc/stat", "utf8");
    const line = raw.split("\n").find((l) => l.startsWith("btime "));
    if (!line) return null;
    const btime = parseInt(line.split(/\s+/)[1] ?? "", 10);
    return Number.isFinite(btime) ? btime * 1000 : null;
  } catch {
    return null;
  }
}

let CLK_TCK = 100;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { execSync } = require("node:child_process");
  const out = execSync("getconf CLK_TCK", { encoding: "utf8", timeout: 200 }).trim();
  const parsed = parseInt(out, 10);
  if (Number.isFinite(parsed) && parsed > 0) CLK_TCK = parsed;
} catch { /* keep default */ }

function processStartIso(pid: number, btimeMs: number | null): string {
  if (btimeMs == null) return "";
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = raw.lastIndexOf(")");
    if (closeParen < 0) return "";
    const fields = raw.slice(closeParen + 2).split(/\s+/);
    const startTicks = parseInt(fields[19] ?? "", 10);
    if (!Number.isFinite(startTicks)) return "";
    return new Date(btimeMs + (startTicks / CLK_TCK) * 1000).toISOString();
  } catch {
    return "";
  }
}

/**
 * Extract a cue profile name from a `CLAUDE_CONFIG_DIR` value. Matches the
 * canonical `<root>/<profile>/claude` materializer layout. Profile names may
 * be composite (`a+b+c`) — `+` is allowed; everything else strips to a safe
 * subset to avoid path-injection edge cases reaching the UI.
 *
 * Exported for tests.
 */
export function profileFromConfigDir(configDir: string | undefined): string | null {
  if (!configDir) return null;
  // Normal layout: <something>/<profile>/claude
  // <profile> can be a composite like "a+b+c", so we capture everything
  // between the last `/<...>/claude` and the slash before it.
  const m = configDir.match(/\/([a-z0-9][a-z0-9_+.-]*)\/claude\/?$/i);
  return m ? m[1]! : null;
}

/**
 * Read `.cue.profile` from a cwd (process-cwd fallback). Trimmed first line.
 * Exported for tests.
 */
export function profileFromCwdPin(cwd: string | null): string | null {
  if (!cwd) return null;
  try {
    const raw = readFileSync(join(cwd, ".cue.profile"), "utf8");
    const first = raw.split("\n")[0]?.trim();
    return first && first.length > 0 ? first : null;
  } catch {
    return null;
  }
}

/**
 * Decide whether a process row is an agent we should report. Heuristic:
 *   - comm matches "claude" or "codex" exactly (the installed binary form)
 *   - OR comm is node/bun AND cmdline contains "claude"/"codex" as a word
 *     AND it doesn't look like one of cue's own subcommands.
 * Exported for tests.
 */
export function isAgentProcess(comm: string, cmdline: string): boolean {
  if (comm === "claude" || comm === "codex") return true;
  if (comm !== "node" && comm !== "bun") return false;

  if (!/\b(claude|codex)\b/i.test(cmdline)) return false;

  // Exclude cue's own helper subcommands so the dashboard server, mcp
  // stdio, skill-report runs, etc. don't masquerade as agent sessions.
  const cueOwnSubcommands =
    /(?:^|\s|\/)(?:dashboard|mcp|skill-report|prune|gates|share|suggest-pairs|trigger-gaps|status|launch|use|list|init|doctor)\b/;
  if (cueOwnSubcommands.test(cmdline)) return false;

  return true;
}

/** Enumerate active agent sessions, newest first. */
export function listActiveSessions(): ActiveSession[] {
  if (!supportsProcScan()) return [];

  const btimeMs = bootTimeMs();
  const home = homedir();
  const out: ActiveSession[] = [];

  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = parseInt(entry, 10);
    if (pid === process.pid) continue;

    // comm is cheap and discriminating — fetch it first so we can skip
    // the vast majority of system processes without reading environ.
    let comm = "";
    try { comm = readFileSync(`/proc/${pid}/comm`, "utf8").trim(); } catch { continue; }
    if (!comm) continue;

    // Quick reject: anything that obviously isn't an agent binary.
    if (
      comm !== "claude" && comm !== "codex" &&
      comm !== "node" && comm !== "bun"
    ) continue;

    let cmdline = "";
    try {
      cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
    } catch { /* ignore */ }

    if (!isAgentProcess(comm, cmdline)) continue;

    // Profile resolution. CUE_PROFILE wins; otherwise sniff CLAUDE_CONFIG_DIR
    // (covers wrappers like `claude-account2` that bypass `cue launch` but
    // still point at a cue runtime); otherwise read .cue.profile from cwd.
    const env = readEnviron(pid);
    let profile: string | null = null;
    let profileSource: ActiveSession["profileSource"] = "unpinned";

    if (env?.get("CUE_PROFILE")) {
      profile = env.get("CUE_PROFILE")!;
      profileSource = "env";
    }

    let cwd: string | null = null;
    try { cwd = readlinkSync(`/proc/${pid}/cwd`); } catch { /* unreadable */ }

    if (!profile && env) {
      const fromCfg = profileFromConfigDir(env.get("CLAUDE_CONFIG_DIR"));
      if (fromCfg) {
        profile = fromCfg;
        profileSource = "config-dir";
      }
    }

    if (!profile) {
      const fromCwd = profileFromCwdPin(cwd);
      if (fromCwd) {
        profile = fromCwd;
        profileSource = "cwd-pin";
      }
    }

    if (!profile) {
      profile = "(unpinned)";
      profileSource = "unpinned";
    }

    // Tidy cwd: collapse $HOME → ~ so the dashboard table reads cleanly
    // without losing the leading-/ disambiguation for non-home paths.
    let displayCwd = cwd;
    if (cwd && home && cwd.startsWith(home)) {
      displayCwd = "~" + cwd.slice(home.length);
    }

    out.push({
      pid,
      profile,
      profileSource,
      agent: env?.get("CUE_AGENT") ?? (comm === "codex" ? "codex" : "claude"),
      cwd: displayCwd,
      startedAt: btimeMs ? processStartIso(pid, btimeMs) : "",
    });
  }

  out.sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || "") || b.pid - a.pid);
  return out;
}
