/**
 * Profile manifest cache — skip YAML parsing + inheritance resolution on repeat launches.
 *
 * Stores the fully-resolved profile as JSON alongside the mtime of each source
 * profile.yaml in the inheritance chain. On next load, if all mtimes match,
 * we return the cached result directly (< 1ms vs ~15ms for full resolution).
 *
 * Cache location: ~/.config/cue/cache/manifests/<profile>.<profilesDir hash>.json
 *
 * The hash is load-bearing, not decoration. A profile NAME is only unique
 * within one profiles dir, and cue is routinely run against several at once —
 * the install tree plus one checkout per agent worktree, which AGENTS.md makes
 * the default way to work here. Keyed by name alone, the first tree to resolve
 * `ponytail` owns the entry, and every other tree gets a HIT on it: the stored
 * `sources` point at the first tree's files, whose mtimes are unchanged, so the
 * validation loop passes and hands back a profile the caller never asked for.
 * Observed 2026-09-12: edits to a worktree's profile.yaml were silently ignored
 * at launch while `loadProfile` (which skips this cache) returned them fine.
 *
 * Hashing the dir into the filename, rather than comparing it on read, also
 * keeps two trees from evicting each other's entry on every launch.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";

import type { ResolvedProfile } from "../../profiles/_types";

/**
 * Resolved per call, never baked into a module-level const: XDG_CONFIG_HOME is
 * what tests redirect to keep their writes out of the real user cache, and a
 * const would freeze whatever the env held at first import. Same reasoning as
 * `repoRoot()` in repo-root.ts, which documents the bug that pattern caused.
 */
function cacheDir(): string {
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "cue",
    "cache",
    "manifests",
  );
}

/** Cache filename for a (profile, profilesDir) pair. */
function cacheFile(profileName: string, profilesDir: string): string {
  const scope = createHash("sha256").update(profilesDir).digest("hex").slice(0, 12);
  return join(cacheDir(), `${profileName}.${scope}.json`);
}

interface ManifestEntry {
  /** Resolved profile data. */
  profile: ResolvedProfile;
  /** Map of source file path → mtime (ms). */
  sources: Record<string, number>;
  /** Cache format version. */
  version: 2;
}

function collectSources(
  profile: ResolvedProfile,
  profilesDir: string,
): Record<string, number> {
  const sources: Record<string, number> = {};
  const names = new Set<string>();

  // Composite profiles encode each component's resolved chain as a `+`-joined
  // entry (for example `core+backend`). Split both the selector and every
  // chain entry so parent edits invalidate the cached composite manifest.
  for (const value of [profile.name, ...profile.inheritanceChain]) {
    for (const name of value.split("+")) {
      if (name) names.add(name);
    }
  }

  for (const name of names) {
    const path = join(profilesDir, name, "profile.yaml");
    if (existsSync(path)) sources[path] = statSync(path).mtimeMs;
  }
  return sources;
}

/**
 * Try to load a cached manifest for a profile.
 * Returns null if cache miss or stale.
 */
export function getCachedManifest(
  profileName: string,
  profilesDir: string,
): ResolvedProfile | null {
  const cachePath = cacheFile(profileName, profilesDir);
  if (!existsSync(cachePath)) return null;

  try {
    const raw = JSON.parse(readFileSync(cachePath, "utf8")) as ManifestEntry;
    if (raw.version !== 2) return null;

    // An entry with no known sources can never be invalidated: the loop below
    // has nothing to stat, so it passes vacuously and the entry is served
    // forever. `collectSources` only looks under `profilesDir`, while
    // `profileYamlPath` also resolves namespaced `user/repo` profiles to
    // `<XDG>/cue/shared/...` — so every `cue share install` profile records
    // `{}` and pins its first-ever resolution. Reproduced: re-installing an
    // updated shared profile kept serving the old manifest until the cache
    // file was deleted by hand.
    //
    // Treat that as a miss rather than teaching this module a second copy of
    // the loader's path rules. Zero known sources means not safely cacheable,
    // whatever the reason — the cost is one skipped cache hit.
    if (Object.keys(raw.sources).length === 0) return null;

    // Validate all source mtimes still match
    for (const [path, expectedMtime] of Object.entries(raw.sources)) {
      try {
        const st = statSync(path);
        if (st.mtimeMs !== expectedMtime) return null;
      } catch {
        return null; // file removed
      }
    }

    return raw.profile;
  } catch {
    return null;
  }
}

/**
 * Store a resolved profile in the manifest cache.
 */
export function putCachedManifest(
  profile: ResolvedProfile,
  profilesDir: string,
): void {
  const entry: ManifestEntry = {
    profile,
    sources: collectSources(profile, profilesDir),
    version: 2,
  };

  try {
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(cacheFile(profile.name, profilesDir), JSON.stringify(entry));
  } catch { /* non-fatal — cache write failure is fine */ }
}

/** Test-only surface for the pure source collector and the scoped path. */
export const __test = { collectSources, cacheFile };
