/**
 * `cue shell hook` — output shell code for auto-profile switching on cd.
 * `cue shell install` — install shims
 *
 * Usage: eval "$(cue shell hook)"
 * Adds a cd wrapper that checks .cue.profile on directory change.
 */

import { existsSync, readFileSync, statSync, accessSync, constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

import { findRealAgentBin } from "../lib/claude-binary";
import {
  FISH_DROPIN_MARKER,
  SHIM_AGENTS,
  fishDropIn,
  fishDropInPath,
  isCueShimContent,
  rcSnippet,
  shimContent,
  shimDir,
  shimDirPosition,
  shimPath,
  type ShimAgent,
  type ShimShell,
} from "../lib/shim-dir";

/** True when `p` is an executable regular file (mirrors how the shell resolves
 * a command on PATH — skips directories and non-executable files). */
function isExecutableFile(p: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    if (!statSync(p).isFile()) return false;
    if (platform !== "win32") accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandCandidates(name: string, platform: NodeJS.Platform): string[] {
  return platform === "win32"
    ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name]
    : [name];
}

function hookBash(): string {
  return `# cue shell hook — auto-switch profile on cd
__cue_cd() {
  builtin cd "$@" || return
  __cue_check_profile
}

__cue_check_profile() {
  local dir="$PWD"
  local profile=""
  while [ "$dir" != "/" ] && [ "$dir" != "$HOME" ]; do
    if [ -f "$dir/.cue.profile" ]; then
      profile="$(cat "$dir/.cue.profile" 2>/dev/null | tr -d '\\n')"
      break
    fi
    dir="$(dirname "$dir")"
  done
  if [ -n "$profile" ] && [ "$profile" != "$__CUE_ACTIVE_PROFILE" ]; then
    export __CUE_ACTIVE_PROFILE="$profile"
    echo -e "\\033[38;5;208mcue:\\033[0m switched to profile \\033[1m$profile\\033[0m"
  fi
}

alias cd='__cue_cd'
# Check on shell start too
__cue_check_profile
`;
}

function hookZsh(): string {
  return `# cue shell hook — auto-switch profile on cd
__cue_check_profile() {
  local dir="$PWD"
  local profile=""
  while [[ "$dir" != "/" && "$dir" != "$HOME" ]]; do
    if [[ -f "$dir/.cue.profile" ]]; then
      profile="$(cat "$dir/.cue.profile" | tr -d '\\n')"
      break
    fi
    dir="$(dirname "$dir")"
  done
  if [[ -n "$profile" && "$profile" != "$__CUE_ACTIVE_PROFILE" ]]; then
    export __CUE_ACTIVE_PROFILE="$profile"
    echo -e "\\033[38;5;208mcue:\\033[0m switched to profile \\033[1m$profile\\033[0m"
  fi
}

autoload -U add-zsh-hook
add-zsh-hook chpwd __cue_check_profile
# Check on shell start too
__cue_check_profile
`;
}

function hookFish(): string {
  return `# cue shell hook — auto-switch profile on cd
function __cue_check_profile --on-variable PWD
  set -l dir $PWD
  set -l profile ""
  while test "$dir" != "/" -a "$dir" != "$HOME"
    if test -f "$dir/.cue.profile"
      set profile (cat "$dir/.cue.profile" | string trim)
      break
    end
    set dir (dirname "$dir")
  end
  if test -n "$profile" -a "$profile" != "$__CUE_ACTIVE_PROFILE"
    set -gx __CUE_ACTIVE_PROFILE $profile
    echo -e "\\033[38;5;208mcue:\\033[0m switched to profile \\033[1m$profile\\033[0m"
  end
end
__cue_check_profile
`;
}

export type HookShell = "bash" | "zsh" | "fish";

export function resolveHookShell(requested?: string, envShell = process.env.SHELL ?? "/bin/bash"): HookShell {
  const shell = (requested || envShell || "/bin/bash").toLowerCase();
  if (shell.includes("zsh")) return "zsh";
  if (shell.includes("fish")) return "fish";
  return "bash";
}

export interface ShimOptions {
  homeDir?: string;
  pathDirs?: string[];
  /**
   * Explicit real-binary paths. `null` means "known absent", `undefined` means
   * "resolve it yourself via findRealAgentBin()". Injection point for tests.
   */
  realClaude?: string | null;
  realCodex?: string | null;
  /** Agents to consider. Each one with a real binary behind it gets a shim. */
  agents?: readonly ShimAgent[];
  /** Shell whose rc receives the PATH line. Defaults to $SHELL. */
  shell?: ShimShell;
  /** OS injection for cross-platform tests. Production uses process.platform. */
  platform?: NodeJS.Platform;
  /** false → print the PATH line but write nothing (`--no-rc`). */
  writeRc?: boolean;
  /** Skip the confirmation before appending to an existing bash/zsh rc. */
  yes?: boolean;
  /** Confirmation hook. Returning false leaves the rc untouched. */
  confirm?: (message: string) => Promise<boolean>;
  /** Test seam for the Windows CurrentUser PATH registry update. */
  updateWindowsPath?: (
    dir: string,
    action: "add" | "remove",
  ) => boolean | Promise<boolean>;
  /** Test seam for reading User + Machine PATH from the Windows environment store. */
  readWindowsPathDirs?: () => string[];
  out?: (s: string) => void;
  err?: (s: string) => void;
}

function windowsPathScript(action: "add" | "remove"): string {
  const kept = "$parts=@($p -split ';' | Where-Object { $_ -and $_.TrimEnd('\\') -ine $d.TrimEnd('\\') })";
  const next = action === "add" ? "(@($d)+$parts)-join ';'" : "$parts-join ';'";
  return [
    "$d=$env:CUE_SHIM_DIR",
    "$p=[Environment]::GetEnvironmentVariable('Path','User')",
    kept,
    `[Environment]::SetEnvironmentVariable('Path',${next},'User')`,
  ].join("; ");
}

function updateWindowsUserPath(dir: string, action: "add" | "remove"): boolean {
  const env = { ...process.env, CUE_SHIM_DIR: dir };
  for (const command of ["powershell.exe", "pwsh.exe"]) {
    const result = spawnSync(
      command,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", windowsPathScript(action)],
      { env, stdio: "ignore", windowsHide: true },
    );
    if (result.status === 0) return true;
  }
  return false;
}

/**
 * Read the persisted Windows PATH rather than trusting only the current
 * process. Installers update User PATH in the registry, but an already-open
 * PowerShell keeps its old environment until the next terminal starts.
 */
function readWindowsPathDirs(): string[] {
  const script = [
    "$p=@([Environment]::GetEnvironmentVariable('Path','User'),[Environment]::GetEnvironmentVariable('Path','Machine'))",
    "$p=$p|Where-Object{$_}",
    "[Console]::Out.Write([Environment]::ExpandEnvironmentVariables(($p-join ';')))",
  ].join("; ");

  for (const command of ["powershell.exe", "pwsh.exe"]) {
    const result = spawnSync(
      command,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      },
    );
    if (result.status === 0 && result.stdout) {
      return result.stdout.split(";").map((dir) => dir.trim()).filter(Boolean);
    }
  }
  return [];
}

