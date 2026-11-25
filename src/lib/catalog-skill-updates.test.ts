import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCatalogSkillStore } from "./catalog-skill-updates";

const a = "a".repeat(40);
const b = "b".repeat(40);
const c = "c".repeat(40);
const item = {
  id: "blog-brief",
  repo: "NagyVikt/claude-blog",
  directory: "skills/blog-brief",
  commit: a,
};
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "cue-catalog-test-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("catalog skill snapshots", () => {
  const fetch = (skill: typeof item, dir: string) => {
    mkdirSync(dir);
    writeFileSync(join(dir, "SKILL.md"), skill.commit);
    writeFileSync(join(dir, "reference.md"), "reference " + skill.commit);
  };
  const contents = () => {
    const path = createCatalogSkillStore(root, [], fetch).source("catalog/blog-brief");
    return path && readFileSync(join(path, "SKILL.md"), "utf8");
  };

  test("only explicit installs track; updates and rollback persist across invocations", () => {
    const current = createCatalogSkillStore(root, [item], fetch);
    expect(current.update()).toEqual([]);
    expect(current.source("catalog/blog-brief")).toBeUndefined();
    current.install(item.id);
    expect(contents()).toBe(a);
    const next = createCatalogSkillStore(root, [{ ...item, commit: b }], fetch);
    expect(next.update()).toEqual([{ id: item.id, commit: b }]);
    expect(contents()).toBe(b);
    expect(next.rollback(item.id)).toBe(a);
    expect(contents()).toBe(a);
    expect(next.update()).toEqual([]);
    const future = createCatalogSkillStore(root, [{ ...item, commit: c }], fetch);
    expect(future.update()).toEqual([{ id: item.id, commit: c }]);
    expect(contents()).toBe(c);
  });

  test("failed download keeps current and prior state intact", () => {
    createCatalogSkillStore(root, [item], fetch).install(item.id);
    createCatalogSkillStore(root, [{ ...item, commit: b }], fetch).update();
    const bad = createCatalogSkillStore(root, [{ ...item, commit: c }], (_skill, dir) => {
      mkdirSync(dir);
      writeFileSync(join(dir, "SKILL.md"), "partial");
      throw new Error("download failed");
    });
    expect(bad.update()).toEqual([{ id: item.id, error: "download failed" }]);
    expect(contents()).toBe(b);
    expect(bad.rollback(item.id)).toBe(a);
    expect(contents()).toBe(a);
  });

  test("does not publish while another process holds the selection lock", () => {
    createCatalogSkillStore(root, [item], fetch).install(item.id);
    const lock = join(root, item.id, ".selection-lock");
    mkdirSync(lock);
    const next = createCatalogSkillStore(root, [{ ...item, commit: b }], fetch);
    expect(next.update()[0]?.error).toContain("selection is busy");
    expect(contents()).toBe(a);
    rmSync(lock, { recursive: true });
    expect(next.update()).toEqual([{ id: item.id, commit: b }]);
    expect(contents()).toBe(b);
  });

  test("untracked skills, unknown repos, changed provenance and non-SHA refs never fetch", () => {
    createCatalogSkillStore(root, [item], fetch).install(item.id);
    const neverFetch = () => { throw new Error("unexpected fetch"); };
    const foreign = { ...item, repo: "other/claude-blog", commit: b };
    const wrongFork = { ...item, repo: "NagyVikt/other", commit: b };
    const floating = { ...item, commit: "main" };
    for (const candidate of [foreign, wrongFork, floating]) {
      const store = createCatalogSkillStore(root, [candidate], neverFetch);
      expect(store.update()[0]?.error).not.toBe("unexpected fetch");
      expect(store.source("blog-brief")).toBeUndefined();
      expect(store.source("../blog-brief")).toBeUndefined();
    }
    expect(contents()).toBe(a);
  });
});
