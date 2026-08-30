import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

// Duplicated here on purpose: the test's job is to catch a surface drifting away,
// so reading the value from the same place the code reads it would prove nothing.
const DESCRIPTOR =
  "Per-project profile manager for Claude Code, Codex, and 8 other AI coding agents — scopes which skills and MCP servers load, per directory.";

describe("repo-root marketplace manifest", () => {
  test("parses and declares the cuecards marketplace", () => {
    const mkt = JSON.parse(
      readFileSync(join(REPO_ROOT, ".claude-plugin/marketplace.json"), "utf8"),
    );
    expect(mkt.name).toBe("cuecards");
    expect(mkt.owner?.name).toBe("NagyVikt");
    expect(mkt.description).toBe(DESCRIPTOR);
    expect(mkt.metadata?.description).toBe(DESCRIPTOR);
    expect(Array.isArray(mkt.plugins)).toBe(true);
  });

  test("declares exactly one plugin, and its source resolves to a real manifest", () => {
    const mkt = JSON.parse(
      readFileSync(join(REPO_ROOT, ".claude-plugin/marketplace.json"), "utf8"),
    );
    // One plugin on purpose: the 85 profiles are meaningless without the CLI,
    // and 85 dead entries are worse for discovery than one live one.
    expect(mkt.plugins.length).toBe(1);
    const entry = mkt.plugins[0];
    expect(entry.name).toBe("cue");
    expect(entry.description).toBe(DESCRIPTOR);
    // The typo class this catches: `source` pointing at a directory with no
    // manifest, which fails only at install time in a real session.
    const manifest = join(REPO_ROOT, entry.source, ".claude-plugin", "plugin.json");
    expect(existsSync(manifest)).toBe(true);
  });
});
