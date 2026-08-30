import { afterEach, beforeEach, describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Both the constant and the function are imported statically. ensureClaudeLogoPath
// calls cacheDir() at function-call time (not at module-load time), so it will pick
// up XDG_CACHE_HOME we set in beforeEach.
import { CLAUDE_LOGO_PNG_BASE64, ensureClaudeLogoPath } from "./claude-logo";

let tmpDir: string;
let priorXdgCache: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cue-logo-test-"));
  priorXdgCache = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = tmpDir;
});

afterEach(() => {
  if (priorXdgCache === undefined) {
    delete process.env.XDG_CACHE_HOME;
  } else {
    process.env.XDG_CACHE_HOME = priorXdgCache;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("CLAUDE_LOGO_PNG_BASE64", () => {
  test("is a non-empty base64 string", () => {
    expect(typeof CLAUDE_LOGO_PNG_BASE64).toBe("string");
    expect(CLAUDE_LOGO_PNG_BASE64.length).toBeGreaterThan(0);
  });

  test("decodes to a valid PNG (correct magic bytes)", () => {
    const bytes = Buffer.from(CLAUDE_LOGO_PNG_BASE64, "base64");
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50); // 'P'
    expect(bytes[2]).toBe(0x4e); // 'N'
    expect(bytes[3]).toBe(0x47); // 'G'
  });
});

describe("ensureClaudeLogoPath", () => {
  test("returns a non-null path inside the configured cache dir", () => {
    const path = ensureClaudeLogoPath();
    expect(path).not.toBeNull();
    expect(path!.startsWith(tmpDir)).toBe(true);
    expect(path!.endsWith("claude-logo.png")).toBe(true);
  });

  test("creates the logo file on disk", () => {
    const path = ensureClaudeLogoPath();
    expect(path).not.toBeNull();
    expect(existsSync(path!)).toBe(true);
  });

  test("second call returns the same path without error (idempotent)", () => {
    const path1 = ensureClaudeLogoPath();
    const path2 = ensureClaudeLogoPath();
    expect(path1).toBe(path2);
  });
});
