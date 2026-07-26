import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseDependencies, buildDependencyGraph, explainWhy } from "./skill-deps";

const TEST_ROOT = join(import.meta.dir, "..", "..", "__test_skills_deps__");

beforeAll(() => {
  process.env.CUE_SKILLS_ROOT = TEST_ROOT;
  // Create test skills with depends: frontmatter
  mkdirSync(join(TEST_ROOT, "a", "skill-a"), { recursive: true });
  writeFileSync(join(TEST_ROOT, "a", "skill-a", "SKILL.md"), `---
name: skill-a
description: "A"
depends: [b/skill-b, c/skill-c]
---
# Skill A
`);
  mkdirSync(join(TEST_ROOT, "b", "skill-b"), { recursive: true });
  writeFileSync(join(TEST_ROOT, "b", "skill-b", "SKILL.md"), `---
name: skill-b
description: "B"
depends: [c/skill-c]
---
# Skill B
`);
  mkdirSync(join(TEST_ROOT, "c", "skill-c"), { recursive: true });
  writeFileSync(join(TEST_ROOT, "c", "skill-c", "SKILL.md"), `---
name: skill-c
description: "C"
---
# Skill C
`);
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  delete process.env.CUE_SKILLS_ROOT;
});

describe("parseDependencies", () => {
  test("reads depends array from frontmatter", () => {
    expect(parseDependencies("a/skill-a")).toEqual(["b/skill-b", "c/skill-c"]);
  });

  test("returns empty for skill without depends", () => {
    expect(parseDependencies("c/skill-c")).toEqual([]);
  });

  test("returns empty for nonexistent skill", () => {
    expect(parseDependencies("x/nope")).toEqual([]);
  });
});

describe("buildDependencyGraph", () => {
  test("builds adjacency list including transitive deps", () => {
    const graph = buildDependencyGraph(["a/skill-a"]);
    expect(graph.get("a/skill-a")).toEqual(["b/skill-b", "c/skill-c"]);
    expect(graph.get("b/skill-b")).toEqual(["c/skill-c"]);
    expect(graph.get("c/skill-c")).toEqual([]);
  });
});

describe("explainWhy", () => {
  test("finds paths to a transitive dependency", () => {
    const graph = buildDependencyGraph(["a/skill-a"]);
    const paths = explainWhy("c/skill-c", graph);
    expect(paths.length).toBeGreaterThan(0);
    // Should include path through a/skill-a → c/skill-c and a/skill-a → b/skill-b → c/skill-c
    const pathStrings = paths.map(p => p.join(" → "));
    expect(pathStrings.some(s => s.includes("a/skill-a"))).toBe(true);
  });
});
