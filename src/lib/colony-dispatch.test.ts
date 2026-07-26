import { describe, test, expect } from "bun:test";
import { resolveProfileForTask } from "./colony-dispatch";

describe("resolveProfileForTask", () => {
  test("returns default profile with no matched keywords for unrelated task", () => {
    const result = resolveProfileForTask("do some completely unrelated thing xyz1234");
    expect(result.profile).toBe("full");
    expect(result.matchedKeywords).toEqual([]);
  });

  test("empty string returns default profile", () => {
    const result = resolveProfileForTask("");
    expect(result.profile).toBe("full");
    expect(result.matchedKeywords).toEqual([]);
  });

  test("security keyword maps to a matching profile", () => {
    const result = resolveProfileForTask("review the security vulnerabilities in the API");
    expect(result.profile).toBe("backend");
    expect(result.matchedKeywords).toContain("security");
  });

  test("blog keyword maps to docs-writer profile", () => {
    const result = resolveProfileForTask("write a blog post about our new feature");
    expect(result.profile).toBe("docs-writer");
    expect(result.matchedKeywords).toContain("blog");
  });

  test("frontend keyword maps to frontend profile", () => {
    const result = resolveProfileForTask("build a new react component with tailwind");
    expect(result.profile).toBe("frontend");
    // At least one of the keywords should have matched
    const matched = result.matchedKeywords;
    const haystack = ["react", "tailwind", "frontend", "ui", "component"];
    expect(matched.some(kw => haystack.includes(kw))).toBe(true);
  });

  test("deploy keyword maps to backend profile", () => {
    const result = resolveProfileForTask("deploy the app to coolify");
    expect(result.profile).toBe("backend");
    expect(result.matchedKeywords.some(kw => ["deploy", "coolify"].includes(kw))).toBe(true);
  });

  test("medusa keyword maps to medusa-dev profile", () => {
    const result = resolveProfileForTask("add a new product to the medusa storefront");
    expect(result.profile).toBe("medusa-dev");
    expect(result.matchedKeywords).toContain("medusa");
  });

  test("matching is case-insensitive", () => {
    const result = resolveProfileForTask("BLOG writing task");
    expect(result.profile).toBe("docs-writer");
  });

  test("matched keywords array is non-empty when a rule fires", () => {
    const result = resolveProfileForTask("write some docs for the new feature");
    expect(result.matchedKeywords.length).toBeGreaterThan(0);
  });
});
