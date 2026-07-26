import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CMD_DIR = join(import.meta.dir, "..", "..", "plugins", "cue", "commands");

describe("plugin slash commands", () => {
  test("cue-setup exists and delegates to the CLI rather than reimplementing", () => {
    const md = readFileSync(join(CMD_DIR, "cue-setup.md"), "utf8");
    expect(md).toContain("npm install -g cue-ai");
    expect(md).toContain("cue setup");
  });

  test("every other command tells the user how to recover when cue is absent", () => {
    const others = readdirSync(CMD_DIR).filter(f => f.endsWith(".md") && f !== "cue-setup.md");
    expect(others.length).toBe(6);
    for (const f of others) {
      const md = readFileSync(join(CMD_DIR, f), "utf8");
      // Without this, a marketplace install ends in a raw `command not found`.
      expect(md).toContain("/cue-setup");
    }
  });
});
