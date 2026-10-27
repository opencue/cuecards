import { describe, expect, it } from "bun:test";
import { insertSkillsIntoYaml } from "./profile-yaml-editor";

// ---------------------------------------------------------------------------
// insertSkillsIntoYaml — append mode
// ---------------------------------------------------------------------------

describe("insertSkillsIntoYaml append", () => {
  it("appends a single skill to an existing local: section", () => {
    const yaml = `name: test\nskills:\n  local:\n    - meta/a\n`;
    const result = insertSkillsIntoYaml(yaml, ["meta/b"], "append");
    expect(result).toContain("    - meta/a\n    - meta/b");
  });

  it("appends multiple skills to an existing local: section", () => {
    const yaml = `name: test\nskills:\n  local:\n    - meta/a\n`;
    const result = insertSkillsIntoYaml(yaml, ["meta/b", "meta/c"], "append");
    expect(result).toContain("    - meta/a\n    - meta/b\n    - meta/c");
  });

  it("creates local: under an existing skills: key when local: is absent", () => {
    const yaml = `name: test\nskills:\n`;
    const result = insertSkillsIntoYaml(yaml, ["meta/a"], "append");
    expect(result).toContain("skills:\n  local:\n    - meta/a");
  });

  it("appends entire skills block at EOF when skills: key is absent", () => {
    const yaml = `name: test\n`;
    const result = insertSkillsIntoYaml(yaml, ["meta/a"], "append");
    expect(result).toContain("\nskills:\n  local:\n    - meta/a\n");
  });

  it("handles a skill id that contains a dot (regex special char)", () => {
    // The id is only inserted as a literal string, so dots should be fine
    const yaml = `name: test\nskills:\n  local:\n`;
    const result = insertSkillsIntoYaml(yaml, ["meta/some.skill"], "append");
    expect(result).toContain("    - meta/some.skill");
  });
});

// ---------------------------------------------------------------------------
// insertSkillsIntoYaml — replace mode
// ---------------------------------------------------------------------------

describe("insertSkillsIntoYaml replace", () => {
  it("replaces all existing local entries with the new set", () => {
    const yaml = `name: test\nskills:\n  local:\n    - meta/old1\n    - meta/old2\n`;
    const result = insertSkillsIntoYaml(yaml, ["meta/new1", "meta/new2", "meta/new3"], "replace");
    expect(result).not.toContain("meta/old");
    expect(result).toContain("    - meta/new1\n    - meta/new2\n    - meta/new3");
  });

  it("creates local: under an existing skills: key in replace mode too", () => {
    const yaml = `name: test\nskills:\n`;
    const result = insertSkillsIntoYaml(yaml, ["meta/a"], "replace");
    expect(result).toContain("skills:\n  local:\n    - meta/a");
  });

  it("preserves content outside the skills.local section", () => {
    const yaml = `name: test\nicon: 🔧\nskills:\n  local:\n    - meta/old\nsome_other: value\n`;
    const result = insertSkillsIntoYaml(yaml, ["meta/new"], "replace");
    expect(result).toContain("icon: 🔧");
    expect(result).toContain("some_other: value");
    expect(result).not.toContain("meta/old");
  });
});
