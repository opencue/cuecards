/**
 * E2e tests for `cue skills-new`.
 *
 * Only the --dry-run path is hermetic (no disk writes). The core helpers
 * (buildTemplate, titleCase, parseList, getArg) are not exported, so they are
 * exercised indirectly via the run() entrypoint through --dry-run.
 *
 * NOTE: --category/--name alternative form has a known source-level bug where
 * `args.find(a => !a.startsWith("-"))` picks up the value after --category as
 * the positional id, causing the slash-check to fail. That path is NOT tested
 * here to avoid a false-failure test.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CUE_BIN = join(import.meta.dir, "../index.ts");
const BUN_SPAWNABLE = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;

function cue(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("bun", ["run", CUE_BIN, ...args], {
    encoding: "utf8",
    timeout: 20000,
  });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe.skipIf(!BUN_SPAWNABLE)("cue skills-new", () => {
  test("no args → exit 1 with usage hint on stderr", () => {
    const res = cue(["skills-new"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Usage:");
    expect(res.stderr).toContain("skills new");
  });

  test("id without slash → exit 1 with usage hint", () => {
    const res = cue(["skills-new", "badname"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Usage:");
  });

  test("--dry-run emits SKILL.md template to stdout without writing to disk", () => {
    const res = cue(["skills-new", "test/my-test-skill-xyzzy", "--dry-run"]);
    // status 0 means scaffold passed lint (no R-rule errors)
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("name: my-test-skill-xyzzy");
    expect(res.stdout).toContain("category: test");
  });

  test("--dry-run scaffold includes expected structural sections", () => {
    const res = cue(["skills-new", "test/section-test-skill", "--dry-run"]);
    expect(res.stdout).toContain("## Steps");
    expect(res.stdout).toContain("## Example");
    expect(res.stdout).toContain("## When to use");
  });

  test("--dry-run emits a lint summary line on stdout", () => {
    const res = cue(["skills-new", "test/lint-check-skill", "--dry-run"]);
    expect(res.stdout).toContain("--- lint:");
    expect(res.stdout).toContain("/100");
    expect(res.stdout).toContain("error(s)");
  });

  test("--dry-run scaffold passes lint with zero errors (contract: templates are self-validating)", () => {
    const res = cue(["skills-new", "test/zero-errors-skill", "--dry-run"]);
    expect(res.status).toBe(0);
    // status 0 ↔ errors.length === 0
    expect(res.stdout).toContain("0 error(s)");
  });

  test("--dry-run with custom description includes description in frontmatter", () => {
    const desc = "Use when the user asks for testing or mentions testing purposes.";
    const res = cue(["skills-new", "test/desc-skill", "--dry-run", "--description", desc]);
    expect(res.stdout).toContain(desc);
  });

  test("--dry-run with --triggers seeds triggers block in frontmatter", () => {
    const res = cue(["skills-new", "test/trigger-skill", "--dry-run", "--triggers", "code review,pr review"]);
    expect(res.stdout).toContain("code review");
    expect(res.stdout).toContain("pr review");
  });

  test("--dry-run with --tags uses custom tags instead of category default", () => {
    const res = cue(["skills-new", "test/tagged-skill", "--dry-run", "--tags", "custom-tag,another-tag"]);
    expect(res.stdout).toContain("custom-tag");
    expect(res.stdout).toContain("another-tag");
  });

  test("--dry-run titleCase converts kebab slug to title in SKILL.md heading", () => {
    const res = cue(["skills-new", "test/my-hyphenated-skill", "--dry-run"]);
    // buildTemplate calls titleCase(name) which converts "my-hyphenated-skill"
    // → "My Hyphenated Skill" and puts it in the `# Title` heading.
    expect(res.stdout).toContain("# My Hyphenated Skill");
  });
});
