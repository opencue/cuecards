import { describe, test, expect } from "bun:test";
import { parseMetadataFromContent, parseCLIsFromContent } from "./optimizer";

/** Wrap body as a minimal SKILL.md-style frontmatter block. */
const fm = (body: string): string => `---\n${body}\n---\nbody text\n`;

// ---------------------------------------------------------------------------
// parseMetadataFromContent
// ---------------------------------------------------------------------------

describe("parseMetadataFromContent", () => {
  test("empty string returns empty struct", () => {
    expect(parseMetadataFromContent("")).toEqual({
      description: "",
      domain: "",
      tags: [],
      category: "",
      name: "",
    });
  });

  test("content with no frontmatter returns empty struct", () => {
    expect(parseMetadataFromContent("just body text\nno dashes")).toEqual({
      description: "",
      domain: "",
      tags: [],
      category: "",
      name: "",
    });
  });

  test("empty frontmatter block returns empty struct", () => {
    // Three-dash block with only whitespace inside
    expect(parseMetadataFromContent("---\n\n---\nbody\n")).toEqual({
      description: "",
      domain: "",
      tags: [],
      category: "",
      name: "",
    });
  });

  test("extracts description, domain, and name from basic frontmatter", () => {
    const content = fm("name: my-skill\ndescription: Does something useful\ndomain: backend");
    const result = parseMetadataFromContent(content);
    expect(result.name).toBe("my-skill");
    expect(result.description).toBe("Does something useful");
    expect(result.domain).toBe("backend");
  });

  test("inline tags array parses comma-separated items", () => {
    const content = fm("tags: [foo, bar, baz]");
    expect(parseMetadataFromContent(content).tags).toEqual(["foo", "bar", "baz"]);
  });

  test("inline tags array strips surrounding quotes from items", () => {
    const content = fm('tags: ["alpha", \'beta\', gamma]');
    expect(parseMetadataFromContent(content).tags).toEqual(["alpha", "beta", "gamma"]);
  });

  test("empty inline tags array returns []", () => {
    const content = fm("tags: []");
    expect(parseMetadataFromContent(content).tags).toEqual([]);
  });

  test("block-sequence tags parses multi-line list", () => {
    const content = fm("tags:\n  - alpha\n  - beta\n  - gamma");
    expect(parseMetadataFromContent(content).tags).toEqual(["alpha", "beta", "gamma"]);
  });

  test("block-sequence tags strips surrounding quotes", () => {
    const content = fm('tags:\n  - "alpha"\n  - \'beta\'');
    expect(parseMetadataFromContent(content).tags).toEqual(["alpha", "beta"]);
  });

  test("domain falls back to category value when domain key is absent", () => {
    const result = parseMetadataFromContent(fm("description: x\ncategory: devops"));
    expect(result.domain).toBe("devops");
    expect(result.category).toBe("devops");
  });

  test("category falls back to domain value when category key is absent", () => {
    const result = parseMetadataFromContent(fm("description: x\ndomain: frontend"));
    expect(result.category).toBe("frontend");
    expect(result.domain).toBe("frontend");
  });

  test("domain and category are populated independently when both present", () => {
    const result = parseMetadataFromContent(fm("description: x\ndomain: backend\ncategory: api"));
    expect(result.domain).toBe("backend");
    expect(result.category).toBe("api");
  });

  test("description is truncated at 200 characters", () => {
    // Ensures slice(0, 200) guard works on long one-line descriptions.
    const long = "x".repeat(250);
    const result = parseMetadataFromContent(fm(`description: ${long}`));
    expect(result.description).toHaveLength(200);
    expect(result.description).toBe("x".repeat(200));
  });

  test("quoted description strips surrounding double quotes", () => {
    const content = fm('description: "A quoted description"');
    expect(parseMetadataFromContent(content).description).toBe("A quoted description");
  });
});

// ---------------------------------------------------------------------------
// parseCLIsFromContent
// ---------------------------------------------------------------------------

