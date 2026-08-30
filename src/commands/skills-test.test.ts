/**
 * Tests for skills-test.ts — the `cue skills test` command.
 *
 * SKILLS_ROOT is a module-level const computed from CUE_REPO_ROOT at import
 * time. We must NOT statically import the command module; instead we set
 * CUE_REPO_ROOT to a temp fixture tree in beforeAll and then dynamically import
 * so the module resolves SKILLS_ROOT against our fixtures, not the real tree.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type RunFn = (args: string[]) => Promise<number>;

let tmpDir: string;
let run: RunFn;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Build a YAML frontmatter block for a test *.md fixture file. */
function fm(
  input: string,
  contains: string[],
  notContains: string[],
): string {
  const c = contains.map(s => `"${s}"`).join(", ");
  const nc = notContains.map(s => `"${s}"`).join(", ");
  return `---\ninput: "${input}"\nexpect_contains: [${c}]\nexpect_not_contains: [${nc}]\n---\n`;
}

/**
 * Create <tmpDir>/resources/skills/skills/<relId>/SKILL.md and optionally
 * <relId>/test/<name> files.
 */
function mkSkill(
  relId: string,
  skillContent: string,
  testFiles?: Record<string, string>,
): void {
  const skillDir = join(tmpDir, "resources", "skills", "skills", relId);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), skillContent, "utf8");
  if (testFiles && Object.keys(testFiles).length > 0) {
    const testDir = join(skillDir, "test");
    mkdirSync(testDir, { recursive: true });
    for (const [name, content] of Object.entries(testFiles)) {
      writeFileSync(join(testDir, name), content, "utf8");
    }
  }
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "cue-sktest-"));

  // All test cases pass: SKILL.md contains both expected keywords and lacks the
  // forbidden one.
  mkSkill("cat/pass", "This skill describes keyword1 and keyword2 usage.", {
    "case.md": fm("usage", ["keyword1", "keyword2"], ["badword"]),
  });

  // expect_contains not satisfied: SKILL.md doesn't mention the keyword.
  mkSkill("cat/fail-missing", "Unrelated content only.", {
    "case.md": fm("usage", ["missing-xyz"], []),
  });

  // expect_not_contains violated: SKILL.md DOES contain the forbidden keyword.
  mkSkill("cat/fail-forbidden", "Content with badword inside.", {
    "case.md": fm("usage", [], ["badword"]),
  });

  // Multiple cases in one skill — one passes, one fails.
  mkSkill("cat/mixed", "Has keyword1 but also badword.", {
    "good.md": fm("x", ["keyword1"], []),
    "bad.md":  fm("x", ["missing-xyz"], []),
  });

  // No test/ directory at all.
  mkSkill("cat/no-test", "No tests here.");

  // test/ directory exists but the .md file has no YAML frontmatter —
  // loadTestCases should skip it (no match for /^---\n/).
  mkSkill("cat/no-fm", "Skill body.", {
    "nofront.md": "Just plain markdown text, no frontmatter.",
  });

  // test/ present, test case references a keyword — but SKILL.md is missing,
  // so skillContent is "". The expect_contains check therefore fails.
  {
    const dir = join(
      tmpDir, "resources", "skills", "skills", "cat", "no-skill-md",
    );
    mkdirSync(join(dir, "test"), { recursive: true });
    writeFileSync(
      join(dir, "test", "case.md"),
      fm("x", ["mustexist"], []),
      "utf8",
    );
    // Intentionally no SKILL.md here.
  }

  // test/ with an empty expect_contains list → vacuously passing.
  mkSkill("cat/empty-contains", "Any content.", {
    "case.md": fm("x", [], []),
  });

  // Case-insensitive matching: keyword is lowercase but SKILL.md is uppercase.
  mkSkill("cat/case-insensitive", "Contains UPPERCASE_KEYWORD here.", {
    "case.md": fm("x", ["uppercase_keyword"], []),
  });

  // Bun treats absolute test paths as name filters in some environments.
  // This fixture proves script tests run from their own scripts directory.
  mkSkill("cat/script-pass", "Script test fixture.");
  {
    const scriptsDir = join(
      tmpDir, "resources", "skills", "skills", "cat", "script-pass", "scripts",
    );
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(
      join(scriptsDir, "pass.test.ts"),
      'import { expect, test } from "bun:test";\ntest("passes", () => expect(2 + 2).toBe(4));\n',
      "utf8",
    );
  }

  process.env.CUE_REPO_ROOT = tmpDir;
  // Dynamic import so module-level SKILLS_ROOT = tmpDir/.../skills/skills.
  const mod = await import("./skills-test");
  run = mod.run;
});

afterAll(() => {
  delete process.env.CUE_REPO_ROOT;
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

describe("run — arg validation", () => {
  test("no args → returns 1 (usage)", async () => {
    expect(await run([])).toBe(1);
  });

  test("--json flag only, no skill id, no --all → returns 1", async () => {
    expect(await run(["--json"])).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Text-mode output: single skill
// ---------------------------------------------------------------------------

describe("run — single skill, text mode", () => {
  test("passing skill: all tests pass → returns 0", async () => {
    expect(await run(["cat/pass"])).toBe(0);
  });

  test("expect_contains not met → returns 1", async () => {
    expect(await run(["cat/fail-missing"])).toBe(1);
  });

  test("expect_not_contains violated → returns 1", async () => {
    expect(await run(["cat/fail-forbidden"])).toBe(1);
  });

  test("mixed tests (some pass, some fail) → returns 1", async () => {
    expect(await run(["cat/mixed"])).toBe(1);
  });

  test("skill has no test/ directory → no test cases, returns 0", async () => {
    expect(await run(["cat/no-test"])).toBe(0);
  });

  test("test file with no frontmatter is skipped → returns 0", async () => {
    expect(await run(["cat/no-fm"])).toBe(0);
  });

  test("SKILL.md absent → skillContent is empty, expect_contains fails → returns 1", async () => {
    expect(await run(["cat/no-skill-md"])).toBe(1);
  });

  test("empty expect_contains → vacuously passes → returns 0", async () => {
    expect(await run(["cat/empty-contains"])).toBe(0);
  });

  test("keyword matching is case-insensitive → returns 0", async () => {
    expect(await run(["cat/case-insensitive"])).toBe(0);
  });

  test("nonexistent skill id → no test cases found, returns 0", async () => {
    expect(await run(["cat/zzz-does-not-exist"])).toBe(0);
  });

  test("runs Bun script tests from the skill scripts directory", async () => {
    expect(await run(["cat/script-pass"])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// JSON mode
// ---------------------------------------------------------------------------

describe("run — json mode", () => {
  test("--json + passing skill → returns 0", async () => {
    expect(await run(["--json", "cat/pass"])).toBe(0);
  });

  test("--json + failing skill → returns 1", async () => {
    expect(await run(["--json", "cat/fail-missing"])).toBe(1);
  });

  test("--json + no tests (totalPassed 0 === totalTests 0) → returns 0", async () => {
    expect(await run(["--json", "cat/no-test"])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// --all mode
// ---------------------------------------------------------------------------

describe("run — --all mode", () => {
  test("--all: fixture tree has failing skills → returns 1", async () => {
    // The fixture tree contains cat/fail-missing, cat/fail-forbidden, cat/mixed
    // — all have failing test cases. So the overall result must be 1.
    const result = await run(["--all"]);
    expect(result).toBe(1);
  });
});
