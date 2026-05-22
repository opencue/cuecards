import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, stat, rm, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { materializeRuntime } from "./runtime-materializer";
import type { ResolvedProfile } from "../../profiles/_types";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "cue-runtime-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const sampleProfile: ResolvedProfile = {
  name: "test-frontend",
  description: "test",
  agents: ["claude-code"],
  skills: {
    local: [{ id: "design/ui-ux-pro-max" }],
    npx: [],
  },
  mcps: [{ id: "claude-mem" }],
  plugins: [{ id: "frontend-design@claude-plugins-official" }],
  env: {},
  inheritanceChain: ["test-frontend"],
};

describe("materializeRuntime", () => {
  test("creates runtime dir with hash and settings.json", async () => {
    const out = await materializeRuntime({
      profile: sampleProfile,
      agent: "claude-code",
      runtimeRoot: join(root, "runtime"),
      // tests stub these so we don't need real skills/mcps on disk
      skillSourceLookup: async (id) => `/fake/skills/${id}`,
      mcpRegistry: { "claude-mem": { command: "claude-mem", args: [] } },
      userClaudeMd: "# user CLAUDE.md\n",
    });

    expect(out.runtimeDir).toBe(join(root, "runtime", "test-frontend", "claude"));
    expect(out.rebuilt).toBe(true);

    const settings = JSON.parse(await readFile(join(out.runtimeDir, "settings.json"), "utf8"));
    expect(settings.enabledPlugins).toEqual({ "frontend-design@claude-plugins-official": true });
    expect(settings.mcpServers).toEqual({ "claude-mem": { command: "claude-mem", args: [] } });

    const claudemd = await readFile(join(out.runtimeDir, "CLAUDE.md"), "utf8");
    expect(claudemd).toMatch(/^<!-- cue: profile=test-frontend/);
    expect(claudemd).toContain("# user CLAUDE.md");

    const hash = await readFile(join(out.runtimeDir, ".cue-hash"), "utf8");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("second call with same profile is a no-op (rebuilt=false)", async () => {
    const args = {
      profile: sampleProfile,
      agent: "claude-code" as const,
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id: string) => `/fake/skills/${id}`,
      mcpRegistry: { "claude-mem": { command: "claude-mem", args: [] } },
      userClaudeMd: "# user CLAUDE.md\n",
    };
    const first = await materializeRuntime(args);
    expect(first.rebuilt).toBe(true);
    const second = await materializeRuntime(args);
    expect(second.rebuilt).toBe(false);
  });

  test("re-materializes when profile content changes", async () => {
    const args = {
      profile: sampleProfile,
      agent: "claude-code" as const,
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id: string) => `/fake/skills/${id}`,
      mcpRegistry: { "claude-mem": { command: "claude-mem", args: [] } },
      userClaudeMd: "# user CLAUDE.md\n",
    };
    await materializeRuntime(args);

    const changed: ResolvedProfile = {
      ...sampleProfile,
      plugins: [{ id: "vercel@claude-plugins-official" }],
    };
    const second = await materializeRuntime({ ...args, profile: changed });
    expect(second.rebuilt).toBe(true);
  });

  test("symlinks every local skill into <runtime>/skills/", async () => {
    const out = await materializeRuntime({
      profile: sampleProfile,
      agent: "claude-code",
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id) => `/fake/source/${id}`,
      mcpRegistry: {},
      userClaudeMd: "",
    });
    const link = await readlink(join(out.runtimeDir, "skills", "design", "ui-ux-pro-max"));
    expect(link).toBe("/fake/source/design/ui-ux-pro-max");
  });

  test("excludes resources whose agents list does not include current agent", async () => {
    const filtered: ResolvedProfile = {
      ...sampleProfile,
      mcps: [
        { id: "codex-only", agents: ["codex"] },
        { id: "claude-mem" },
      ],
    };
    const out = await materializeRuntime({
      profile: filtered,
      agent: "claude-code",
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id) => `/fake/source/${id}`,
      mcpRegistry: { "codex-only": {}, "claude-mem": { command: "claude-mem" } },
      userClaudeMd: "",
    });
    const settings = JSON.parse(await readFile(join(out.runtimeDir, "settings.json"), "utf8"));
    expect(Object.keys(settings.mcpServers)).toEqual(["claude-mem"]);
  });

  test("credentialsSource: copies .credentials.json into runtime", async () => {
    const credSrc = join(root, "creds");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(credSrc, { recursive: true });
    await writeFile(join(credSrc, ".credentials.json"), '{"claudeAiOauth":{"token":"abc"}}');

    const out = await materializeRuntime({
      profile: sampleProfile,
      agent: "claude-code",
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id) => `/fake/source/${id}`,
      mcpRegistry: { "claude-mem": { command: "claude-mem" } },
      userClaudeMd: "",
      credentialsSource: credSrc,
    });

    const copied = await readFile(join(out.runtimeDir, ".credentials.json"), "utf8");
    expect(copied).toBe('{"claudeAiOauth":{"token":"abc"}}');
  });

  test("credentialsSource: merges existing settings.json (preserves permissions)", async () => {
    const credSrc = join(root, "creds");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(credSrc, { recursive: true });
    await writeFile(
      join(credSrc, "settings.json"),
      JSON.stringify({
        permissions: { allow: ["Bash(*)"], defaultMode: "auto" },
        trustedDirectories: ["/home/user/work"],
        skipAutoPermissionPrompt: true,
        enabledPlugins: { "existing@marketplace": true },
        mcpServers: { existingMcp: { command: "x" } },
      }),
    );

    const out = await materializeRuntime({
      profile: sampleProfile,
      agent: "claude-code",
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id) => `/fake/source/${id}`,
      mcpRegistry: { "claude-mem": { command: "claude-mem" } },
      userClaudeMd: "",
      credentialsSource: credSrc,
    });

    const settings = JSON.parse(await readFile(join(out.runtimeDir, "settings.json"), "utf8"));
    // Account-level settings preserved
    expect(settings.permissions).toEqual({ allow: ["Bash(*)"], defaultMode: "auto" });
    expect(settings.trustedDirectories).toEqual(["/home/user/work"]);
    expect(settings.skipAutoPermissionPrompt).toBe(true);
    // Profile plugins/mcps merged on top
    expect(settings.enabledPlugins).toEqual({
      "existing@marketplace": true,
      "frontend-design@claude-plugins-official": true,
    });
    expect(settings.mcpServers).toEqual({
      existingMcp: { command: "x" },
      "claude-mem": { command: "claude-mem" },
    });
  });

  test("credentialsSource: refreshes credentials AND settings on cache hit", async () => {
    const credSrcA = join(root, "credsA");
    const credSrcB = join(root, "credsB");
    const { mkdir, writeFile, copyFile: _ } = await import("node:fs/promises");
    await mkdir(credSrcA, { recursive: true });
    await mkdir(credSrcB, { recursive: true });
    await writeFile(join(credSrcA, ".credentials.json"), '{"token":"A"}');
    await writeFile(join(credSrcB, ".credentials.json"), '{"token":"B"}');
    await writeFile(
      join(credSrcA, "settings.json"),
      JSON.stringify({ permissions: { allow: ["A"] } }),
    );
    await writeFile(
      join(credSrcB, "settings.json"),
      JSON.stringify({ permissions: { allow: ["B"] } }),
    );

    const args = {
      profile: sampleProfile,
      agent: "claude-code" as const,
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id: string) => `/fake/source/${id}`,
      mcpRegistry: { "claude-mem": { command: "claude-mem" } },
      userClaudeMd: "",
    };

    // First launch with account A → builds runtime with A's creds + settings
    const first = await materializeRuntime({ ...args, credentialsSource: credSrcA });
    expect(first.rebuilt).toBe(true);
    expect(await readFile(join(first.runtimeDir, ".credentials.json"), "utf8")).toBe('{"token":"A"}');
    let s1 = JSON.parse(await readFile(join(first.runtimeDir, "settings.json"), "utf8"));
    expect(s1.permissions.allow).toEqual(["A"]);

    // Second launch with account B (same profile) → hash matches → cache hit,
    // but credentials AND settings should both refresh from B.
    const second = await materializeRuntime({ ...args, credentialsSource: credSrcB });
    expect(second.rebuilt).toBe(false);
    expect(await readFile(join(second.runtimeDir, ".credentials.json"), "utf8")).toBe('{"token":"B"}');
    let s2 = JSON.parse(await readFile(join(second.runtimeDir, "settings.json"), "utf8"));
    expect(s2.permissions.allow).toEqual(["B"]);
  });

  test("CLAUDE.md stamp uses real ISO timestamp, not literal $(date)", async () => {
    const out = await materializeRuntime({
      profile: sampleProfile,
      agent: "claude-code",
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id) => `/fake/source/${id}`,
      mcpRegistry: {},
      userClaudeMd: "",
    });
    const claudemd = await readFile(join(out.runtimeDir, "CLAUDE.md"), "utf8");
    expect(claudemd).not.toContain("$(date)");
    expect(claudemd).toMatch(/generated \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
