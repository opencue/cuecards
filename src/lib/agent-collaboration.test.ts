import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const root = resolve(import.meta.dir, "../..");
const guidePath = "docs/agent-collaboration.md";
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("repository agent collaboration contract", () => {
  test("Claude and Codex share one repository instruction source", () => {
    expect(read("CLAUDE.md").trim()).toBe("@AGENTS.md");
    expect(read("AGENTS.md")).toContain(`(${guidePath})`);
  });

  test("the bootstrap stays lean and the detailed guide loads on demand", () => {
    const bootstrap = read("AGENTS.md").split("<!-- multiagent-safety:START -->")[0];
    expect(bootstrap.split("\n").length).toBeLessThanOrEqual(120);
    expect(bootstrap).toContain("Read it only when");
    expect(bootstrap).not.toContain("## Handoff template");
  });

  test("guide links resolve inside this checkout, without another repo", () => {
    const guide = read(guidePath);
    const links = [...guide.matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g)]
      .map((match) => match[1])
      .filter((link) => !link.startsWith("https://"));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const target = resolve(root, dirname(guidePath), link);
      expect(target.startsWith(`${root}${sep}`)).toBe(true);
      expect(existsSync(target)).toBe(true);
    }
    expect(guide).not.toMatch(/~\/Projects|\/home\/deadpool/);
  });

  test("handoffs retain ownership, verification, live jobs, and next action", () => {
    const guide = read(guidePath);
    for (const field of [
      "Outcome:", "Branch/worktree:", "Owned paths:", "Commit/PR:",
      "Verification:", "Live jobs:", "Blocker:", "Next action:",
    ]) {
      expect(guide).toContain(field);
    }
    expect(guide).toMatch(/NagyVikt\/agent-scripts\/blob\/[a-f0-9]{40}\/AGENTS\.MD/);
  });
});
