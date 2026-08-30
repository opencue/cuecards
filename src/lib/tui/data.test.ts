import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { skillGroupId, skillGroupLabel, loadPreview } from "./data";
import type { SkillRow } from "./types";

// ---------------------------------------------------------------------------
// skillGroupId — pure function
// ---------------------------------------------------------------------------
describe("skillGroupId", () => {
  test("local skill with category prefix uses prefix", () => {
    const r: SkillRow = { id: "meta/analyze", kind: "local" };
    expect(skillGroupId(r)).toBe("L:meta");
  });

  test("local skill without slash uses full id", () => {
    const r: SkillRow = { id: "analyze", kind: "local" };
    expect(skillGroupId(r)).toBe("L:analyze");
  });

  test("local skill with nested path uses top-level segment", () => {
    const r: SkillRow = { id: "review/code-review", kind: "local" };
    expect(skillGroupId(r)).toBe("L:review");
  });

  test("mcp row has no slash → full id as group", () => {
    const r: SkillRow = { id: "codegraph", kind: "mcp" };
    expect(skillGroupId(r)).toBe("L:codegraph");
  });

  test("cli row groups like a local skill", () => {
    const r: SkillRow = { id: "rg", kind: "cli" };
    expect(skillGroupId(r)).toBe("L:rg");
  });

  test("npx skill extracts repo before '#'", () => {
    const r: SkillRow = { id: "some-org/skills#analyze", kind: "npx" };
    expect(skillGroupId(r)).toBe("N:some-org/skills");
  });

  test("npx skill id with no '#' uses full id", () => {
    const r: SkillRow = { id: "some-org/skills", kind: "npx" };
    expect(skillGroupId(r)).toBe("N:some-org/skills");
  });

  test("plugin skill uses pluginId", () => {
    const r: SkillRow = { id: "my-skill", kind: "plugin", pluginId: "claude-mem@thedotmack" };
    expect(skillGroupId(r)).toBe("P:claude-mem@thedotmack");
  });

  test("plugin skill with no pluginId → 'P:'", () => {
    const r: SkillRow = { id: "orphan", kind: "plugin" };
    expect(skillGroupId(r)).toBe("P:");
  });

  test("two local skills in the same category share a group id", () => {
    const a: SkillRow = { id: "meta/analyze", kind: "local" };
    const b: SkillRow = { id: "meta/prompt-master", kind: "local" };
    expect(skillGroupId(a)).toBe(skillGroupId(b));
  });

  test("local skills in different categories have different group ids", () => {
    const a: SkillRow = { id: "meta/analyze", kind: "local" };
    const b: SkillRow = { id: "review/code-review", kind: "local" };
    expect(skillGroupId(a)).not.toBe(skillGroupId(b));
  });
});

// ---------------------------------------------------------------------------
// skillGroupLabel — pure function
// ---------------------------------------------------------------------------
describe("skillGroupLabel", () => {
  test("local skill with slash shows category only", () => {
    const r: SkillRow = { id: "meta/analyze", kind: "local" };
    expect(skillGroupLabel(r)).toBe("meta");
  });

  test("local skill without slash returns full id", () => {
    const r: SkillRow = { id: "analyze", kind: "local" };
    expect(skillGroupLabel(r)).toBe("analyze");
  });

  test("npx skill shows 'npx: <repo>'", () => {
    const r: SkillRow = { id: "org/repo#skill", kind: "npx" };
    expect(skillGroupLabel(r)).toBe("npx: org/repo");
  });

  test("npx skill id with no '#' shows full id", () => {
    const r: SkillRow = { id: "org/repo", kind: "npx" };
    expect(skillGroupLabel(r)).toBe("npx: org/repo");
  });

  test("plugin skill shows 'plugin: <id> ✓'", () => {
    const r: SkillRow = { id: "s", kind: "plugin", pluginId: "myplugin@hub" };
    expect(skillGroupLabel(r)).toBe("plugin: myplugin@hub ✓");
  });

  test("plugin with no pluginId uses '?'", () => {
    const r: SkillRow = { id: "s", kind: "plugin" };
    expect(skillGroupLabel(r)).toBe("plugin: ? ✓");
  });

  test("mcp row without slash returns full id", () => {
    const r: SkillRow = { id: "codegraph", kind: "mcp" };
    expect(skillGroupLabel(r)).toBe("codegraph");
  });

  test("local skill: label matches category (same as group id suffix)", () => {
    const r: SkillRow = { id: "plan/autoplan", kind: "local" };
    expect(skillGroupLabel(r)).toBe("plan");
  });
});

