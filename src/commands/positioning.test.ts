import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

/**
 * The two canonical strings. These are duplicated here on purpose: the test's
 * job is to catch a surface drifting away from docs/marketing/positioning.md,
 * so reading the value from the same place the code reads it would prove
 * nothing.
 */
export const CLAIM =
  "Your agent reads every skill you own, on every message. cue loads only the ones that project needs.";
export const DESCRIPTOR =
  "Per-project profile manager for Claude Code, Codex, and 8 other AI coding agents — scopes which skills and MCP servers load, per directory.";

describe("canonical positioning", () => {
  test("positioning.md carries both strings verbatim", () => {
    const md = readFileSync(join(REPO_ROOT, "docs/marketing/positioning.md"), "utf8");
    expect(md).toContain(CLAIM);
    expect(md).toContain(DESCRIPTOR);
  });

  test("package.json description is the descriptor", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    expect(pkg.description).toBe(DESCRIPTOR);
  });

  test("plugin manifest is at the path Claude Code reads, with the descriptor", () => {
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, "plugins/cue/.claude-plugin/plugin.json"), "utf8"),
    );
    expect(manifest.description).toBe(DESCRIPTOR);
    expect(manifest.name).toBe("cue");
    // Discovery metadata — these feed `/plugin search`, which is the entire
    // point of packaging the plugin.
    expect(manifest.homepage).toBe("https://github.com/opencue/cuecards");
    expect(manifest.repository).toBe("https://github.com/opencue/cuecards");
    expect(manifest.license).toBe("MIT");
    expect(Array.isArray(manifest.keywords)).toBe(true);
    expect(manifest.keywords.length).toBeGreaterThan(0);
    // No working plugin on disk declares commands[]; they come from commands/.
    expect(manifest.commands).toBeUndefined();
  });
});
