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
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

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
export function findRealAgentBin(name: string): string | null {
  const pathDirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  const cueShims = resolve(shimDir());
  for (const dir of pathDirs) {
    if (resolve(dir) === cueShims) continue;
    const candidate = join(dir, name);
    if (!existsSync(candidate)) continue;
    try {
      const stat = statSync(candidate);
      if (!stat.isFile() || (stat.mode & 0o111) === 0) continue;
      if (stat.size < 500 && isCueShimContent(readFileSync(candidate, "utf8"))) continue;
      return candidate;
    } catch {
      continue; // unreadable/broken entry — keep walking
    }
  }
  return null;
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
