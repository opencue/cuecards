/**
 * Lazy repo-root + profiles-dir resolution.
 *
 * These are GETTERS, not module-level `const`s, on purpose. The cue shell shim
 * exports CUE_REPO_ROOT / SOUL_REPO_ROOT / CUE_PROFILES_DIR per session, and
 * resolution must reflect the env at CALL time, not whatever was set at first
 * import. Baking these into a `const` is the bug that made `bun test` from a
 * worktree validate against the installed tree's working copy instead of the
 * code under test (see test/preload.ts for the suite-wide mitigation).
 *
 * Only the env reads are lazy. The location fallback is import-time constant —
 * this file never moves at runtime — and reads no env, so it is safe to bake.
 * Do NOT memoize the getters, or in-process env overrides stop taking effect;
 * the work is a couple of `??` and a path join, which is negligible.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** src/lib/repo-root.ts → walk up two levels to the repo root. Env-free. */
const FALLBACK_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Repo root: env override first, else the import-time fallback. */
export function repoRoot(): string {
  return process.env.CUE_REPO_ROOT ?? process.env.SOUL_REPO_ROOT ?? FALLBACK_REPO_ROOT;
}

/**
 * Profiles data dir: CUE_PROFILES_DIR / SOUL_PROFILES_DIR override, else
 * `<repoRoot>/profiles`. The schema file does NOT move with this — it is the
 * canonical contract at `<repoRoot>/profiles/schema.json`.
 */
export function profilesDir(): string {
  return (
    process.env.CUE_PROFILES_DIR ??
    process.env.SOUL_PROFILES_DIR ??
    join(repoRoot(), "profiles")
  );
}
