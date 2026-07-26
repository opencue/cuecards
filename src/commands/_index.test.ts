/**
 * Tests for the COMMANDS registry in _index.ts.
 *
 * Guards: every registered command must have a non-empty summary string and a
 * `load` function; specific sentinel commands must remain registered.
 */

import { describe, test, expect } from "bun:test";
import { COMMANDS } from "./_index";

describe("COMMANDS registry shape", () => {
  test("every entry has a non-empty summary string", () => {
    for (const [_name, cmd] of Object.entries(COMMANDS)) {
      expect(typeof cmd.summary).toBe("string");
      expect(cmd.summary.length).toBeGreaterThan(0);
    }
  });

  test("every entry has a load property that is a function", () => {
    for (const [_name, cmd] of Object.entries(COMMANDS)) {
      expect(typeof cmd.load).toBe("function");
    }
  });

  test("summaries do not have leading or trailing whitespace", () => {
    for (const [_name, cmd] of Object.entries(COMMANDS)) {
      expect(cmd.summary.trim()).toBe(cmd.summary);
    }
  });

  test("at least 30 commands are registered (regression: accidental wholesale deletion)", () => {
    expect(Object.keys(COMMANDS).length).toBeGreaterThanOrEqual(30);
  });
});

describe("COMMANDS sentinel keys", () => {
  const EXPECTED_COMMANDS = [
    "use",
    "list",
    "doctor",
    "launch",
    "audit",
    "benchmark",
    "builtin",
    "ai",
    "ask",
    "validate",
    "init",
    "update",
    "scan",
    "score",
    "shell",
    "current",
    "resolve",
  ] as const;

  for (const key of EXPECTED_COMMANDS) {
    test(`"${key}" command is present`, () => {
      expect(COMMANDS).toHaveProperty(key);
    });
  }
});

describe("COMMANDS summary content", () => {
  test("launch summary mentions profile or exec", () => {
    const s = COMMANDS.launch.summary.toLowerCase();
    expect(s.includes("profile") || s.includes("exec") || s.includes("launch")).toBe(true);
  });

  test("doctor summary mentions profile or diff or fix", () => {
    const s = COMMANDS.doctor.summary.toLowerCase();
    expect(s.includes("profile") || s.includes("diff") || s.includes("fix") || s.includes("disk")).toBe(true);
  });

  test("audit summary mentions audit or security", () => {
    const s = COMMANDS.audit.summary.toLowerCase();
    expect(s.includes("audit") || s.includes("security")).toBe(true);
  });
});
