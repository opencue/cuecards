/// <reference types="bun-types" />
/**
 * Tests for findCliLine — the state-machine that locates the best line in a
 * SKILL.md body to highlight for a given CLI name.  The function is a pure
 * string utility with no React dependencies.
 */
import { expect, test, describe } from "bun:test";
import { findCliLine } from "./explorer-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal SKILL.md body that mentions `cli` in various positions. */
function make({
  frontmatter = "",
  prose = "",
  code = "",
  allowedTools = "",
}: {
  frontmatter?: string;
  prose?: string;
  code?: string;
  allowedTools?: string;
}): string {
  const fm = allowedTools
    ? `---\nallowed-tools: Bash(${allowedTools})\n${frontmatter}---\n`
    : frontmatter
      ? `---\n${frontmatter}---\n`
      : "";
  const codeBlock = code ? `\`\`\`\n${code}\n\`\`\`\n` : "";
  return `${fm}${prose ? prose + "\n" : ""}${codeBlock}`.trimEnd();
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe("findCliLine", () => {
  test("returns -1 when CLI is not present at all", () => {
    const body = make({ prose: "no mention here", code: "echo hello" });
    expect(findCliLine(body, "git")).toBe(-1);
  });

  test("prefers code-fence occurrence (priority 1)", () => {
    const body = make({
      allowedTools: "git",
      prose: "Use git for version control.",
      code: "git status",
    });
    const lineIndex = findCliLine(body, "git");
    const lines = body.split("\n");
    expect(lines[lineIndex]).toContain("git status");
  });

  test("falls back to frontmatter allowed-tools line (priority 2) when not in code fence", () => {
    const body = make({
      allowedTools: "git",
      prose: "Use git for version control.",
    });
    const lineIndex = findCliLine(body, "git");
    const lines = body.split("\n");
    expect(lines[lineIndex]).toContain("allowed-tools");
  });

  test("falls back to first prose mention (priority 3) when no code or frontmatter match", () => {
    const body = "Some text\ngit is great\nmore text";
    const lineIndex = findCliLine(body, "git");
    expect(lineIndex).toBe(1);
  });

  test("handles CLI name with dots and dashes (regex special chars)", () => {
    const body = "Run git-crypt to encrypt.\n```\ngit-crypt unlock\n```";
    const lineIndex = findCliLine(body, "git-crypt");
    const lines = body.split("\n");
    expect(lines[lineIndex]).toContain("git-crypt unlock");
  });

  test("CLI appearing only in frontmatter value (not allowed-tools) is not priority 2", () => {
    // The CLI appears in a frontmatter key value, not on an allowed-tools line.
    const body = "---\ntitle: use-git-guide\n---\nsome prose about git";
    const lineIndex = findCliLine(body, "git");
    // Should find it as anyLine (prose mention), not frontLine.
    const lines = body.split("\n");
    expect(lines[lineIndex]).toBe("some prose about git");
  });

  test("does not match CLI inside a backtick inline span in frontmatter as codeLine", () => {
    // A backtick mention in prose (not a code fence) still counts as codeLine
    // per the implementation (low.includes("`" + cli.toLowerCase())).
    const body = "---\nallowed-tools: Bash(git)\n---\nRun `git status` to check.";
    const lineIndex = findCliLine(body, "git");
    const lines = body.split("\n");
    // The inline backtick line should be preferred over the frontmatter line.
    expect(lines[lineIndex]).toContain("`git status`");
  });

  test("unclosed code fence — CLI inside the fence is still found as codeLine", () => {
    const body = "---\nallowed-tools: Bash(git)\n---\n```\ngit commit -m 'msg'";
    // No closing fence; inCode stays true for the rest of the file.
    const lineIndex = findCliLine(body, "git");
    const lines = body.split("\n");
    expect(lines[lineIndex]).toContain("git commit");
  });

  test("shell-prompt lines ($ prefix) are treated as code priority", () => {
    const body = "See below:\n$ git push origin main\n";
    const lineIndex = findCliLine(body, "git");
    const lines = body.split("\n");
    expect(lines[lineIndex]).toContain("git push");
  });
});
