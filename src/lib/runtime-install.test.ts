import { describe, test, expect } from "bun:test";
import {
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
