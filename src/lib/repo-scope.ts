/**
 * Repo scoping — "was this history row recorded in the repository I'm standing
 * in?"
 *
 * Both suggestion sources store the raw cwd of a launch: combo history writes
 * it per confirmed stack, the session log per session. Suggestions are
 * per-repo, so both need the same answer to that question — keeping it in one
 * place is what stops `combo-history` and `pair-suggestions` from drifting into
 * two subtly different notions of "here".
 *
 * Not to be confused with `lib/repo-root`, which locates the *cue install*.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Resolve a directory to its repository root, or `undefined` if it's not in one. */
export type RepoRootResolver = (dir: string) => string | undefined;

/** Options accepted by every per-repo history reader. */
export interface RepoScopeOptions {
  /**
   * Scope to this directory. Rows recorded anywhere in the same repository
   * match — so a launch deep in `packages/api` still sees what was confirmed at
   * the repo root, and vice versa. For paths outside any repository, rows
   * recorded at or beneath `cwd` match instead.
   */
  cwd?: string;
  /** Root resolution, injectable so tests stay off the real filesystem. */
  repoRootOf?: RepoRootResolver;
}

/**
 * Nearest ancestor directory containing `.git` — a directory for a normal
 * clone, a file for a worktree or submodule. `undefined` when the path isn't
 * inside a repository.
 */
export function findRepoRoot(dir: string): string | undefined {
  let current = dir;
  // `dirname("/") === "/"`, so this terminates at the filesystem root.
  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** True when `candidate` is `base` or lives beneath it. Never matches a sibling
 *  that merely shares a name prefix (`api-legacy` vs `api`). */
export function isWithin(candidate: string, base: string): boolean {
  return candidate === base || candidate.startsWith(`${base}/`);
}

/**
 * Build the "does this row belong here?" predicate for a scope, or `undefined`
 * when no scope was requested (the caller should then count every row).
 *
 * A row with no recorded directory never matches: history written before cwd
 * was tracked is genuinely unattributable, and guessing would hand one repo's
 * habits to another. Root lookups are memoized for the life of the predicate,
 * since a log repeats the same handful of directories.
 */
export function repoScopeMatcher(
  opts: RepoScopeOptions,
): ((rowCwd: string | undefined) => boolean) | undefined {
  const scope = opts.cwd;
  if (scope === undefined) return undefined;
  const resolve = opts.repoRootOf ?? findRepoRoot;
  const cache = new Map<string, string | undefined>();
  const rootOf = (dir: string): string | undefined => {
    if (!cache.has(dir)) cache.set(dir, resolve(dir));
    return cache.get(dir);
  };
  const scopeRoot = rootOf(scope);
  return (rowCwd) => {
    if (rowCwd === undefined) return false;
    if (scopeRoot !== undefined && rootOf(rowCwd) === scopeRoot) return true;
    return isWithin(rowCwd, scope);
  };
}
