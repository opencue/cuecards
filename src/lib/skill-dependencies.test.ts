import { describe, test, expect } from "bun:test";
import { parseExplicitDeps } from "./skill-dependencies";

const fm = (body: string): string => `---\n${body}\n---\nbody text\n`;

describe("parseExplicitDeps", () => {
  test("parses inline-array form", () => {
    expect(parseExplicitDeps(fm("requires_mcps: [alpha, beta]"))).toEqual(["alpha", "beta"]);
  });

  test("parses quoted inline-array form", () => {
    expect(parseExplicitDeps(fm(`requires_mcps: ["alpha", 'beta']`))).toEqual(["alpha", "beta"]);
  });

  test("parses YAML block-sequence form", () => {
    // Regression: the original regex matched only inline arrays, silently
    // dropping block-list deps → MCP-dependency starvation.
    const content = fm("name: x\nrequires_mcps:\n  - alpha\n  - beta\ndescription: y");
    expect(parseExplicitDeps(content)).toEqual(["alpha", "beta"]);
  });

  test("block-sequence stops at the next frontmatter key", () => {
    const content = fm("requires_mcps:\n  - alpha\ndescription: not-an-mcp");
    expect(parseExplicitDeps(content)).toEqual(["alpha"]);
  });

  test("strips quotes in block-sequence items", () => {
    const content = fm(`requires_mcps:\n  - "alpha"\n  - 'beta'`);
    expect(parseExplicitDeps(content)).toEqual(["alpha", "beta"]);
  });

  test("returns [] when requires_mcps is absent", () => {
    expect(parseExplicitDeps(fm("name: x\ndescription: y"))).toEqual([]);
  });

  test("returns [] when there is no frontmatter", () => {
    expect(parseExplicitDeps("no frontmatter here")).toEqual([]);
  });
});
