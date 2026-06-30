/**
 * `cue shell hook` — output shell code for auto-profile switching on cd.
 * `cue shell install` — install shims
 *
 * Usage: eval "$(cue shell hook)"
 * Adds a cd wrapper that checks .cue.profile on directory change.
 */

import { existsSync, readFileSync, statSync, accessSync, constants } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

/** True when `p` is an executable regular file (mirrors how the shell resolves
 * a command on PATH — skips directories and non-executable files). */
function isExecutableFile(p: string): boolean {
  try {
    if (!statSync(p).isFile()) return false;
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
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
  realClaude?: string;
  realCodex?: string;
}

/**
 * True when the `claude` shim is already installed in ~/.local/bin and is a
 * cue launch shim. Matches both shim formats cue writes: the user-facing
 * `cue shell install` form (`exec "<abs-path>/cue" launch claude "$@"`) and the
 * runInstall() helper form (`exec cue launch claude "$@"`) — both contain the
 * literal `launch claude`. Used by `cue init` to detect that profile loading
 * hasn't been activated yet. Conservative: any read error → false.
 */
export function shimInstalled(homeDir?: string): boolean {
  const shimPath = join(homeDir ?? homedir(), ".local", "bin", "claude");
  try {
    return existsSync(shimPath) && readFileSync(shimPath, "utf8").includes("launch claude");
  } catch {
    return false;
  }
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
export function resolveCueInvocation(opts: { repoRoot?: string; pathDirs?: string[] } = {}): string {
  const pathDirs = opts.pathDirs ?? (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const dir of pathDirs) {
    if (dir && isExecutableFile(join(dir, "cue"))) return "cue";
  }
  // Prefer the node entrypoint (npm layout) then the bash one, then ~/Documents.
  const root = opts.repoRoot ?? process.env.CUE_REPO_ROOT ?? join(homedir(), "Documents", "cue");
  for (const candidate of [join(root, "bin", "cue.mjs"), join(root, "bin", "cue")]) {
    if (existsSync(candidate)) return `"${candidate}"`;
  }
  return `"${process.argv[1] ?? "cue"}"`;
}

export async function runInstall(opts: ShimOptions = {}): Promise<number> {
  const home = opts.homeDir ?? homedir();
  const shimDir = join(home, ".local", "bin");
  const pathDirs = opts.pathDirs ?? (process.env.PATH ?? "").split(":");
  const { mkdirSync, writeFileSync, chmodSync } = await import("node:fs");

  // Check PATH ordering — shimDir must come before the real binary
  const shimIdx = pathDirs.indexOf(shimDir);
  const realClaude = opts.realClaude ?? "/usr/bin/claude";
  const realDir = realClaude ? resolve(realClaude, "..") : null;
  if (realDir) {
    const realIdx = pathDirs.indexOf(realDir);
    if (shimIdx >= 0 && realIdx >= 0 && shimIdx > realIdx) {
      process.stderr.write(`❌ ${shimDir} must appear before ${realDir} on PATH\n`);
      return 1;
    }
  }

  mkdirSync(shimDir, { recursive: true });
  const cueInvoke = resolveCueInvocation();

  const claudeShim = `#!/usr/bin/env bash\nexec ${cueInvoke} launch claude "$@"\n`;
  writeFileSync(join(shimDir, "claude"), claudeShim);
  chmodSync(join(shimDir, "claude"), 0o755);

  if (opts.realCodex) {
    const codexShim = `#!/usr/bin/env bash\nexec ${cueInvoke} launch codex "$@"\n`;
    writeFileSync(join(shimDir, "codex"), codexShim);
    chmodSync(join(shimDir, "codex"), 0o755);
  }

  return 0;
}

export async function runUninstall(opts: { homeDir?: string } = {}): Promise<number> {
  const home = opts.homeDir ?? homedir();
  const shimDir = join(home, ".local", "bin");
  const { unlinkSync } = await import("node:fs");

  for (const name of ["claude", "codex"]) {
    const p = join(shimDir, name);
    if (existsSync(p)) {
      unlinkSync(p);
    }
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
    // Existing shim install logic
    const shimDir = join(homedir(), ".local", "bin");
    const { mkdirSync, writeFileSync, chmodSync } = await import("node:fs");
    mkdirSync(shimDir, { recursive: true });

    // Portable invocation token: bare `cue` when on PATH (npm-global), else
    // an absolute path to the cue entrypoint. See resolveCueInvocation.
    const cueInvoke = resolveCueInvocation();

    // Claude shim
    const claudeShim = `#!/usr/bin/env bash
exec ${cueInvoke} launch claude "$@"
`;
    writeFileSync(join(shimDir, "claude"), claudeShim);
    chmodSync(join(shimDir, "claude"), 0o755);
    process.stdout.write(`✅ Installed claude shim → ${shimDir}/claude\n`);

    // Codex shim (optional)
    if (args.includes("--codex")) {
      const codexShim = `#!/usr/bin/env bash
exec ${cueInvoke} launch codex "$@"
`;
      writeFileSync(join(shimDir, "codex"), codexShim);
      chmodSync(join(shimDir, "codex"), 0o755);
      process.stdout.write(`✅ Installed codex shim → ${shimDir}/codex\n`);
    }

    process.stdout.write(`\nAdd the shell hook to auto-switch profiles on cd:\n`);
    process.stdout.write(`  echo 'eval "$(cue shell hook)"' >> ~/.bashrc\n`);

    // Auto-install completions
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

    return 0;
  }

  process.stderr.write("Usage: cue shell hook    — output shell hook for eval\n");
  process.stderr.write("       cue shell install — install claude/codex shims\n");
  return 1;
}