// ---------------------------------------------------------------------------
// loadPreview — P2: tested via temp-dir fixture
// ---------------------------------------------------------------------------
describe("loadPreview", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "cue-data-test-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns file content when skillMdPath exists", async () => {
    const mdPath = join(dir, "SKILL.md");
    writeFileSync(mdPath, "# My Skill\nsome content");
    const skill: SkillRow = { id: "meta/test", kind: "local", skillMdPath: mdPath };
    const preview = await loadPreview(skill);
    expect(preview).not.toBeNull();
    expect(preview!.title).toBe("meta/test");
    expect(preview!.body).toContain("# My Skill");
    expect(preview!.body).toContain("some content");
  });

  test("prepends previewBody note when both skillMdPath and previewBody are set", async () => {
    const mdPath = join(dir, "SKILL2.md");
    writeFileSync(mdPath, "# Skill Content");
    const skill: SkillRow = {
      id: "plugin-skill",
      kind: "plugin",
      skillMdPath: mdPath,
      previewBody: "Plugin: myplugin",
    };
    const preview = await loadPreview(skill);
    expect(preview!.body).toContain("Plugin: myplugin");
    expect(preview!.body).toContain("# Skill Content");
    // Note appears before the separator
    const noteIdx = preview!.body.indexOf("Plugin: myplugin");
    const sepIdx = preview!.body.indexOf("———");
    const contentIdx = preview!.body.indexOf("# Skill Content");
    expect(noteIdx).toBeLessThan(sepIdx);
    expect(sepIdx).toBeLessThan(contentIdx);
  });

  test("returns error description when skillMdPath does not exist", async () => {
    const skill: SkillRow = {
      id: "missing/skill",
      kind: "local",
      skillMdPath: join(dir, "nonexistent", "SKILL.md"),
    };
    const preview = await loadPreview(skill);
    expect(preview).not.toBeNull();
    expect(preview!.title).toBe("missing/skill");
    expect(preview!.body).toContain("could not read");
  });

  test("uses previewBody when no skillMdPath is set", async () => {
    const skill: SkillRow = {
      id: "mcp-row",
      kind: "mcp",
      previewBody: "MCP server: codegraph\n\nOrigin: builtin",
    };
    const preview = await loadPreview(skill);
    expect(preview!.title).toBe("mcp-row");
    expect(preview!.body).toBe("MCP server: codegraph\n\nOrigin: builtin");
  });

  test("returns fallback message when neither skillMdPath nor previewBody is set", async () => {
    const skill: SkillRow = { id: "npx-skill#analyze", kind: "npx" };
    const preview = await loadPreview(skill);
    expect(preview!.title).toBe("npx-skill#analyze");
    expect(preview!.body).toContain("preview not loaded");
  });

  test("truncates files larger than PREVIEW_MAX_BYTES (16 000 bytes)", async () => {
    const bigPath = join(dir, "BIG.md");
    // Write 17 000 'x' chars — above the 16 000 byte cap.
    writeFileSync(bigPath, "x".repeat(17_000));
    const skill: SkillRow = { id: "big-skill", kind: "local", skillMdPath: bigPath };
    const preview = await loadPreview(skill);
    expect(preview!.body).toContain("…");
    // The body must be shorter than the full 17 000 char input.
    expect(preview!.body.length).toBeLessThan(17_000);
  });

  test("empty previewBody string is returned as-is (not swapped for fallback)", async () => {
    const skill: SkillRow = { id: "cli-row", kind: "cli", previewBody: "" };
    const preview = await loadPreview(skill);
    expect(preview!.body).toBe("");
  });
});