function windowsPathGuidance(dir: string): string {
  const escaped = dir.replaceAll("'", "''");
  return `$env:CUE_SHIM_DIR='${escaped}'; ${windowsPathScript("add")}`;
}

/**
 * Put cue's shim dir on PATH.
 *
 * fish gets a brand-new conf.d drop-in, which is undone by deleting one file —
 * safe enough to create without asking. bash/zsh require appending to an rc the
 * user already owns, so that path asks first (`--yes` skips the prompt).
 * Idempotent in both cases: a second install finds the dir already referenced
 * and writes nothing.
 *
 * Returns true when the PATH line is in place.
 */
async function ensureRcPath(a: {
  shell: ShimShell;
  dir: string;
  line: string;
  home: string;
  homeDir?: string;
  writeRc?: boolean;
  yes?: boolean;
  confirm?: (message: string) => Promise<boolean>;
  out: (s: string) => void;
  err: (s: string) => void;
}): Promise<boolean> {
  if (a.writeRc === false) return false;
  const { mkdirSync, writeFileSync, appendFileSync } = await import("node:fs");

  if (a.shell === "fish") {
    const target = fishDropInPath(a.homeDir);
    if (existsSync(target)) {
      // Never clobber a file we can't prove we wrote.
      if (readFileSync(target, "utf8").includes(a.dir)) return true;
      a.err(`⚠️  ${target} exists and doesn't reference ${a.dir} — leaving it alone.\n`);
      return false;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, fishDropIn(a.dir));
    a.out(`✅ PATH configured → ${target}\n`);
    return true;
  }

  const rcPath = join(a.home, a.shell === "zsh" ? ".zshrc" : ".bashrc");
  if (existsSync(rcPath) && readFileSync(rcPath, "utf8").includes(a.dir)) return true;
  const approved = a.yes === true || (a.confirm ? await a.confirm(`Append the cue PATH line to ${rcPath}?`) : false);
  if (!approved) return false;
  appendFileSync(rcPath, `\n# cue: agent shims (claude/codex) ahead of the real binaries\n${a.line}\n`);
  a.out(`✅ PATH configured → ${rcPath}\n`);
  return true;
}

