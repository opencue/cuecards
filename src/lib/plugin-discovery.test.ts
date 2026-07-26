import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverInstalledPlugins } from "./plugin-discovery";

let tmpDir: string;
let savedCueClaudeHome: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cue-plugin-disc-"));
  savedCueClaudeHome = process.env.CUE_CLAUDE_HOME;
  process.env.CUE_CLAUDE_HOME = tmpDir;
});

afterEach(() => {
  if (savedCueClaudeHome !== undefined) process.env.CUE_CLAUDE_HOME = savedCueClaudeHome;
  else delete process.env.CUE_CLAUDE_HOME;
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeInstalled(plugins: Record<string, Array<{ version?: string; installPath?: string; installedAt?: string }>>) {
  mkdirSync(join(tmpDir, "plugins"), { recursive: true });
  writeFileSync(
    join(tmpDir, "plugins", "installed_plugins.json"),
    JSON.stringify({ plugins }),
  );
}

function writeSettings(enabledPlugins: Record<string, boolean>) {
  writeFileSync(join(tmpDir, "settings.json"), JSON.stringify({ enabledPlugins }));
}

describe("discoverInstalledPlugins", () => {
  test("returns empty array when no files exist", () => {
    expect(discoverInstalledPlugins()).toEqual([]);
  });

  test("returns empty array when files are empty/missing plugins", () => {
    mkdirSync(join(tmpDir, "plugins"), { recursive: true });
    writeFileSync(join(tmpDir, "plugins", "installed_plugins.json"), JSON.stringify({ plugins: {} }));
    writeFileSync(join(tmpDir, "settings.json"), JSON.stringify({ enabledPlugins: {} }));
    expect(discoverInstalledPlugins()).toEqual([]);
  });

  test("parses plugin id into name and marketplace", () => {
    writeSettings({ "my-plugin@npm": true });
    const plugins = discoverInstalledPlugins();
    expect(plugins).toHaveLength(1);
    expect(plugins[0]!.name).toBe("my-plugin");
    expect(plugins[0]!.marketplace).toBe("npm");
  });

  test("id with no @ separator sets marketplace to empty string", () => {
    writeSettings({ "bare-plugin": true });
    const plugins = discoverInstalledPlugins();
    expect(plugins[0]!.marketplace).toBe("");
    expect(plugins[0]!.name).toBe("bare-plugin");
  });

  test("enabled flag reflects settings.enabledPlugins", () => {
    writeSettings({ "a@npm": true, "b@npm": false });
    const plugins = discoverInstalledPlugins();
    const a = plugins.find((p) => p.id === "a@npm")!;
    const b = plugins.find((p) => p.id === "b@npm")!;
    expect(a.enabled).toBe(true);
    expect(b.enabled).toBe(false);
  });

  test("known flag true for any id in enabledPlugins map", () => {
    writeSettings({ "a@npm": false });
    const plugins = discoverInstalledPlugins();
    expect(plugins[0]!.known).toBe(true);
  });

  test("plugin from installed_plugins but not in settings has known=false and enabled=false", () => {
    writeInstalled({ "orphan@npm": [{ version: "1.0.0" }] });
    const plugins = discoverInstalledPlugins();
    const p = plugins.find((p) => p.id === "orphan@npm")!;
    expect(p.enabled).toBe(false);
    expect(p.known).toBe(false);
  });

  test("version from installed entry", () => {
    writeInstalled({ "pkg@npm": [{ version: "2.3.4" }] });
    const p = discoverInstalledPlugins().find((p) => p.id === "pkg@npm")!;
    expect(p.version).toBe("2.3.4");
  });

  test("version defaults to 'unknown' when not in installed map", () => {
    writeSettings({ "ghost@npm": true });
    const p = discoverInstalledPlugins().find((p) => p.id === "ghost@npm")!;
    expect(p.version).toBe("unknown");
  });

  test("installPath null when not in installed map", () => {
    writeSettings({ "ghost@npm": true });
    const p = discoverInstalledPlugins().find((p) => p.id === "ghost@npm")!;
    expect(p.installPath).toBeNull();
  });

  test("installedAt from installed entry", () => {
    writeInstalled({ "pkg@npm": [{ installedAt: "2025-01-01T00:00:00Z" }] });
    const p = discoverInstalledPlugins().find((p) => p.id === "pkg@npm")!;
    expect(p.installedAt).toBe("2025-01-01T00:00:00Z");
  });

  test("skills count from on-disk plugin layout", () => {
    const installPath = join(tmpDir, "plugin-data", "my-plugin");
    const skillsDir = join(installPath, "skills");
    // Create two skills
    mkdirSync(join(skillsDir, "skill-a"), { recursive: true });
    writeFileSync(join(skillsDir, "skill-a", "SKILL.md"), "# skill a");
    mkdirSync(join(skillsDir, "skill-b"), { recursive: true });
    writeFileSync(join(skillsDir, "skill-b", "SKILL.md"), "# skill b");
    // Create one directory WITHOUT SKILL.md (should not count)
    mkdirSync(join(skillsDir, "not-a-skill"), { recursive: true });

    writeInstalled({ "my-plugin@npm": [{ version: "1.0.0", installPath }] });
    const p = discoverInstalledPlugins().find((p) => p.id === "my-plugin@npm")!;
    expect(p.skills).toBe(2);
  });

  test("description from plugin.json manifest", () => {
    const installPath = join(tmpDir, "plugin-data", "desc-plugin");
    mkdirSync(join(installPath, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(installPath, ".claude-plugin", "plugin.json"),
      JSON.stringify({ description: "A neat plugin" }),
    );

    writeInstalled({ "desc-plugin@npm": [{ version: "1.0.0", installPath }] });
    const p = discoverInstalledPlugins().find((p) => p.id === "desc-plugin@npm")!;
    expect(p.description).toBe("A neat plugin");
  });

  test("description capped at 200 chars", () => {
    const installPath = join(tmpDir, "plugin-data", "long-plugin");
    mkdirSync(join(installPath, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(installPath, ".claude-plugin", "plugin.json"),
      JSON.stringify({ description: "x".repeat(300) }),
    );

    writeInstalled({ "long-plugin@npm": [{ version: "1.0.0", installPath }] });
    const p = discoverInstalledPlugins().find((p) => p.id === "long-plugin@npm")!;
    expect(p.description.length).toBe(200);
  });

  test("enabled-first sort order", () => {
    writeSettings({ "b@npm": false, "a@npm": true });
    const plugins = discoverInstalledPlugins();
    expect(plugins[0]!.id).toBe("a@npm");  // enabled first
    expect(plugins[1]!.id).toBe("b@npm");
  });

  test("alphabetical within same enabled status", () => {
    writeSettings({ "c@npm": true, "a@npm": true, "b@npm": true });
    const plugins = discoverInstalledPlugins();
    const ids = plugins.map((p) => p.id);
    expect(ids).toEqual(["a@npm", "b@npm", "c@npm"]);
  });

  test("gracefully handles corrupted installed_plugins.json", () => {
    mkdirSync(join(tmpDir, "plugins"), { recursive: true });
    writeFileSync(join(tmpDir, "plugins", "installed_plugins.json"), "not-json");
    // Should not throw, returns whatever settings.json has
    expect(() => discoverInstalledPlugins()).not.toThrow();
  });
});
