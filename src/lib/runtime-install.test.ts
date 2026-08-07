import { describe, test, expect } from "bun:test";
import {
  isCueRuntimeDir,
  isRuntimeAgent,
  runtimeAgentSubdir,
  runtimeDirFor,
  RUNTIME_AGENTS,
} from "./runtime-install";

describe("RUNTIME_AGENTS", () => {
  test("contains claude-code", () => {
    expect(RUNTIME_AGENTS).toContain("claude-code");
  });

  test("contains codex", () => {
    expect(RUNTIME_AGENTS).toContain("codex");
  });

  test("has exactly two entries", () => {
    expect(RUNTIME_AGENTS).toHaveLength(2);
  });
});

describe("isRuntimeAgent", () => {
  test("true for claude-code", () => {
    expect(isRuntimeAgent("claude-code")).toBe(true);
  });

  test("true for codex", () => {
    expect(isRuntimeAgent("codex")).toBe(true);
  });

  test("false for arbitrary string", () => {
    expect(isRuntimeAgent("cursor")).toBe(false);
  });

  test("false for empty string", () => {
    expect(isRuntimeAgent("")).toBe(false);
  });

  test("false for partial match", () => {
    expect(isRuntimeAgent("claude")).toBe(false);
  });
});

describe("runtimeAgentSubdir", () => {
  test("claude-code maps to claude", () => {
    expect(runtimeAgentSubdir("claude-code")).toBe("claude");
  });

  test("codex maps to codex", () => {
    expect(runtimeAgentSubdir("codex")).toBe("codex");
  });
});

describe("runtimeDirFor", () => {
  test("combines runtimeRoot, profileName, and agent subdir", () => {
    const result = runtimeDirFor("core", "claude-code", "/tmp/runtime");
    expect(result).toBe("/tmp/runtime/core/claude");
  });

  test("codex uses codex subdir", () => {
    const result = runtimeDirFor("core", "codex", "/tmp/runtime");
    expect(result).toBe("/tmp/runtime/core/codex");
  });

  test("composite selector name preserved verbatim in path", () => {
    const result = runtimeDirFor("core+skill-writer", "claude-code", "/tmp/runtime");
    expect(result).toBe("/tmp/runtime/core+skill-writer/claude");
  });
});

describe("isCueRuntimeDir", () => {
  const root = "/tmp/cfg/runtime";

  test("true for a materialized profile runtime — what a nested launch inherits", () => {
    expect(isCueRuntimeDir(runtimeDirFor("core", "claude-code", root), root)).toBe(true);
  });

  test("true for the runtime root itself", () => {
    expect(isCueRuntimeDir(root, root)).toBe(true);
  });

  test("true for a codex runtime", () => {
    expect(isCueRuntimeDir(runtimeDirFor("core", "codex", root), root)).toBe(true);
  });

  test("false for ~/.claude", () => {
    expect(isCueRuntimeDir("/home/u/.claude", root)).toBe(false);
  });

  test("false for an authmux per-account config dir", () => {
    expect(isCueRuntimeDir("/home/u/.claude-account2", root)).toBe(false);
  });

  // A path prefix is not a path component: `/tmp/cfg/runtime-backup` is a
  // sibling of the runtime root, not inside it, and must stay usable as a
  // credentials source.
  test("false for a sibling whose name merely starts with the root", () => {
    expect(isCueRuntimeDir("/tmp/cfg/runtime-backup/claude", root)).toBe(false);
  });

  test("normalizes traversal before comparing", () => {
    expect(isCueRuntimeDir("/tmp/cfg/runtime/core/../core/claude", root)).toBe(true);
    expect(isCueRuntimeDir("/tmp/cfg/runtime/../.claude", root)).toBe(false);
  });

  test("tolerates a trailing separator on either side", () => {
    expect(isCueRuntimeDir("/tmp/cfg/runtime/core/claude/", root)).toBe(true);
    expect(isCueRuntimeDir("/tmp/cfg/runtime/core/claude", `${root}/`)).toBe(true);
  });
});
