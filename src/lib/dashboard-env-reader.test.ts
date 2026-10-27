/**
 * Tests for dashboard-env-reader: loadEnvFolderDefs fallback behaviour.
 *
 * Covers the two code paths:
 *   1. A valid ~/.config/cue/env-folders.json exists → its entries are used.
 *   2. The file is absent (or invalid) → DEFAULT_ENV_FOLDER_DEFS filtered to
 *      directories that actually exist on disk.
 *
 * All fs I/O is injected via LoadEnvFolderDefsOpts so no real filesystem
 * state affects the outcome.
 */

import { describe, expect, test } from "bun:test";
import {
  loadEnvFolderDefs,
  DEFAULT_ENV_FOLDER_DEFS,
  expandHome,
  classifyEnvVar,
  maskSecretValue,
  parseEnvText,
} from "./dashboard-env-reader";

// ---------------------------------------------------------------------------
// loadEnvFolderDefs — config file present
// ---------------------------------------------------------------------------

describe("loadEnvFolderDefs — config file present", () => {
  test("returns the entries from the config file verbatim", () => {
    const entries = [
      { path: "~/custom/alpha", tag: "alpha" },
      { path: "~/custom/beta", tag: "beta" },
    ];
    const cfgJson = JSON.stringify(entries);
    const cfgPath = "/fake/config/env-folders.json";

    const result = loadEnvFolderDefs({
      configDirOverride: "/fake/config",
      existsFn: (p) => p === cfgPath,
      readFn: (p) => {
        if (p === cfgPath) return cfgJson;
        throw new Error(`unexpected read: ${p}`);
      },
    });

    expect(result).toEqual(entries);
  });

  test("ignores on-disk directory existence when config file is used", () => {
    // existsFn says the config file exists but NO directory exists — result
    // should still be the file's entries, not an empty defaults list.
    const entries = [{ path: "~/does/not/exist", tag: "ghost" }];
    const cfgPath = "/fake/config/env-folders.json";

    const result = loadEnvFolderDefs({
      configDirOverride: "/fake/config",
      existsFn: (p) => p === cfgPath,   // only the cfg file "exists"
      readFn: () => JSON.stringify(entries),
    });

    expect(result).toEqual(entries);
  });

  test("falls through to defaults when config file content is not a valid array", () => {
    // existsFn says the config file exists but the content is invalid JSON
    const cfgPath = "/fake/config/env-folders.json";
    // Simulate: only "~/Documents/cue" exists on disk
    const existingDir = expandHome("~/Documents/cue");

    const result = loadEnvFolderDefs({
      configDirOverride: "/fake/config",
      existsFn: (p) => p === cfgPath || p === existingDir,
      readFn: () => "not-valid-json{{{",
    });

    // Should fall back to defaults filtered by existence
    expect(result.length).toBe(1);
    expect(result[0]!.tag).toBe("cue");
  });

  test("falls through to defaults when config array entries have wrong shape", () => {
    const cfgPath = "/fake/config/env-folders.json";
    const existingDir = expandHome("~/Documents/gitguardex");

    const result = loadEnvFolderDefs({
      configDirOverride: "/fake/config",
      existsFn: (p) => p === cfgPath || p === existingDir,
      // Valid JSON array but entries are missing the required fields
      readFn: () => JSON.stringify([{ name: "wrong", location: "/tmp" }]),
    });

    expect(result.length).toBe(1);
    expect(result[0]!.tag).toBe("gitguardex");
  });
});

// ---------------------------------------------------------------------------
// loadEnvFolderDefs — config file absent → filtered defaults
// ---------------------------------------------------------------------------

