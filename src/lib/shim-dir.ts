/**
 * Layout of cue's own shim directory — the single source of truth for where
 * the `claude` / `codex` shims live and how a shell is told to find them.
 *
 * cue used to write its shims to `~/.local/bin/<agent>`. That path is owned by
 * the native Claude Code installer, which points it at
 * `~/.local/share/claude/versions/<version>` and rewrites it on every update.
 * On a native-install machine it is frequently the ONLY `claude` on PATH, so
 * cue writing there overwrote the real binary — leaving `findRealAgentBin()`
 * with nothing to exec — and any Claude update silently removed the shim again.
 *
 * Giving cue its own directory ends the contention: cue owns
 * `<configDir>/shims`, the installer keeps owning `~/.local/bin`, and the shim
 * simply shadows the real binary by sitting earlier on PATH. Uninstall becomes
 * a plain delete with nothing to restore.
 *
 * Everything here is pure path/string math. The caller does the I/O, which
 * keeps this module trivially testable and keeps the fs-touching decisions
 * (what to overwrite, what to prompt for) in `commands/shell.ts`.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { configDir } from "./config-paths";

export const SHIM_AGENTS = ["claude", "codex"] as const;
export type ShimAgent = (typeof SHIM_AGENTS)[number];
export type ShimShell = "bash" | "zsh" | "fish";

/** Marker that proves cue wrote a fish drop-in. Uninstall removes the file
 * only when this is present, so a hand-written file of the same name survives. */
export const FISH_DROPIN_MARKER = "# managed by `cue shell install`";

/**
 * cue's shim dir: `<configDir>/shims`, i.e. `~/.config/cue/shims` (or under
 * `$XDG_CONFIG_HOME`).
 *
 * `homeDir` is a test-injection escape hatch: when given it wins over
 * `$XDG_CONFIG_HOME`, matching how `shimInstalled()` and `runInstall()` already
 * accept a fake home. Production callers pass nothing.
 */
export function shimDir(homeDir?: string): string {
  return homeDir ? join(homeDir, ".config", "cue", "shims") : join(configDir(), "shims");
}

/** Path of the fish drop-in that puts {@link shimDir} on PATH. */
export function fishDropInPath(homeDir?: string): string {
  return join(homeDir ?? homedir(), ".config", "fish", "conf.d", "cue-shims.fish");
}

/**
 * The shim body. Keeps the literal `launch <agent>` substring that
 * `isCueShimContent()` and `findRealAgentBin()` both match on, for both the
 * bare-`cue` and quoted-absolute-path forms of `cueInvoke`.
 */
export function shimContent(cueInvoke: string, agent: ShimAgent): string {
  return `#!/usr/bin/env bash\nexec ${cueInvoke} launch ${agent} "$@"\n`;
}

/**
 * True when `content` is a cue shim. Matches both invocation forms
 * (`exec cue launch claude` and `exec "/abs/path/cue" launch claude`).
 * Pass `agent` to require a specific one.
 *
 * Deliberately content-based, never directory-based: the native installer's
 * real binary lives in a directory cue also writes to during migration, so a
 * wholesale directory skip could delete or ignore the real thing.
 */
export function isCueShimContent(content: string, agent?: ShimAgent): boolean {
  const re = agent ? new RegExp(`launch\\s+${agent}\\b`) : /launch\s+(claude|codex)\b/;
  return /cue/i.test(content) && re.test(content);
}

/**
 * The single line that puts {@link shimDir} at the FRONT of PATH.
 *
 * fish gets `fish_add_path -g -p`: `-g` because a conf.d snippet re-runs every
 * session (a universal variable would accumulate duplicates instead), `-p` to
 * pin it ahead of the real binaries rather than after them.
 */
export function rcSnippet(shell: ShimShell, dir: string): string {
  if (shell === "fish") return `fish_add_path -g -p ${dir}`;
  return `export PATH="${dir}:$PATH"`;
}

/** Full contents of the fish conf.d drop-in. */
export function fishDropIn(dir: string): string {
  return [
    "# cue: put cue's agent shims (claude/codex) ahead of the real binaries.",
    FISH_DROPIN_MARKER,
    "# Delete this file to deactivate profile loading for bare `claude`/`codex`.",
    rcSnippet("fish", dir),
    "",
  ].join("\n");
}

export type ShimPosition = "before" | "after" | "absent";

/**
 * Where {@link shimDir} sits relative to the real binary on PATH.
 *
 * - `absent` — the shim dir isn't on PATH at all, so the shim is inert.
 * - `after`  — the real binary's dir comes first and shadows the shim.
 * - `before` — healthy. Also returned when the real binary's dir isn't on PATH
 *   (nothing can shadow the shim) or `realBin` is unknown.
 */
export function shimDirPosition(
  pathDirs: readonly string[],
  realBin: string | null | undefined,
  dir: string,
): ShimPosition {
  const dirs = pathDirs.map((d) => resolve(d));
  const shimIdx = dirs.indexOf(resolve(dir));
  if (shimIdx < 0) return "absent";
  if (!realBin) return "before";
  const realIdx = dirs.indexOf(resolve(realBin, ".."));
  if (realIdx < 0) return "before";
  return realIdx < shimIdx ? "after" : "before";
}