/**
 * True when the `<agent>` shim is installed and is a cue launch shim. Matches
 * both formats cue writes — `exec cue launch claude "$@"` and
 * `exec "<abs-path>/cue" launch claude "$@"`.
 *
 * Checks cue's own shim dir first, then falls back to the legacy
 * `~/.local/bin/<agent>` path so `cue init`'s "profile loading isn't activated
 * yet" hint stays correct for anyone who installed before the shim dir moved.
 * Conservative: any read error → false.
 */
export function shimInstalled(
  homeDir?: string,
  agent: ShimAgent = "claude",
  platform: NodeJS.Platform = process.platform,
): boolean {
  const candidates = [
    shimPath(shimDir(homeDir), agent, platform),
    ...(platform === "win32" ? [] : [join(homeDir ?? homedir(), ".local", "bin", agent)]),
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && isCueShimContent(readFileSync(candidate, "utf8"), agent)) return true;
    } catch {
      // Unreadable — fall through and try the other location.
    }
  }
  return false;
}

/**
 * Resolve the token to place after `exec ` in a shim so it works for BOTH
 * npm-global installs (cue is on PATH, there is no source clone) and
 * source-clone users.
 *
 * - Prefers the portable bare `cue` when it's resolvable on PATH (the
 *   npm-global-correct form, and the form the docs advertise).
 * - Otherwise falls back to an absolute path to the cue entrypoint
 *   (CUE_REPO_ROOT is exported by both `bin/cue` and `bin/cue.mjs` when cue
 *   runs itself), double-quoted for the shell.
 *
 * Either form keeps the literal `launch <agent>` substring the caller
 * appends, so shimInstalled() detects both. Previously `cue shell install`
 * hard-coded `~/Documents/cue/bin/cue`, which doesn't exist for npm-global
 * users — the shim pointed at a missing file and `claude` broke.
 */
export function resolveCueInvocation(opts: {
  repoRoot?: string;
  pathDirs?: string[];
  platform?: NodeJS.Platform;
} = {}): string {
  const platform = opts.platform ?? process.platform;
  const separator = platform === "win32" ? ";" : ":";
  const pathDirs = opts.pathDirs ?? (process.env.PATH ?? "").split(separator).filter(Boolean);
  for (const dir of pathDirs) {
    for (const name of commandCandidates("cue", platform)) {
      if (dir && isExecutableFile(join(dir, name), platform)) return "cue";
    }
  }
  // Prefer the node entrypoint (npm layout) then the bash one, then ~/Documents.
  const root = opts.repoRoot ?? process.env.CUE_REPO_ROOT ?? join(homedir(), "Documents", "cue");
  for (const candidate of [join(root, "bin", "cue.mjs"), join(root, "bin", "cue")]) {
    if (existsSync(candidate)) {
      return platform === "win32"
        ? `"${process.execPath}" "${candidate}"`
        : `"${candidate}"`;
    }
  }
  const current = process.argv[1] ?? "cue";
  return platform === "win32"
    ? `"${process.execPath}" "${current}"`
    : `"${current}"`;
}

/**
 * Install the `claude` / `codex` shims into cue's own shim dir and put that dir
 * on PATH.
 *
 * Ordering is the safety property: resolve the real binaries and pass the
 * "refuse if none" gate BEFORE writing anything, then write the new shims, then
 * clean up legacy ones. A run that fails must never leave the user with fewer
 * working entry points than it started with — the previous version of this
 * function overwrote `~/.local/bin/claude`, which on a native install is the
 * real binary's symlink, and left nothing for `findRealAgentBin()` to exec.
 */
