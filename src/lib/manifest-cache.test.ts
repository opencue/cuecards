import { afterEach, beforeEach, describe, test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedProfile } from "../../profiles/_types";
import { __test, getCachedManifest, putCachedManifest } from "./manifest-cache";

const scratch: string[] = [];
let priorXdg: string | undefined;

// cacheDir() reads XDG_CONFIG_HOME per call, so pointing it at a tmpdir keeps
// every write in this file out of the real ~/.config/cue/cache/manifests.
beforeEach(() => {
  priorXdg = process.env.XDG_CONFIG_HOME;
  const home = mkdtempSync(join(tmpdir(), "cue-manifest-xdg-"));
  scratch.push(home);
  process.env.XDG_CONFIG_HOME = home;
});

afterEach(() => {
  if (priorXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = priorXdg;
  for (const path of scratch.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

/** A profiles dir holding one `core`-less profile, plus the profile to cache. */
function makeTree(name: string, marker: string): { dir: string; profile: ResolvedProfile } {
  const dir = mkdtempSync(join(tmpdir(), "cue-manifest-tree-"));
  scratch.push(dir);
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "profile.yaml"), `name: ${name}\ndescription: ${marker}\n`);
  return {
    dir,
    profile: {
      name,
      description: marker,
      inheritanceChain: [name],
    } as ResolvedProfile,
  };
}

describe("getCachedManifest", () => {
  test("returns null for a profile that has never been cached", () => {
    // A UUID-style name cannot exist in any real cache.
    const result = getCachedManifest("__test_profile_never_exists_ab12cd__", "/dev/null");
    expect(result).toBeNull();
  });

  test("returns null for an empty profile name", () => {
    const result = getCachedManifest("", "/dev/null");
    expect(result).toBeNull();
  });

  test("does not throw when profilesDir does not exist", () => {
    expect(() =>
      getCachedManifest("some-profile", "/nonexistent/profiles/dir"),
    ).not.toThrow();
  });

  test("the cache dir follows XDG_CONFIG_HOME per call, not at import", () => {
    // Guards the getter itself. Re-`const`ing cacheDir() keeps all 8 other
    // tests passing while every write escapes this file's tmpdir into the
    // developer's real ~/.config/cue/cache/manifests — a silent test leak
    // with nothing to catch it. Assert the redirect actually takes effect.
    // Pin the layout too, not just "somewhere under XDG_CONFIG_HOME": a
    // mutation that kept per-call resolution but dropped the cue/cache/
    // manifests segments — writing manifests straight into ~/.config — passed
    // the looser prefix assertion.
    expect(__test.cacheFile("x", "/d")).toStartWith(
      join(process.env.XDG_CONFIG_HOME!, "cue", "cache", "manifests"),
    );
  });

  test("an entry with no known sources is a miss, not a permanent hit", () => {
    // `collectSources` only looks under profilesDir, but `profileYamlPath`
    // also resolves namespaced `user/repo` profiles to <XDG>/cue/shared/… —
    // so a `cue share install` profile records {} and, with nothing to stat,
    // validates vacuously forever. Reinstalling an updated version kept
    // serving the old manifest until the cache file was deleted by hand.
    const { dir } = makeTree("sourceless", "v1");
    // Neither the name nor the chain resolves to a profile.yaml under `dir` —
    // the shape `cue share install` produces, where the YAML lives under
    // <XDG>/cue/shared/ instead. Kept a flat slug so the cache file itself
    // writes fine: the point is the empty `sources`, not a failed write.
    const orphan = {
      name: "installed-elsewhere",
      description: "v1",
      inheritanceChain: ["installed-elsewhere"],
    } as ResolvedProfile;
    putCachedManifest(orphan, dir);

    expect(__test.collectSources(orphan, dir)).toEqual({});
    // The entry IS on disk — proving this is the fail-safe rejecting it, not
    // a plain cache miss.
    expect(existsSync(__test.cacheFile("installed-elsewhere", dir))).toBe(true);
    expect(getCachedManifest("installed-elsewhere", dir)).toBeNull();
  });

  test("round-trips a profile through the cache", () => {
    const { dir, profile } = makeTree("solo", "original");
    putCachedManifest(profile, dir);
    expect(getCachedManifest("solo", dir)).toEqual(profile);
  });

  test("misses once a source profile.yaml changes", () => {
    const { dir, profile } = makeTree("touched", "original");
    putCachedManifest(profile, dir);
    expect(getCachedManifest("touched", dir)).not.toBeNull();

    // mtime, not content, is what the cache validates.
    const future = new Date(Date.now() + 10_000);
    utimesSync(join(dir, "touched", "profile.yaml"), future, future);
    expect(getCachedManifest("touched", dir)).toBeNull();
  });

  test("same profile name in two profiles dirs does not collide", () => {
    // The regression this file exists for. Keyed by name alone, the second
    // tree HITS the first tree's entry: the stored sources point at the first
    // tree's files, whose mtimes never changed, so validation passes and the
    // caller silently gets the other tree's profile. That is what made edits
    // to a worktree's profile.yaml vanish at launch (observed 2026-09-12).
    const installed = makeTree("ponytail", "from-install-tree");
    const worktree = makeTree("ponytail", "from-agent-worktree");

    putCachedManifest(installed.profile, installed.dir);
    putCachedManifest(worktree.profile, worktree.dir);

    expect(getCachedManifest("ponytail", installed.dir)?.description)
      .toBe("from-install-tree");
    expect(getCachedManifest("ponytail", worktree.dir)?.description)
      .toBe("from-agent-worktree");
    // Neither tree evicted the other, so both stay warm across launches.
    expect(__test.cacheFile("ponytail", installed.dir))
      .not.toBe(__test.cacheFile("ponytail", worktree.dir));
  });

  test("a cache entry written by one tree is never served to another", () => {
    // Tighter than the test above: the second tree has NO entry of its own, so
    // a name-keyed cache would fall straight through to the first tree's.
    const installed = makeTree("shared-name", "from-install-tree");
    const worktree = makeTree("shared-name", "from-agent-worktree");

    putCachedManifest(installed.profile, installed.dir);

    expect(getCachedManifest("shared-name", worktree.dir)).toBeNull();
  });

  test("tracks every underlying profile source for a composite", () => {
    const profilesDir = mkdtempSync(join(tmpdir(), "cue-manifest-sources-"));
    scratch.push(profilesDir);
    for (const name of ["core", "backend", "backend-base", "python"]) {
      const dir = join(profilesDir, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "profile.yaml"), `name: ${name}\n`);
    }

    const profile = {
      name: "backend+python",
      inheritanceChain: ["core+backend", "core+backend-base+python"],
    } as ResolvedProfile;

    expect(Object.keys(__test.collectSources(profile, profilesDir)).sort()).toEqual([
      join(profilesDir, "backend", "profile.yaml"),
      join(profilesDir, "backend-base", "profile.yaml"),
      join(profilesDir, "core", "profile.yaml"),
      join(profilesDir, "python", "profile.yaml"),
    ].sort());
  });
});
