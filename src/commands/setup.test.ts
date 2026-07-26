import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { COMMANDS } from "./_index";

const REPO_ROOT = join(import.meta.dir, "..", "..");

describe("cue setup", () => {
  test("is registered", () => {
    expect(COMMANDS).toHaveProperty("setup");
    expect(typeof COMMANDS.setup.summary).toBe("string");
  });

  test("resolves to the same module as init — one flow, not two", async () => {
    const setupMod = await COMMANDS.setup.load();
    const initMod = await COMMANDS.init.load();
    expect(setupMod.run).toBe(initMod.run);
  });

  test("postinstall points at the single setup command", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    expect(pkg.scripts.postinstall).toContain("cue setup");
    // The two-step instruction is what this replaces.
    expect(pkg.scripts.postinstall).not.toContain("cue shell install");
  });
});