export async function runInstall(opts: ShimOptions = {}): Promise<number> {
  const out = opts.out ?? ((s: string) => process.stdout.write(s));
  const err = opts.err ?? ((s: string) => process.stderr.write(s));
  const home = opts.homeDir ?? homedir();
  const platform = opts.platform ?? process.platform;
  const dir = shimDir(opts.homeDir);
  const separator = platform === "win32" ? ";" : ":";
  const processPathDirs = opts.pathDirs ?? (process.env.PATH ?? "").split(separator);
  const persistedPathDirs = platform === "win32"
    ? (opts.readWindowsPathDirs ?? readWindowsPathDirs)()
    : [];
  const pathDirs = [...processPathDirs, ...persistedPathDirs].filter(Boolean);
  const agents = opts.agents ?? SHIM_AGENTS;
  const { mkdirSync, writeFileSync, chmodSync, unlinkSync } = await import("node:fs");

  // 1. Resolve real binaries first — see the ordering note above.
  const injected: Record<ShimAgent, string | null | undefined> = {
    claude: opts.realClaude,
    codex: opts.realCodex,
  };
  const real = new Map<ShimAgent, string>();
  for (const agent of agents) {
    const bin = injected[agent] !== undefined
      ? injected[agent]
      : findRealAgentBin(agent, { platform, pathValue: pathDirs.join(separator) });
    if (bin) real.set(agent, bin);
  }
  if (real.size === 0) {
    err(`❌ No real ${agents.join(" or ")} binary found on PATH — refusing to install a shim with nothing behind it.\n`);
    err(`   Install the agent first, or point CUE_REAL_CLAUDE at its path.\n`);
    return 1;
  }

  // 2. Write the shims.
  mkdirSync(dir, { recursive: true });
  const cueInvoke = resolveCueInvocation({ pathDirs, platform });
  for (const agent of real.keys()) {
    const target = shimPath(dir, agent, platform);
    writeFileSync(target, shimContent(cueInvoke, agent, platform));
    if (platform !== "win32") chmodSync(target, 0o755);
    out(`✅ Installed ${agent} shim → ${target}\n`);
  }

  // 3. Migrate off the legacy ~/.local/bin location. A stale cue shim there
  //    would shadow the very binary the new shim needs to exec. Only remove a
  //    file whose CONTENT proves cue wrote it: on a native Claude install this
  //    same path is the real binary's symlink.
  for (const agent of platform === "win32" ? [] : real.keys()) {
    const legacy = join(home, ".local", "bin", agent);
    try {
      if (existsSync(legacy) && isCueShimContent(readFileSync(legacy, "utf8"), agent)) {
        unlinkSync(legacy);
        out(`🧹 Removed legacy cue shim → ${legacy}\n`);
      }
    } catch {
      // Unreadable, or not ours — leave it strictly alone.
    }
  }

  // 4. PATH. The shims are inert until the dir is on PATH, so a PATH that isn't
  //    set up yet is a warning, never a failure — this run may well be the one
  //    adding the line.
  const firstReal = real.values().next().value as string;
  const shell = opts.shell ?? resolveHookShell();
  const line = rcSnippet(shell, dir);
  const position = shimDirPosition(pathDirs, firstReal, dir, platform);

  if (platform === "win32" && position !== "before") {
    const updater = opts.updateWindowsPath ?? updateWindowsUserPath;
    const configured = opts.writeRc !== false && await updater(dir, "add");
    if (configured) {
      out(`✅ User PATH configured → ${dir}\n`);
      out(`\n▸ Open a new terminal to pick it up.\n`);
    } else {
      err(`\n⚠️  ${dir} is not first on User PATH — the shims are inert or shadowed until it is.\n`);
      err(`   Run this in PowerShell, then open a new terminal:\n     ${windowsPathGuidance(dir)}\n`);
    }
    return 0;
  }

  if (position === "absent") {
    const configured = await ensureRcPath({ ...opts, shell, dir, line, home, out, err });
    if (configured) {
      out(`\n▸ Open a new terminal (or re-source your config) to pick it up.\n`);
    } else {
      err(`\n⚠️  ${dir} is not on PATH — the shims are inert until it is.\n`);
      err(`   Add this line, then open a new terminal:\n     ${line}\n`);
    }
  } else if (position === "after") {
    err(`\n⚠️  ${dirname(firstReal)} precedes ${dir} on PATH — the real binary shadows the shim.\n`);
    err(`   Move ${dir} earlier on PATH, then open a new terminal.\n`);
  }

  return 0;
}

/**
 * Remove the shims and the fish drop-in cue created.
 *
 * Deliberately never touches `~/.local/bin`: on a native Claude install that
 * path IS the real binary. A legacy cue shim found there is reported, not
 * deleted — the blast radius of a wrong guess is the user's whole Claude
 * install, and `runInstall()` already migrates it away on the next install.
 */
