import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CMD_DIR = join(import.meta.dir, "..", "..", "plugins", "cue", "commands");

describe("plugin slash commands", () => {
  test("cue-setup exists and delegates to the CLI's non-interactive flow", () => {
    const md = readFileSync(join(CMD_DIR, "cue-setup.md"), "utf8");
    expect(md).toContain("npm install -g cue-ai");
    expect(md).toContain("cue auto-detect --json");
    expect(md).toContain("cue setup --profile");
    expect(md).toContain("--yes");
    // The shim dir moved off ~/.local/bin (owned by the native Claude
    // installer) — that stale path must never come back.
    expect(md).not.toContain("~/.local/bin");
    // `cue setup` is built on @clack/prompts TUI widgets (p.select/p.confirm)
    // that block on a TTY read. An agent driving it through a one-shot Bash
    // call cannot answer those prompts, so instructing it to "relay" them
    // would just hang until timeout. This wording must not come back.
    expect(md).not.toContain("Relay its prompts");
  });

  test("every other command tells the user how to recover when cue is absent", () => {
    const others = readdirSync(CMD_DIR).filter(f => f.endsWith(".md") && f !== "cue-setup.md");
    expect(others.length).toBe(6);
    for (const f of others) {
      const md = readFileSync(join(CMD_DIR, f), "utf8");
      // Without these, a marketplace install ends in a raw `command not found`.
      expect(md).toContain("/cue-setup");
      expect(md).toContain("command -v cue");
    }
  });
});
