/**
 * Tests for installMarketItem — the profile.yaml editor that backs the studio
 * Market page's "Add to profile". Runs against a throwaway CUE_PROFILES_DIR
 * fixture so it never touches the real `profiles/` tree, and asserts both the
 * write and its idempotency for every addKind that has a profile.yaml home.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installMarketItem } from "./market-install";

let dir: string;
let prevProfilesDir: string | undefined;

function writeProfile(name: string, yaml: string) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "profile.yaml"), yaml);
}
function readProfile(name: string): string {
  return readFileSync(join(dir, name, "profile.yaml"), "utf8");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cue-market-install-"));
  prevProfilesDir = process.env.CUE_PROFILES_DIR;
  process.env.CUE_PROFILES_DIR = dir;
});
afterEach(() => {
  if (prevProfilesDir === undefined) delete process.env.CUE_PROFILES_DIR;
  else process.env.CUE_PROFILES_DIR = prevProfilesDir;
  rmSync(dir, { recursive: true, force: true });
});

describe("installMarketItem", () => {
  test("adds a skill under skills.npx, parsing the repo from the add command", async () => {
    writeProfile("dev", "name: dev\ninherits: core\nskills:\n  local:\n    - github/github\n");
    const r = await installMarketItem({
      id: "skill:graphql-mcp-bridge",
      addKind: "skill",
      profile: "dev",
      add: "cue marketplace install-skill zcebupelka/graphql-mcp-bridge",
    });
    expect(r.changed).toBe(true);
    expect(r.alreadyPresent).toBe(false);
    const yaml = readProfile("dev");
    expect(yaml).toContain("npx:");
    expect(yaml).toContain("- repo: zcebupelka/graphql-mcp-bridge");
    expect(yaml).toContain("skills: [graphql-mcp-bridge]");

    // Idempotent on the repo.
    const again = await installMarketItem({
      id: "skill:graphql-mcp-bridge", addKind: "skill", profile: "dev",
      add: "cue marketplace install-skill zcebupelka/graphql-mcp-bridge",
    });
    expect(again.alreadyPresent).toBe(true);
    expect(again.changed).toBe(false);
  });

  test("creates the skills scaffold when the profile has none", async () => {
    writeProfile("bare", "name: bare\ninherits: core\n");
    const r = await installMarketItem({
      id: "skill:foo", addKind: "skill", profile: "bare",
      add: "cue marketplace install-skill owner/foo",
    });
    expect(r.changed).toBe(true);
    const yaml = readProfile("bare");
    expect(yaml).toContain("skills:");
    expect(yaml).toContain("  npx:");
    expect(yaml).toContain("- repo: owner/foo");
  });

  test("appends a plugin to the plugins list", async () => {
    writeProfile("dev", "name: dev\nplugins:\n  - resend@claude-plugins-official\n");
    const r = await installMarketItem({ id: "plugin:foo@bar", addKind: "plugin", profile: "dev" });
    expect(r.changed).toBe(true);
    expect(readProfile("dev")).toContain("- foo@bar");
    const again = await installMarketItem({ id: "plugin:foo@bar", addKind: "plugin", profile: "dev" });
    expect(again.alreadyPresent).toBe(true);
  });

  test("expands a scalar inherits into a list when adding a companion profile", async () => {
    writeProfile("dev", "name: dev\ninherits: core\n");
    const r = await installMarketItem({ id: "profile:backend", addKind: "profile", profile: "dev" });
    expect(r.changed).toBe(true);
    const yaml = readProfile("dev");
    expect(yaml).toContain("inherits:");
    expect(yaml).toContain("  - core");
    expect(yaml).toContain("  - backend");
  });

  test("refuses to make a profile inherit itself", async () => {
    writeProfile("dev", "name: dev\ninherits: core\n");
    const r = await installMarketItem({ id: "profile:dev", addKind: "profile", profile: "dev" });
    expect(r.changed).toBe(false);
    expect(r.detail).toMatch(/itself/);
  });

  test("adds a workflow to the playbooks list", async () => {
    writeProfile("dev", "name: dev\n");
    const r = await installMarketItem({ id: "workflow:ship-it", addKind: "workflow", profile: "dev" });
    expect(r.changed).toBe(true);
    expect(readProfile("dev")).toContain("playbooks:");
    expect(readProfile("dev")).toContain("- ship-it");
  });

  test("returns a manual command for a bare CLI (no profile write)", async () => {
    writeProfile("dev", "name: dev\n");
    const r = await installMarketItem({ id: "cli:ripgrep", addKind: "cli", profile: "dev" });
    expect(r.changed).toBe(false);
    expect(r.manual?.command).toBeTruthy();
    expect(readProfile("dev")).toBe("name: dev\n"); // untouched
  });

  test("rejects an unknown / traversing profile name", async () => {
    await expect(
      installMarketItem({ id: "plugin:x@y", addKind: "plugin", profile: "../escape" }),
    ).rejects.toThrow(/invalid-profile/);
  });

  test("errors when the profile has no profile.yaml", async () => {
    await expect(
      installMarketItem({ id: "plugin:x@y", addKind: "plugin", profile: "ghost" }),
    ).rejects.toThrow(/not-a-physical-profile/);
  });
});