export async function runUninstall(
  opts: {
    homeDir?: string;
    platform?: NodeJS.Platform;
    updateWindowsPath?: ShimOptions["updateWindowsPath"];
    out?: (s: string) => void;
    err?: (s: string) => void;
  } = {},
): Promise<number> {
  const out = opts.out ?? ((s: string) => process.stdout.write(s));
  const err = opts.err ?? ((s: string) => process.stderr.write(s));
  const home = opts.homeDir ?? homedir();
  const platform = opts.platform ?? process.platform;
  const dir = shimDir(opts.homeDir);
  const { unlinkSync } = await import("node:fs");

  for (const agent of SHIM_AGENTS) {
    const target = shimPath(dir, agent, platform);
    if (existsSync(target)) {
      unlinkSync(target);
      out(`🗑️  Removed ${target}\n`);
    }
  }

  if (platform === "win32") {
    const updater = opts.updateWindowsPath ?? updateWindowsUserPath;
    if (await updater(dir, "remove")) {
      out(`🗑️  Removed ${dir} from User PATH\n`);
    } else {
      err(`⚠️  Couldn't remove ${dir} from User PATH automatically.\n`);
    }
  } else {
    const fishTarget = fishDropInPath(opts.homeDir);
    try {
      if (existsSync(fishTarget) && readFileSync(fishTarget, "utf8").includes(FISH_DROPIN_MARKER)) {
        unlinkSync(fishTarget);
        out(`🗑️  Removed ${fishTarget}\n`);
      }
    } catch {
      // Unreadable or hand-edited — leave it for the user.
    }
  }

  for (const agent of platform === "win32" ? [] : SHIM_AGENTS) {
    const legacy = join(home, ".local", "bin", agent);
    try {
      if (existsSync(legacy) && isCueShimContent(readFileSync(legacy, "utf8"), agent)) {
        err(`⚠️  A legacy cue shim remains at ${legacy} — remove it by hand to fully deactivate.\n`);
      }
    } catch {
      // Not readable — nothing useful to report.
    }
  }

  if (platform !== "win32") {
    out(`\nbash/zsh: remove the cue PATH line from your rc if you added one.\n`);
  }
  return 0;
}

export async function run(args: string[]): Promise<number> {
  const sub = args[0];

  if (sub === "hook") {
    const shell = resolveHookShell(args[1]);
    if (shell === "zsh") {
      process.stdout.write(hookZsh());
    } else if (shell === "fish") {
      process.stdout.write(hookFish());
    } else {
      process.stdout.write(hookBash());
    }
    return 0;
  }

  if (sub === "install") {
    // One code path only. This branch used to carry its own copy of the
    // install logic, which is how it drifted out of sync with runInstall().
    // `--codex` is accepted as a no-op: both agents are shimmed by default now,
    // whichever ones actually resolve to a real binary.
    const rc = await runInstall({
      writeRc: !args.includes("--no-rc"),
      yes: args.includes("--yes") || args.includes("-y"),
      confirm: async (message) => {
        if (!process.stdin.isTTY) return false;
        const p = await import("@clack/prompts");
        const answer = await p.confirm({ message });
        return !p.isCancel(answer) && answer === true;
      },
    });
    if (rc !== 0) return rc;

    if (process.platform !== "win32") {
      process.stdout.write(`\nAdd the shell hook to auto-switch profiles on cd:\n`);
      process.stdout.write(`  eval "$(cue shell hook)"\n`);
    }

    await installCompletions();
    return 0;
  }

  if (sub === "uninstall") return runUninstall();

  process.stderr.write("Usage: cue shell hook      — output shell hook for eval\n");
  process.stderr.write("       cue shell install   — install claude/codex shims [--yes] [--no-rc]\n");
  process.stderr.write("       cue shell uninstall — remove the shims and the PATH drop-in\n");
  return 1;
}

/** Best-effort completion install for the current shell. Never fails install. */
async function installCompletions(): Promise<void> {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const shell = process.env.SHELL ?? "/bin/bash";
  const { completionScript } = await import("./completions");
  if (shell.includes("zsh")) {
    const compDir = join(homedir(), ".zsh", "completions");
    mkdirSync(compDir, { recursive: true });
    writeFileSync(join(compDir, "_cue"), completionScript("zsh"));
    process.stdout.write(`✅ Installed zsh completions → ${compDir}/_cue\n`);
    process.stdout.write(`   Add to .zshrc: fpath=(~/.zsh/completions $fpath); autoload -Uz compinit && compinit\n`);
  } else if (shell.includes("bash")) {
    const compDir = join(homedir(), ".local", "share", "bash-completion", "completions");
    mkdirSync(compDir, { recursive: true });
    writeFileSync(join(compDir, "cue"), completionScript("bash"));
    process.stdout.write(`✅ Installed bash completions → ${compDir}/cue\n`);
  }
}
