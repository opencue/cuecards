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
});