describe("loadEnvFolderDefs — config file absent", () => {
  test("returns all 6 defaults when every default directory exists", () => {
    const allDirs = new Set(DEFAULT_ENV_FOLDER_DEFS.map((f) => expandHome(f.path)));

    const result = loadEnvFolderDefs({
      configDirOverride: "/fake/config",   // no env-folders.json here
      existsFn: (p) => allDirs.has(p),     // cfg file → false; all dirs → true
    });

    expect(result).toEqual(DEFAULT_ENV_FOLDER_DEFS);
  });

  test("returns an empty list when no default directory exists", () => {
    const result = loadEnvFolderDefs({
      configDirOverride: "/fake/config",
      existsFn: () => false,               // nothing exists
    });

    expect(result).toEqual([]);
  });

  test("returns only the defaults whose directories exist", () => {
    // Simulate: only cue and gitguardex are present on this machine
    const present = new Set([
      expandHome("~/Documents/cue"),
      expandHome("~/Documents/gitguardex"),
    ]);

    const result = loadEnvFolderDefs({
      configDirOverride: "/fake/config",
      existsFn: (p) => present.has(p),
    });

    expect(result).toHaveLength(2);
    expect(result.map((f) => f.tag)).toEqual(["cue", "gitguardex"]);
  });

  test("preserves original order of the 6 defaults", () => {
    // All directories "exist" — order must match DEFAULT_ENV_FOLDER_DEFS
    const allDirs = new Set(DEFAULT_ENV_FOLDER_DEFS.map((f) => expandHome(f.path)));

    const result = loadEnvFolderDefs({
      configDirOverride: "/fake/config",
      existsFn: (p) => allDirs.has(p),
    });

    const tags = result.map((f) => f.tag);
    expect(tags).toEqual(["cue", "authmux", "x-growth-bot", "medusa", "marva", "gitguardex"]);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_ENV_FOLDER_DEFS — shape guard
// ---------------------------------------------------------------------------

describe("DEFAULT_ENV_FOLDER_DEFS", () => {
  test("contains exactly 6 entries", () => {
    expect(DEFAULT_ENV_FOLDER_DEFS).toHaveLength(6);
  });

  test("every entry has a non-empty path and tag", () => {
    for (const entry of DEFAULT_ENV_FOLDER_DEFS) {
      expect(entry.path.length).toBeGreaterThan(0);
      expect(entry.tag.length).toBeGreaterThan(0);
    }
  });

  test("includes the expected project tags", () => {
    const tags = DEFAULT_ENV_FOLDER_DEFS.map((f) => f.tag);
    expect(tags).toContain("cue");
    expect(tags).toContain("authmux");
    expect(tags).toContain("x-growth-bot");
    expect(tags).toContain("medusa");
    expect(tags).toContain("marva");
    expect(tags).toContain("gitguardex");
  });
});

// ---------------------------------------------------------------------------
// classifyEnvVar (smoke tests — pure function, no fs needed)
// ---------------------------------------------------------------------------

describe("classifyEnvVar", () => {
  test("classifies secret keys", () => {
    expect(classifyEnvVar("API_KEY", "abc")).toBe("secret");
    expect(classifyEnvVar("DB_PASSWORD", "pass")).toBe("secret");
    expect(classifyEnvVar("DATABASE_URL", "postgres://...")).toBe("secret");
  });

  test("classifies URL values", () => {
    expect(classifyEnvVar("BACKEND_URL", "https://example.com")).toBe("url");
    expect(classifyEnvVar("BASE_URL", "http://localhost:3000")).toBe("url");
  });

  test("classifies booleans", () => {
    expect(classifyEnvVar("FEATURE_FLAG", "true")).toBe("bool");
    expect(classifyEnvVar("ENABLED", "false")).toBe("bool");
  });

  test("classifies plain numbers", () => {
    expect(classifyEnvVar("PORT", "3000")).toBe("num");
  });

  test("classifies plain strings", () => {
    expect(classifyEnvVar("APP_NAME", "my-app")).toBe("plain");
  });
});

// ---------------------------------------------------------------------------
// maskSecretValue (smoke tests)
// ---------------------------------------------------------------------------

describe("maskSecretValue", () => {
  test("fully masks very short values", () => {
    expect(maskSecretValue("abc")).toBe("•••");
    expect(maskSecretValue("12345678")).toBe("••••••••");
  });

  test("keeps first and last 3 chars for longer values", () => {
    const result = maskSecretValue("abcDEFGHIJKLxyz");
    expect(result.startsWith("abc")).toBe(true);
    expect(result.endsWith("xyz")).toBe(true);
    expect(result).toContain("•");
  });
});

// ---------------------------------------------------------------------------
// parseEnvText (smoke tests)
// ---------------------------------------------------------------------------

describe("parseEnvText", () => {
  const sample = [
    "# comment",
    "APP_NAME=my-app",
    'DB_URL="postgres://host/db"',
    "SECRET_KEY=super-secret-value-12345",
    "PORT=3000",
    "ENABLED=true",
  ].join("\n");

  test("skips comments and blank lines", () => {
    const rows = parseEnvText(sample, "");
    expect(rows.find((r) => r.key === "#")).toBeUndefined();
    expect(rows.find((r) => r.key === "comment")).toBeUndefined();
  });

  test("strips surrounding quotes", () => {
    const rows = parseEnvText(sample, "");
    const url = rows.find((r) => r.key === "DB_URL");
    expect(url).toBeDefined();
    expect(url!.value).toBe("postgres://host/db");
  });

  test("masks secret values by default", () => {
    const rows = parseEnvText(sample, "");
    const secret = rows.find((r) => r.key === "SECRET_KEY");
    expect(secret).toBeDefined();
    expect(secret!.masked).toBe(true);
    expect(secret!.value).not.toBe("super-secret-value-12345");
  });

  test("reveals a named secret key when requested", () => {
    const rows = parseEnvText(sample, "SECRET_KEY");
    const secret = rows.find((r) => r.key === "SECRET_KEY");
    expect(secret!.masked).toBe(false);
    expect(secret!.value).toBe("super-secret-value-12345");
  });

  test("reveals all secrets with wildcard", () => {
    const rows = parseEnvText(sample, "*");
    for (const row of rows.filter((r) => r.kind === "secret")) {
      expect(row.masked).toBe(false);
    }
  });
});
