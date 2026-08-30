import { afterEach, describe, test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedProfile } from "../../profiles/_types";
import { __test, getCachedManifest } from "./manifest-cache";

const scratch: string[] = [];

afterEach(() => {
  for (const path of scratch.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

// getCachedManifest: CACHE_DIR is module-level and points to
// ~/.config/cue/cache/manifests (or XDG_CONFIG_HOME variant). We cannot
// redirect it at test time, so persisted-cache coverage stays on the safe
// cache-miss path. Source collection is pure and uses a temporary tree below.
//
// putCachedManifest is not tested here because it would write to the real user
// cache dir (~/.config/cue/cache/manifests/<profile>.json), which is prohibited
// by the hermetic-test rules.

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
