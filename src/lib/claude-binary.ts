/**
 * Locate the real agent binary (`claude` / `codex`) on PATH, skipping cue's shim.
 *
 * cue installs ~/.local/bin/claude as a bash one-liner that calls `cue launch
 * claude`; shelling to that from within cue would recurse or trigger the picker.
 * The shim is detected by CONTENT (a small script containing `cue launch`), not
 * by directory: the native Claude installer also lives in ~/.local/bin, and the
 * npm package no longer ships a `claude` bin — so skipping that whole directory
 * would skip the only real binary on the machine.
 *
 * Lookup order for claude:
 *   1. $CUE_REAL_CLAUDE (explicit override)
 *   2. $CLAUDE_CODE_EXECPATH (set by claude-code itself on subprocesses)
 *   3. Walk $PATH, skipping any small shim that contains `cue launch`.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Walk $PATH for an executable named `name`, skipping cue's own shims.
 * A shim is any file under 500 bytes whose content matches `cue launch`;
 * everything else (including symlinks into the native install under
 * ~/.local/share/claude) is the real binary.
 */
export function findRealAgentBin(name: string): string | null {
  const pathDirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = join(dir, name);
    if (!existsSync(candidate)) continue;
    try {
      const stat = statSync(candidate);
      if (!stat.isFile() || (stat.mode & 0o111) === 0) continue;
      if (stat.size < 500) {
        const content = readFileSync(candidate, "utf8");
        if (/cue\s+launch/i.test(content)) continue;
      }
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
