import { describe, expect, test } from "bun:test";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { parse } from "yaml";

const root = realpathSync(resolve(import.meta.dir, "../.."));
const indexPath = "docs/agent-docs-index.md";
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const routes = [
  ["Launch", "launch.md"],
  ["Context budget", "agent-context-budget.md"],
  ["Collaboration", "agent-collaboration.md"],
  ["Core profile", "../profiles/core/README.md"],
  ["Bootstrap", "../setup/lean-cue.md"],
];

// Only the explicit pilot table is checked; this is not a documentation scanner.
const entries = () => [...read(indexPath).matchAll(
  /^\| ([^|]+) \| \[([^\]]+)\]\(([^)]+)\) \| ([^|]+) \| ([^|]+) \|$/gm,
)];

describe("on-demand agent documentation pilot", () => {
  test("the existing collaboration guide links to the index", () => {
    expect(read("docs/agent-collaboration.md")).toContain("(agent-docs-index.md)");
  });

  test("known task categories each point to one maintained document", () => {
    expect(entries().map((entry) => [entry[1], entry[3]])).toEqual(routes);
  });

  test("every index link resolves to a file inside this checkout", () => {
    const links = [...read(indexPath).matchAll(/\]\(([^)]+)\)/g)];
    expect(links.length).toBe(routes.length);
    for (const [, link] of links) {
      expect(link).not.toMatch(/^[a-z]+:|^\/|[?#]/i);
      expect(link).toEndWith(".md");
      const path = realpathSync(resolve(root, dirname(indexPath), link));
      expect(path.startsWith(`${root}${sep}`)).toBe(true);
      expect(statSync(path).isFile()).toBe(true);
    }
  });

  test("short summary and read_when metadata match the index", () => {
    expect(entries()).toHaveLength(routes.length);
    for (const [, , , link, summary, readWhen] of entries()) {
      const doc = read(resolve(root, dirname(indexPath), link));
      const frontmatter = doc.match(/^---\n([\s\S]*?)\n---\n/);
      expect(frontmatter).not.toBeNull();
      const metadata = parse(frontmatter?.[1] ?? "") as Record<string, unknown>;
      expect(metadata).toEqual({ summary, read_when: readWhen });
      for (const value of [summary, readWhen]) {
        expect(value.trim().length).toBeGreaterThan(0);
        expect(value.length).toBeLessThanOrEqual(160);
      }
    }
  });

  test("unknown tasks have a bounded fallback rather than loading every doc", () => {
    const fallback = read(indexPath).split("## Unknown task\n")[1]?.split("\n## ")[0];
    expect(fallback).toBeDefined();
    expect(fallback).toContain("Start with the requested outcome and the affected file");
    expect(fallback).toContain("Do not load every indexed document");
    expect(fallback).toMatch(/ask one focused\s+question/);
    expect(fallback?.length).toBeLessThanOrEqual(600);
  });

  test("the pilot remains short, on-demand, and permission-neutral", () => {
    const index = read(indexPath);
    expect(index.split("\n").length).toBeLessThanOrEqual(60);
    expect(index).toContain("not loaded automatically at launch");
    expect(index).toContain("does not grant permissions");
    expect(index).toContain("No context savings have been measured");
  });
});
