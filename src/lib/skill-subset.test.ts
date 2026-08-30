/**
 * Tests for skill-subset parser + fail-open behavior.
 *
 * We can't (and shouldn't) mock the claude binary in unit tests. Instead we
 * test the parser, the always-keep set, and the early-bail conditions, since
 * those are the load-bearing pieces that determine correctness when Claude
 * does respond.
 */

import { describe, expect, test } from "bun:test";
import { selectRelevantSkills, __test } from "./skill-subset";

const { parseClaudeKeep, buildPrompt, ALWAYS_KEEP } = __test;

describe("parseClaudeKeep — output parser", () => {
  const allIds = ["meta/analyze", "rust/serde", "frontend/react", "backend/auth"];

  test("parses comma-separated KEEP line", () => {
    const out = "KEEP: rust/serde, frontend/react\nREASON: prompt mentioned rust crates and react components";
    expect(parseClaudeKeep(out, allIds)).toEqual(["rust/serde", "frontend/react"]);
  });

  test("KEEP: none returns empty array (not null)", () => {
    const out = "KEEP: none\nREASON: prompt was too generic";
    expect(parseClaudeKeep(out, allIds)).toEqual([]);
  });

  test("returns null when no KEEP line found (caller fails open)", () => {
    expect(parseClaudeKeep("just a random response", allIds)).toBeNull();
  });

  test("filters out unknown skill IDs (Claude hallucinated 'react/hooks')", () => {
    const out = "KEEP: rust/serde, react/hooks, frontend/react";
    expect(parseClaudeKeep(out, allIds)).toEqual(["rust/serde", "frontend/react"]);
  });

  test("returns null when every picked ID is unknown (signal failure, not empty pick)", () => {
    const out = "KEEP: imaginary/skill, made-up/thing";
    expect(parseClaudeKeep(out, allIds)).toBeNull();
  });

  test("tolerates whitespace around commas + extra newlines", () => {
    const out = "\n\nKEEP:   rust/serde  ,    backend/auth\n\nREASON: ...";
    expect(parseClaudeKeep(out, allIds)).toEqual(["rust/serde", "backend/auth"]);
  });

  // buildPrompt renders a NUMBERED list ("1. <id> — <desc>"), which reliably
  // invites a positional answer. Observed live: `KEEP: 1, 3, 10, 12`. Rejecting
  // it made classification fail open to "kept all skills" — indistinguishable
  // from the classifier being unavailable.
  test("accepts 1-based list positions, not just ids", () => {
    const out = "KEEP: 2, 3\nREASON: rust and react";
    expect(parseClaudeKeep(out, allIds)).toEqual(["rust/serde", "frontend/react"]);
  });

  test("accepts a mix of positions and ids", () => {
    expect(parseClaudeKeep("KEEP: 2, backend/auth", allIds)).toEqual(["rust/serde", "backend/auth"]);
  });

  test("ignores out-of-range positions", () => {
    expect(parseClaudeKeep("KEEP: 2, 99, 0", allIds)).toEqual(["rust/serde"]);
  });

  test("dedupes when a skill is named twice by both forms", () => {
    expect(parseClaudeKeep("KEEP: 2, rust/serde", allIds)).toEqual(["rust/serde"]);
  });

  test("still returns null when nothing resolves", () => {
    expect(parseClaudeKeep("KEEP: imaginary/skill, 99", allIds)).toBeNull();
  });
});

describe("ALWAYS_KEEP — operational primitives never get pruned", () => {
  test("contains expected operational skills", () => {
    expect(ALWAYS_KEEP.has("meta/analyze")).toBe(true);
    expect(ALWAYS_KEEP.has("caveman/caveman")).toBe(true);
    expect(ALWAYS_KEEP.has("caveman/caveman-commit")).toBe(true);
  });

  test("does NOT keep domain-specific skills by default", () => {
    expect(ALWAYS_KEEP.has("rust/serde")).toBe(false);
    expect(ALWAYS_KEEP.has("frontend/react")).toBe(false);
  });
});

describe("buildPrompt — output shape", () => {
  test("includes user prompt and every skill ID with description", () => {
    const items = [
      { id: "a/one", description: "First skill" },
      { id: "b/two", description: "" },          // no description
    ];
    const prompt = buildPrompt("fix the auth bug", items);
    expect(prompt).toContain("fix the auth bug");
    expect(prompt).toContain("1. a/one — First skill");
    expect(prompt).toContain("2. b/two");        // present even without description
    expect(prompt).toContain("KEEP:");
    expect(prompt).toContain("REASON:");
  });
});

describe("selectRelevantSkills — fail-open guards (no Claude call)", () => {
  test("empty prompt → returns original list, classified=false", async () => {
    const result = await selectRelevantSkills(["a", "b", "c", "d", "e"], "");
    expect(result.classified).toBe(false);
    expect(result.selected).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.reason).toContain("empty prompt");
  });

  test("very short prompt → keeps full list", async () => {
    const result = await selectRelevantSkills(["a", "b", "c", "d", "e"], "hi");
    expect(result.classified).toBe(false);
    expect(result.reason).toContain("too short");
  });

  test("≤4 skills → keeps full list (nothing to subset)", async () => {
    const result = await selectRelevantSkills(["a", "b", "c"], "implement OAuth2 for the API");
    expect(result.classified).toBe(false);
    expect(result.reason).toContain("nothing to subset");
  });
});
