import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { refreshForkSkills, renderForkProfile } from "./refresh-fork-skills";
import catalog from "../web/src/skill-catalog.json";

const previous = "1".repeat(40);
const head = "2".repeat(40);
const repo = "NagyVikt/test-fork";
const directory = "skills/blog-brief";
const skill = { id: "blog-brief", description: "Write briefs", repo, directory, commit: previous };
const sibling = { ...skill, id: "blog-calendar", directory: "skills/blog-calendar" };

function github({ changed = false, script = false, license = false, failed = false } = {}) {
  return (endpoint: string) => {
    if (endpoint.endsWith("/commits/HEAD")) return { sha: head };
    if (endpoint.includes("/compare/")) return { status: "ahead" };
    const latest = endpoint.includes(head);
    if (failed && latest) throw new Error("GitHub unavailable");
    return {
      truncated: false,
      tree: [
        { path: "LICENSE", mode: "100644", type: "blob", sha: latest && license ? head : previous },
        { path: directory, mode: "040000", type: "tree", sha: latest && changed ? head : previous },
        { path: `${directory}/SKILL.md`, mode: "100644", type: "blob" },
        { path: sibling.directory, mode: "040000", type: "tree", sha: previous },
        ...(latest && script ? [{ path: `${directory}/run.sh`, mode: "100755", type: "blob" }] : []),
      ],
    };
  };
}

test("unchanged skill trees retain their pins despite a new repo commit", () => {
  expect(refreshForkSkills([skill], github())).toEqual([skill]);
});

test("a changed skill directory proposes the exact new source commit", () => {
  const updated = refreshForkSkills([skill, sibling], github({ changed: true }));
  expect(updated).toEqual([{ ...skill, commit: head }, { ...sibling, commit: head }]);
  expect(renderForkProfile(updated)).toContain(`pin: git@${head}`);
  expect(renderForkProfile(updated)).toContain('skills: ["blog-brief", "blog-calendar"]');
});

test("shipped opt-in profile matches the catalog", () => {
  const profile = readFileSync(new URL("../profiles/nagyvikt-skills/profile.yaml", import.meta.url), "utf8");
  expect(profile).toBe(renderForkProfile(catalog));
});

test("errors, non-Markdown files, and license changes cannot move a pin", () => {
  expect(() => refreshForkSkills([skill], github({ failed: true }))).toThrow("GitHub unavailable");
  expect(() => refreshForkSkills([skill], github({ changed: true, script: true }))).toThrow("Markdown");
  expect(() => refreshForkSkills([skill], github({ changed: true, license: true }))).toThrow("license");
  expect(skill.commit).toBe(previous);
});
