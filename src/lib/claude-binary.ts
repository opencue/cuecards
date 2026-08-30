/**
 * Locate the real agent binary (`claude` / `codex`) on PATH, skipping cue's shim.
 *
 * cue installs `<configDir>/shims/claude` as a bash one-liner that calls
 * `cue launch claude`; shelling to that from within cue would recurse or
 * trigger the picker. That directory is cue's alone, so it is skipped outright.
 * Legacy shims in ~/.local/bin are detected by CONTENT instead — the native
 * Claude installer owns that directory too, and the npm package no longer ships
 * a `claude` bin, so skipping it wholesale would skip the only real binary on
 * the machine.
 *
 * Lookup order for claude:
 *   1. $CUE_REAL_CLAUDE (explicit override)
 *   2. $CLAUDE_CODE_EXECPATH (set by claude-code itself on subprocesses)
 *   3. Walk $PATH, skipping any small shim that contains `cue launch`.
 *
 * `cue launch codex` additionally honors $CUE_REAL_CODEX ahead of the PATH walk
 * — see `codexExecOverride`.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve, win32 } from "node:path";

import { isCueShimContent, shimDir } from "./shim-dir";

/**
 * Walk $PATH for an executable named `name`, skipping cue's own shims.
 *
 * Two independent guards, because either alone has a hole:
 *
 *  - **Directory**: anything inside cue's own shim dir is cue's, full stop.
 *    Cheap, and immune to however the shim body happens to be written.
 *  - **Content**: a small script that reads as a cue shim, wherever it lives.
 *    Still needed for the legacy `~/.local/bin/<agent>` shims cue used to
 *    write, which sit in a directory the native Claude installer also owns —
 *    skipping that whole directory would skip the only real binary on the
 *    machine.
 *
 * The content test goes through `isCueShimContent`, shared with the installer.
 * It previously matched `/cue\s+launch/i` inline, which silently failed on the
 * absolute-path shim form (`exec "/…/bin/cue" launch claude "$@"`) — the quote
 * between `cue` and `launch` is not whitespace — so a source-clone user's shim
 * was mistaken for the real binary and `cue launch` recursed into itself.
 */
export interface AgentBinSearchOptions {
  platform?: NodeJS.Platform;
  pathValue?: string;
  pathExt?: string;
}

function commandNames(
  name: string,
  platform: NodeJS.Platform,
  pathExt = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD",
): string[] {
  if (platform !== "win32") return [name];
  const extensions = pathExt.split(";").filter(Boolean);
  const names = extensions.flatMap((ext) => {
    const normalized = ext.startsWith(".") ? ext : `.${ext}`;
    return [`${name}${normalized}`, `${name}${normalized.toLowerCase()}`];
  });
  return [...new Set([...names, name])];
}

function isRunnableFile(path: string, platform: NodeJS.Platform): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && (platform === "win32" || (stat.mode & 0o111) !== 0);
  } catch {
    return false;
  }
}

/** Windows npm launchers are .cmd files and must be spawned through cmd.exe. */
export function needsWindowsCommandShell(
  bin: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" && /\.(cmd|bat)$/i.test(bin);
}

export function findRealAgentBin(name: string, opts: AgentBinSearchOptions = {}): string | null {
  const platform = opts.platform ?? process.platform;
  const separator = platform === "win32" ? ";" : ":";
  const pathDirs = (opts.pathValue ?? process.env.PATH ?? "").split(separator).filter(Boolean);
  const pathApi = platform === "win32" ? win32 : { resolve };
  const normalize = (value: string): string => {
    const normalized = pathApi.resolve(value);
    return platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  const cueShims = normalize(shimDir());
  for (const dir of pathDirs) {
    if (normalize(dir) === cueShims) continue;
    for (const commandName of commandNames(name, platform, opts.pathExt)) {
      // Use the host path implementation for filesystem access. On native
      // Windows `join` already emits backslashes; keeping it here also lets
      // Linux CI exercise win32 command-extension behavior in temp dirs.
      const candidate = join(dir, commandName);
      if (!existsSync(candidate) || !isRunnableFile(candidate, platform)) continue;
      try {
        const stat = statSync(candidate);
        if (stat.size < 64_000) {
          const content = readFileSync(candidate, "utf8");
          if (isCueShimContent(content)) continue;
          // codex-guard is another dispatcher, not the real CLI. Selecting it
          // from inside `cue launch codex` makes the guard find cue's shim next,
          // creating a launch loop. The guard still protects raw shell launches;
          // cue must exec the actual Codex binary behind both wrappers.
          if (name === "codex" && content.includes("find_real_codex") && content.includes("codex-guard")) continue;
        }
        return candidate;
      } catch {
        continue; // unreadable/broken entry — keep walking
      }
    }
  }
  return null;
}

/**
 * An explicit "exec this instead of codex" override, or null when unset.
 *
 * Unlike `$CUE_REAL_CLAUDE` — which the launch path deliberately ignores, so
 * the binary the user's PATH points at is the one that runs — this one IS
 * honored by `cue launch codex`. The point is dispatch, not discovery: it puts
 * a wrapper (oh-my-codex and friends) BEHIND cue's picker, so a bare `codex`
 * still resolves a profile and materializes a runtime before the wrapper takes
 * over. Callers execing the result must sanitize the child env first — see
 * `stripShimDirFromPath` for the loop that otherwise follows.
 */
export function codexExecOverride(): string | null {
  const override = process.env.CUE_REAL_CODEX;
  if (!override) return null;
  // Same bar `findRealAgentBin` holds a PATH candidate to. `existsSync` alone
  // waves through a directory or a non-executable file, and the only symptom is
  // an unexplained exit 127 from `execAgent`'s spawn-error branch.
  return isRunnableFile(override, process.platform) ? override : null;
}

export function findRealClaudeBin(): string | null {
  if (process.env.CUE_REAL_CLAUDE && existsSync(process.env.CUE_REAL_CLAUDE)) {
    return process.env.CUE_REAL_CLAUDE;
  }
  if (process.env.CLAUDE_CODE_EXECPATH && existsSync(process.env.CLAUDE_CODE_EXECPATH)) {
    return process.env.CLAUDE_CODE_EXECPATH;
  }
  return findRealAgentBin("claude");
}
