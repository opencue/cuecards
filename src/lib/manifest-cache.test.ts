import { describe, test, expect } from "bun:test";
import { getCachedManifest } from "./manifest-cache";

// getCachedManifest: CACHE_DIR is module-level and points to
// ~/.config/cue/cache/manifests (or XDG_CONFIG_HOME variant). We cannot
// redirect it at test time, so we only test the cache-miss path, which is
// safe: it checks for a file that won't exist and returns null.
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
});
