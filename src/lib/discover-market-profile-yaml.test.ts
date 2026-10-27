/**
 * Tests for addMcpToProfileSync — the single canonical helper for injecting
 * MCP server IDs into a profile YAML file.  Covers the three structural edge
 * cases that previously diverged across three separate call sites.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addMcpToProfileSync } from "./discover-market-profile-yaml";

let tmp: string;

beforeEach(() => {
  tmp = `${tmpdir()}/cue-profile-yaml-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

function yamlPath(name: string): string {
  return join(tmp, name);
}

function write(name: string, content: string): string {
  const p = yamlPath(name);
  writeFileSync(p, content);
  return p;
}

describe("addMcpToProfileSync", () => {
  test("appends to a populated mcps: list", () => {
    const p = write("populated.yaml", `name: test\nmcps:\n  - existing-mcp\n`);
    const added = addMcpToProfileSync(p, "new-mcp");
    expect(added).toBe(true);
    const out = readFileSync(p, "utf8");
    expect(out).toContain("  - existing-mcp\n  - new-mcp");
  });

  test("converts mcps: [] inline-empty form to block form", () => {
    const p = write("empty-list.yaml", `name: test\nmcps: []\n`);
    const added = addMcpToProfileSync(p, "my-mcp");
    expect(added).toBe(true);
    const out = readFileSync(p, "utf8");
    expect(out).toContain("mcps:\n  - my-mcp");
    expect(out).not.toContain("mcps: []");
  });

  test("adds a new mcps: section when none exists", () => {
    const p = write("no-mcps.yaml", `name: test\nskills:\n  local:\n    - some-skill\n`);
    const added = addMcpToProfileSync(p, "brand-new-mcp");
    expect(added).toBe(true);
    const out = readFileSync(p, "utf8");
    expect(out).toContain("\nmcps:\n  - brand-new-mcp\n");
  });

  test("returns false and does not modify when id already present", () => {
    const content = `name: test\nmcps:\n  - already-here\n`;
    const p = write("already.yaml", content);
    const added = addMcpToProfileSync(p, "already-here");
    expect(added).toBe(false);
    expect(readFileSync(p, "utf8")).toBe(content);
  });
});
