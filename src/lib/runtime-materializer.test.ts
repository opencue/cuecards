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

  test("credentialsSource: copies .credentials.json into runtime (token refreshes stay local)", async () => {
    const credSrc = join(root, "creds");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { lstat } = await import("node:fs/promises");
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

    // Should be a regular file (copy), not a symlink — Claude Code's token
    // refresh does atomic write (tmp → rename) which breaks symlinks.
    const st = await lstat(join(out.runtimeDir, ".credentials.json"));
    expect(st.isSymbolicLink()).toBe(false);
    expect(st.isFile()).toBe(true);
    // Contents match the source
    const contents = await readFile(join(out.runtimeDir, ".credentials.json"), "utf8");
    expect(contents).toBe('{"claudeAiOauth":{"token":"abc"}}');
  });

  test("credentialsSource: overlays sessions/, projects/, history.jsonl, etc.", async () => {
    const credSrc = join(root, "creds");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { readlink } = await import("node:fs/promises");
    await mkdir(join(credSrc, "sessions"), { recursive: true });
    await mkdir(join(credSrc, "projects"), { recursive: true });
    await writeFile(join(credSrc, "history.jsonl"), '{"sess":1}\n');
    await writeFile(join(credSrc, ".session-stats.json"), '{"x":1}');
    await writeFile(join(credSrc, ".credentials.json"), '{"token":"a"}');
    // cue-managed files in source MUST NOT be symlinked (cue overrides them).
    await writeFile(join(credSrc, "settings.json"), JSON.stringify({ permissions: { allow: [] } }));

    const out = await materializeRuntime({
      profile: sampleProfile,
      agent: "claude-code",
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id) => `/fake/source/${id}`,
      mcpRegistry: { "claude-mem": { command: "claude-mem" } },
      userClaudeMd: "",
      credentialsSource: credSrc,
    });

    // Source state symlinked through
    expect(await readlink(join(out.runtimeDir, "sessions"))).toBe(join(credSrc, "sessions"));
    expect(await readlink(join(out.runtimeDir, "projects"))).toBe(join(credSrc, "projects"));
    expect(await readlink(join(out.runtimeDir, "history.jsonl"))).toBe(join(credSrc, "history.jsonl"));
    expect(await readlink(join(out.runtimeDir, ".session-stats.json"))).toBe(join(credSrc, ".session-stats.json"));

    // .credentials.json is COPIED (not symlinked) because Claude Code's
    // token refresh does atomic write which breaks symlinks.
    const { lstat: lstatCred } = await import("node:fs/promises");
    const credSt = await lstatCred(join(out.runtimeDir, ".credentials.json"));
    expect(credSt.isSymbolicLink()).toBe(false);
    expect(credSt.isFile()).toBe(true);

    // settings.json is cue-managed: NOT a symlink, but a real merged file.
    const { lstat } = await import("node:fs/promises");
    const st = await lstat(join(out.runtimeDir, "settings.json"));
    expect(st.isSymbolicLink()).toBe(false);
    expect(st.isFile()).toBe(true);
  });

  test("credentialsSource: preserves account-level settings but isolates MCPs + plugins per profile", async () => {
    const credSrc = join(root, "creds");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(credSrc, { recursive: true });
    await writeFile(
      join(credSrc, "settings.json"),
      JSON.stringify({
        permissions: { allow: ["Bash(*)"], defaultMode: "auto" },
        trustedDirectories: ["/home/user/work"],
        skipAutoPermissionPrompt: true,
        // These two MUST NOT leak into the profile runtime — the profile is
        // the sole source of truth for MCPs + plugins. Otherwise every MCP
        // the user has registered globally appears in EVERY profile, defeating
        // isolation. Pinned by this test (regression: profiles like
        // `cybersecurity` with `mcps: []` were inheriting random user-scoped
        // MCPs like `teherguminet-admin` because of the merge).
        enabledPlugins: { "user-globally-installed@marketplace": true },
        mcpServers: { userGloballyInstalledMcp: { command: "x" } },
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
    // Account-level settings preserved (these are user-scoped, not profile-scoped)
    expect(settings.permissions).toEqual({ allow: ["Bash(*)"], defaultMode: "auto" });
    expect(settings.trustedDirectories).toEqual(["/home/user/work"]);
    expect(settings.skipAutoPermissionPrompt).toBe(true);
    // Profile plugins/mcps are EXCLUSIVE — only what the profile declared.
    // The account-level entries from the source settings.json must NOT leak.
    expect(settings.enabledPlugins).toEqual({
      "frontend-design@claude-plugins-official": true,
    });
    expect(settings.mcpServers).toEqual({
      "claude-mem": { command: "claude-mem" },
    });
  });

  test("credentialsSource: refreshes settings on cache hit + repoints symlinks on account switch", async () => {
    const credSrcA = join(root, "credsA");
    const credSrcB = join(root, "credsB");
    const { mkdir, writeFile, readlink } = await import("node:fs/promises");
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
    // .credentials.json is a copy, not a symlink
    const contentsA = await readFile(join(first.runtimeDir, ".credentials.json"), "utf8");
    expect(contentsA).toBe('{"token":"A"}');
    let s1 = JSON.parse(await readFile(join(first.runtimeDir, "settings.json"), "utf8"));
    expect(s1.permissions.allow).toEqual(["A"]);

    // Second launch with account B (same profile) → hash matches → cache hit.
    // Settings rebuilt from B; .credentials.json re-copied from B.
    const second = await materializeRuntime({ ...args, credentialsSource: credSrcB });
    expect(second.rebuilt).toBe(false);
    const contentsB = await readFile(join(second.runtimeDir, ".credentials.json"), "utf8");
    expect(contentsB).toBe('{"token":"B"}');
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

  // ---------------------------------------------------------------------------
  // Rules / commands / hooks — ECC-derived resource paths
  // ---------------------------------------------------------------------------

  test("commands: symlinks each ref into commands/ and lists them in CLAUDE.md", async () => {
    // Materializer resolves command refs against <repo>/resources/commands/<ref>.md
    // — we already vendor a few of these, so use a known-good one.
    const profile: ResolvedProfile = {
      ...sampleProfile,
      name: "test-cmds",
      inheritanceChain: ["test-cmds"],
      rules: [], hooks: [],
      commands: ["code-review", "checkpoint"],
    };
    const out = await materializeRuntime({
      profile, agent: "claude-code",
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id) => `/fake/source/${id}`,
      mcpRegistry: {},
      userClaudeMd: "",
    });
    const cmdLink = await readlink(join(out.runtimeDir, "commands", "code-review.md"));
    expect(cmdLink).toContain("resources/commands/code-review.md");
    const claudemd = await readFile(join(out.runtimeDir, "CLAUDE.md"), "utf8");
    expect(claudemd).toContain("## Available Commands");
    expect(claudemd).toContain("/code-review");
    expect(claudemd).toContain("/checkpoint");
  });

  test("rules: symlinks into rules/ + writes index (NOT inlined bodies)", async () => {
    const profile: ResolvedProfile = {
      ...sampleProfile,
      name: "test-rules",
      inheritanceChain: ["test-rules"],
      commands: [], hooks: [],
      rules: ["common/security", "common/testing"],
    };
    const out = await materializeRuntime({
      profile, agent: "claude-code",
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id) => `/fake/source/${id}`,
      mcpRegistry: {},
      userClaudeMd: "",
    });
    const link = await readlink(join(out.runtimeDir, "rules", "security.md"));
    expect(link).toContain("resources/rules/common/security.md");
    const claudemd = await readFile(join(out.runtimeDir, "CLAUDE.md"), "utf8");
    // Index reference present, but the rule body must NOT be inlined — the
    // whole point of the symlink-only approach is to skip the token bleed.
    expect(claudemd).toContain("## Rules (2)");
    expect(claudemd).toContain("`rules/security.md`");
    expect(claudemd).not.toMatch(/^## Security Review Triggers/m);
  });

  test("hooks: merges hook JSON into settings.json under matching event keys", async () => {
    const profile: ResolvedProfile = {
      ...sampleProfile,
      name: "test-hooks",
      inheritanceChain: ["test-hooks"],
      rules: [], commands: [],
      hooks: ["bash-quality-preflight.json", "session-summary.json"],
    };
    const out = await materializeRuntime({
      profile, agent: "claude-code",
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id) => `/fake/source/${id}`,
      mcpRegistry: {},
      userClaudeMd: "",
    });
    const settings = JSON.parse(await readFile(join(out.runtimeDir, "settings.json"), "utf8"));
    expect(settings.hooks.PreToolUse).toBeArray();
    expect(settings.hooks.PreToolUse[0].matcher).toBe("Bash");
    expect(settings.hooks.Stop).toBeArray();
    expect(settings.hooks.Stop[0].hooks[0].id).toBe("cue:stop:session-summary");
    // Symlinks also created under hooks/
    const link = await readlink(join(out.runtimeDir, "hooks", "bash-quality-preflight.json"));
    expect(link).toContain("resources/hooks/bash-quality-preflight.json");
  });

  // Claude Code reads MCP servers from .claude.json (top-level `mcpServers`),
  // NOT from settings.json. The materializer must therefore merge profile MCPs
  // into .claude.json — and copy (not symlink) it so mutations don't leak back
  // into the shared account file.
  test("merges profile MCPs into .claude.json + copies (not symlinks) it", async () => {
    const credSrc = join(root, "creds");
    const { mkdir, writeFile, lstat } = await import("node:fs/promises");
    await mkdir(credSrc, { recursive: true });
    await writeFile(
      join(credSrc, ".claude.json"),
      JSON.stringify({
        numStartups: 42,
        oauthAccount: { emailAddress: "u@example.com" },
        mcpServers: { "preexisting": { command: "/bin/pre" } },
      }),
    );

    const out = await materializeRuntime({
      profile: sampleProfile,
      agent: "claude-code",
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id) => `/fake/source/${id}`,
      mcpRegistry: { "claude-mem": { command: "claude-mem", args: [] } },
      userClaudeMd: "",
      credentialsSource: credSrc,
    });

    // Must be a real file, not a symlink — otherwise mutations leak back to
    // the source account file and pollute other profiles sharing the account.
    const st = await lstat(join(out.runtimeDir, ".claude.json"));
    expect(st.isSymbolicLink()).toBe(false);
    expect(st.isFile()).toBe(true);

    // Profile MCPs merged in under top-level `mcpServers`, preserving the
    // source's preexisting entries and other top-level fields.
    const cj = JSON.parse(await readFile(join(out.runtimeDir, ".claude.json"), "utf8"));
    expect(cj.mcpServers["claude-mem"]).toEqual({ command: "claude-mem", args: [] });
    expect(cj.mcpServers["preexisting"]).toEqual({ command: "/bin/pre" });
    expect(cj.numStartups).toBe(42);
    expect(cj.oauthAccount).toEqual({ emailAddress: "u@example.com" });

    // Source .claude.json untouched — proof the copy isolates per-profile writes.
    const src = JSON.parse(await readFile(join(credSrc, ".claude.json"), "utf8"));
    expect(src.mcpServers).toEqual({ "preexisting": { command: "/bin/pre" } });
  });

  // Cache-hit path must also re-sync MCPs into .claude.json, so adding/removing
  // an MCP to a profile takes effect even when the profile hash hasn't changed
  // for unrelated reasons. (In practice, adding an MCP changes the hash — but
  // an account swap with a different source .claude.json triggers a cache hit.)
  test("cache hit: refreshes .claude.json mcpServers from current registry", async () => {
    const credSrc = join(root, "creds");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(credSrc, { recursive: true });
    await writeFile(join(credSrc, ".claude.json"), JSON.stringify({ numStartups: 1 }));

    const args = {
      profile: sampleProfile,
      agent: "claude-code" as const,
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id: string) => `/fake/source/${id}`,
      mcpRegistry: { "claude-mem": { command: "claude-mem-v1" } },
      userClaudeMd: "",
      credentialsSource: credSrc,
    };
    await materializeRuntime(args);

    // Second build: same profile (hash hit) but registry changed.
    const second = await materializeRuntime({
      ...args,
      mcpRegistry: { "claude-mem": { command: "claude-mem-v2" } },
    });
    expect(second.rebuilt).toBe(false);

    const cj = JSON.parse(await readFile(join(second.runtimeDir, ".claude.json"), "utf8"));
    expect(cj.mcpServers["claude-mem"]).toEqual({ command: "claude-mem-v2" });
  });

  test("missing rule/command/hook ref is non-fatal", async () => {
    const profile: ResolvedProfile = {
      ...sampleProfile,
      name: "test-missing",
      inheritanceChain: ["test-missing"],
      rules: ["does/not/exist"],
      commands: ["ghost-command"],
      hooks: ["nope.json"],
    };
    const out = await materializeRuntime({
      profile, agent: "claude-code",
      runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id) => `/fake/source/${id}`,
      mcpRegistry: {},
      userClaudeMd: "",
    });
    expect(out.rebuilt).toBe(true);
    // No symlinks created for missing refs — directories may exist but be empty.
    const settings = JSON.parse(await readFile(join(out.runtimeDir, "settings.json"), "utf8"));
    expect(settings.hooks).toBeUndefined();
  });
});
