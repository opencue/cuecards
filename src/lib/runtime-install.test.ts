import { describe, test, expect, afterEach } from "bun:test";
import {
  isRuntimeAgent,
  isSelfOverlaySource,
  pickClaudeCredentialsSource,
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

describe("isSelfOverlaySource", () => {
  const root = "/tmp/cfg/runtime";
  const target = runtimeDirFor("core", "claude-code", root);

  test("true when the source is the dir this launch will write", () => {
    expect(isSelfOverlaySource(target, target)).toBe(true);
  });

  // The authmux case the exact-path test exists to protect: the inherited
  // source carries the account tag, the dir being written does not, so the
  // overlay must go ahead and carry account2's credentials into the child.
  test("false for another profile's runtime under the same root", () => {
    expect(isSelfOverlaySource(runtimeDirFor("core@account2", "claude-code", root), target)).toBe(false);
  });

  test("false for ~/.claude and for an authmux per-account dir", () => {
    expect(isSelfOverlaySource("/home/u/.claude", target)).toBe(false);
    expect(isSelfOverlaySource("/home/u/.claude-account2", target)).toBe(false);
  });

  test("false when the caller does not know its runtime dir", () => {
    expect(isSelfOverlaySource(target, undefined)).toBe(false);
  });

  test("normalizes traversal and a trailing separator before comparing", () => {
    expect(isSelfOverlaySource("/tmp/cfg/runtime/core/../core/claude", target)).toBe(true);
    expect(isSelfOverlaySource(`${target}/`, target)).toBe(true);
  });

  // A path prefix is not a path component.
  test("false for a sibling whose name merely starts with the target", () => {
    expect(isSelfOverlaySource(`${target}-backup`, target)).toBe(false);
  });
});

// The wiring, not just the predicate: deleting the guard in
// pickClaudeCredentialsSource has to fail something.
describe("pickClaudeCredentialsSource", () => {
  const root = "/tmp/cfg/runtime";
  const target = runtimeDirFor("core", "claude-code", root);
  const original = process.env.CLAUDE_CONFIG_DIR;

  afterEach(() => {
    if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = original;
  });

  // Asserted as "not the target" rather than a concrete path: which fall-through
  // branch wins (~/.claude, or an authmux profile) depends on the machine, but
  // none of them can return `target` — only the rejected `CLAUDE_CONFIG_DIR`
  // early-return could. `os.homedir()` reads the passwd entry, not $HOME, so
  // there is no cheap way to pin the branch without a test-only injection point.
  test("refuses CLAUDE_CONFIG_DIR when it is the dir being rebuilt", async () => {
    process.env.CLAUDE_CONFIG_DIR = target;
    expect(await pickClaudeCredentialsSource({ runtimeDir: target })).not.toBe(target);
  });

  test("keeps an authmux per-account CLAUDE_CONFIG_DIR", async () => {
    process.env.CLAUDE_CONFIG_DIR = "/home/u/.claude-account2";
    expect(await pickClaudeCredentialsSource({ runtimeDir: target })).toBe("/home/u/.claude-account2");
  });

  // A nested launch under account2 inherits account2's RUNTIME dir while this
  // launch writes the untagged one. Rejecting that would hand the child
  // account1's token — the regression this narrowing undoes.
  test("keeps another profile's runtime dir as the source", async () => {
    const tagged = runtimeDirFor("core@account2", "claude-code", root);
    process.env.CLAUDE_CONFIG_DIR = tagged;
    expect(await pickClaudeCredentialsSource({ runtimeDir: target })).toBe(tagged);
  });

  test("keeps CLAUDE_CONFIG_DIR when the caller passes no runtime dir", async () => {
    process.env.CLAUDE_CONFIG_DIR = target;
    expect(await pickClaudeCredentialsSource()).toBe(target);
  });
});
