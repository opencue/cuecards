import { describe, expect, test } from "bun:test";

import { getNeededMcps } from "./skill-dependencies";

// Integration tests against the real skill library — these skills carry
// `requires_mcps:` (backfilled) or reference `mcp__<id>__` in their bodies.
describe("getNeededMcps", () => {
  test("aggregates explicit + implicit deps across skills (lowercased keys)", () => {
    const needed = getNeededMcps(["hostinger/dns", "deployment/coolify"]);
    expect(needed.has("hostinger-api")).toBe(true);
    expect(needed.has("coolify")).toBe(true); // explicit-only (no mcp__ ref) — the backfill gap closer
  });

  test("records which skills need an MCP and dedupes them", () => {
    const needed = getNeededMcps(["hostinger/dns", "hostinger/domains"]);
    const entry = needed.get("hostinger-api")!;
    expect(entry.skills.sort()).toEqual(["hostinger/dns", "hostinger/domains"]);
  });

  test("returns an empty map for skills with no MCP dependency", () => {
    // A skill that uses no MCP should contribute nothing.
    const needed = getNeededMcps(["meta/help"]);
    expect(needed.size).toBe(0);
  });

  test("does not throw on unknown skill ids", () => {
    expect(() => getNeededMcps(["does/not-exist"])).not.toThrow();
    expect(getNeededMcps(["does/not-exist"]).size).toBe(0);
  });

  test("parses block-sequence requires_mcps (not just inline arrays)", () => {
    // xbot/operate declares its dep as a YAML block list (`requires_mcps:\n  - xbot`)
    // with no `mcp__xbot__` body ref — so it's caught ONLY by explicit block-form
    // parsing. Regression guard for the inline-only-regex starvation bug.
    const needed = getNeededMcps(["xbot/operate"]);
    expect(needed.has("xbot")).toBe(true);
    expect(needed.get("xbot")!.source).toBe("explicit");
  });
});