describe("parseCLIsFromContent", () => {
  test("empty string returns []", () => {
    expect(parseCLIsFromContent("")).toEqual([]);
  });

  test("content without frontmatter returns []", () => {
    expect(parseCLIsFromContent("no frontmatter here")).toEqual([]);
  });

  test("frontmatter without allowed-tools returns []", () => {
    expect(parseCLIsFromContent(fm("name: x\ndescription: y"))).toEqual([]);
  });

  test("allowed-tools with non-Bash tools returns [] (no Bash entries)", () => {
    // Read, Write, Edit do not produce CLI entries.
    const content = fm("allowed-tools: Read Write Edit");
    expect(parseCLIsFromContent(content)).toEqual([]);
  });

  test("extracts CLI name from Bash(cli arg) entry", () => {
    const content = fm("allowed-tools: Bash(docker run)");
    expect(parseCLIsFromContent(content)).toContain("docker");
  });

  test("extracts CLI before colon in Bash(git:*) pattern", () => {
    const content = fm("allowed-tools: Bash(git:*)");
    expect(parseCLIsFromContent(content)).toContain("git");
  });

  test("extracts multiple CLIs from multiple Bash() entries on one line", () => {
    const content = fm("allowed-tools: Bash(git status) Bash(docker run) Bash(kubectl)");
    const clis = parseCLIsFromContent(content);
    expect(clis).toContain("git");
    expect(clis).toContain("docker");
    expect(clis).toContain("kubectl");
  });

  test("'bash' keyword in Bash(bash) is filtered out", () => {
    // The executor itself is not a useful CLI to report.
    const content = fm("allowed-tools: Bash(bash -c)");
    expect(parseCLIsFromContent(content)).not.toContain("bash");
  });

  test("unknown CLI (not in KNOWN_CLIS) in Bash() is still returned", () => {
    // allowed-tools branch extracts any CLI, not just the known set.
    const content = fm("allowed-tools: Bash(my-custom-tool --flag)");
    expect(parseCLIsFromContent(content)).toContain("my-custom-tool");
  });

  test("extracts known CLI from Prerequisites bullet list", () => {
    const content = [
      "---",
      "name: x",
      "---",
      "",
      "## Prerequisites",
      "",
      "- docker installed and running",
      "- node.js is required",
      "",
    ].join("\n");
    const clis = parseCLIsFromContent(content);
    expect(clis).toContain("docker");
    expect(clis).toContain("node");
  });

  test("unknown tool in Prerequisites is not returned", () => {
    const content = [
      "---",
      "name: x",
      "---",
      "",
      "## Prerequisites",
      "",
      "- weirdunknowntool installed",
      "",
    ].join("\n");
    expect(parseCLIsFromContent(content)).not.toContain("weirdunknowntool");
  });

  test("combines CLIs from both allowed-tools and Prerequisites", () => {
    const content = [
      "---",
      "name: x",
      "allowed-tools: Bash(git status)",
      "---",
      "",
      "## Prerequisites",
      "",
      "- docker installed",
      "",
    ].join("\n");
    const clis = parseCLIsFromContent(content);
    expect(clis).toContain("git");
    expect(clis).toContain("docker");
  });

  test("asterisk-bullet Prerequisites lines are also scanned", () => {
    const content = [
      "---",
      "name: x",
      "---",
      "",
      "## Prerequisites",
      "",
      "* kubectl for kubernetes",
      "",
    ].join("\n");
    expect(parseCLIsFromContent(content)).toContain("kubectl");
  });

  test("no duplicates when same CLI appears in both allowed-tools and Prerequisites", () => {
    const content = [
      "---",
      "name: x",
      "allowed-tools: Bash(docker build)",
      "---",
      "",
      "## Prerequisites",
      "",
      "- docker required",
      "",
    ].join("\n");
    const clis = parseCLIsFromContent(content);
    // Set semantics: docker appears only once
    expect(clis.filter((c) => c === "docker")).toHaveLength(1);
  });
});
