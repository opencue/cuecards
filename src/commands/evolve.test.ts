/**
 * Regression test for the lineText helper. Claude session-log lines store
 * `message` as an object ({ role, content }); a naive `l.message ?? ""` returned
 * that object and crashed downstream on `.toLowerCase()` (evolve.ts:110).
 */
import { describe, expect, test } from "bun:test";

import { lineText } from "./evolve";

describe("lineText", () => {
  test("returns a string for an object-message line (the shape that crashed)", () => {
    const line = { type: "user", message: { role: "user", content: "How do I add a skill" } };
    const t = lineText(line);
    expect(typeof t).toBe("string");
    // Must be safe to call string methods on — this is what threw before.
    expect(() => t.toLowerCase()).not.toThrow();
    expect(t).toContain("add a skill");
  });

  test("handles top-level string content", () => {
    expect(lineText({ content: "hello" })).toBe("hello");
  });

  test("handles a string message", () => {
    expect(lineText({ message: "hi there" })).toBe("hi there");
  });

  test("stringifies array content blocks instead of yielding [object Object]", () => {
    const line = { message: { role: "assistant", content: [{ type: "text", text: "ship it" }] } };
    const t = lineText(line);
    expect(typeof t).toBe("string");
    expect(t).not.toBe("[object Object]");
    expect(t).toContain("ship it");
  });

  test("handles top-level array content with no message field", () => {
    const t = lineText({ content: [{ type: "text", text: "deploy now" }] });
    expect(typeof t).toBe("string");
    expect(t).toContain("deploy now");
  });

  test("returns empty string for null/empty lines", () => {
    expect(lineText(null)).toBe("");
    expect(lineText({})).toBe("");
  });

  test("joined line text is lowercaseable (checkSkillUsage path)", () => {
    const lines = [
      { message: { role: "user", content: "Run CODE-REVIEW" } },
      { content: "investigate" },
    ];
    const joined = lines.map((l) => lineText(l).toLowerCase()).join("\n");
    expect(joined).toContain("code-review");
    expect(joined).toContain("investigate");
  });
});
