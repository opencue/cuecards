/**
 * Tests for the permissions reader — the pure parser + merger behind the
 * studio Permissions page. No disk / env touched: every case feeds raw blocks.
 */

import { describe, expect, test } from "bun:test";

import { parseRuleString, buildPermissions } from "./permissions";

describe("parseRuleString", () => {
  test("splits a tool(pattern) rule", () => {
    expect(parseRuleString("Bash(git *)")).toEqual({ tool: "Bash", pattern: "git *" });
  });

  test("handles patterns that themselves contain parens", () => {
    expect(parseRuleString("Bash(echo (hi))")).toEqual({ tool: "Bash", pattern: "echo (hi)" });
  });

  test("treats a bare rule (no parens) as a tool with an empty pattern", () => {
    expect(parseRuleString("mcp__codegraph__codegraph_search")).toEqual({
      tool: "mcp__codegraph__codegraph_search",
      pattern: "",
    });
  });

  test("trims surrounding whitespace", () => {
    expect(parseRuleString("  Read( ~/.ssh/** ) ")).toEqual({ tool: "Read", pattern: "~/.ssh/**" });
  });
});

describe("buildPermissions", () => {
  test("groups by mode and counts each bucket", () => {
    const { rules, counts } = buildPermissions([
      { label: "user", perms: { allow: ["Read(**)", "Bash(git *)"], ask: ["Bash(rm *)"], deny: ["Bash(sudo *)"] } },
    ]);
    expect(counts).toEqual({ allow: 2, ask: 1, deny: 1 });
    expect(rules.find((r) => r.tool === "Bash" && r.pattern === "git *")!.mode).toBe("allow");
    expect(rules.every((r) => r.sources.length === 1 && r.sources[0] === "user")).toBe(true);
  });

  test("dedupes a rule that appears in two files and merges its sources", () => {
    const { rules, counts } = buildPermissions([
      { label: "project", perms: { allow: ["Read(**)"] } },
      { label: "user", perms: { allow: ["Read(**)"] } },
    ]);
    expect(counts.allow).toBe(1);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.sources).toEqual(["project", "user"]);
  });

  test("the first-seen defaultMode wins (precedence order)", () => {
    const { defaultMode } = buildPermissions([
      { label: "project", perms: { defaultMode: "acceptEdits" } },
      { label: "user", perms: { defaultMode: "auto" } },
    ]);
    expect(defaultMode).toBe("acceptEdits");
  });

  test("ignores null blocks and non-string / empty entries", () => {
    const { rules, counts } = buildPermissions([
      { label: "managed", perms: null },
      { label: "user", perms: { allow: ["", "  ", "Edit(src/**)"] } },
    ]);
    expect(counts.allow).toBe(1);
    expect(rules[0]!.tool).toBe("Edit");
  });

  test("a tool with allow in one file and deny in another keeps both as distinct rules", () => {
    const { rules, counts } = buildPermissions([
      { label: "project", perms: { deny: ["Read(.env)"] } },
      { label: "user", perms: { allow: ["Read(.env)"] } },
    ]);
    expect(counts).toEqual({ allow: 1, ask: 0, deny: 1 });
    expect(rules).toHaveLength(2);
  });
});
