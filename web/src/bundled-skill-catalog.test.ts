import { expect, test } from "bun:test";
import { filterPublicSkills, readBundledSkills } from "./bundled-skill-catalog";
import blogListings from "./fork-skill-listings.json";
import { searchForkSkills } from "./skill-catalog";

test("the public index includes all public bundled IDs and only display metadata", () => {
  const items = readBundledSkills({
    installed: [
      { id: "vercel/react-native-skills", name: "React Native", category: "vercel", description: "" },
      { id: "content/draft", name: "Draft", category: "content", description: "Write\n a first draft.", source: "internal/path", links: ["https://example.com"] },
      { id: "private/local", name: "Local", category: "private", description: "Private details" },
    ],
  });
  expect(items).toEqual([
    { id: "content/draft", name: "Draft", category: "content", description: "Write a first draft." },
    { id: "vercel/react-native-skills", name: "React Native", category: "vercel", description: expect.stringContaining("Expo") },
  ]);
  expect(() => readBundledSkills({ error: "missing catalog" })).toThrow("Invalid bundled skill catalog");
  expect(() => readBundledSkills({ installed: [] })).toThrow("No public bundled skills");
});

test("search spans bundled and fork skills and can be narrowed by category", () => {
  const skills = [
    { id: "content/draft", name: "Draft", category: "content", description: "Write a publishing brief." },
    { id: "blog-brief", name: "Blog brief", category: "GitHub forks", description: "Plan an article before publishing.", source: "NagyVikt/claude-blog" },
  ];
  expect(filterPublicSkills(skills, "publishing BRIEF", "").map(skill => skill.id)).toEqual(["content/draft", "blog-brief"]);
  expect(filterPublicSkills(skills, "nagyvikt", "GitHub forks")).toEqual([skills[1]]);
  expect(filterPublicSkills(skills, "nagyvikt", "content")).toEqual([]);
});

test("featured fork entries are unique and browse-only metadata does not make them installable", () => {
  const reviewed = searchForkSkills().map(skill => skill.id);
  const { commit, ...blogSkills } = blogListings;
  const catalog = [...reviewed, ...Object.keys(blogSkills)];
  expect(commit).toMatch(/^[a-f\d]{40}$/);
  expect(new Set(catalog).size).toBe(catalog.length);
  expect(catalog).toHaveLength(29);
  expect(reviewed).not.toContain("blog-notebooklm");
});
