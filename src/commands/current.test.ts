import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../index.ts", import.meta.url));

function fixture(heavy = false) {
  const root = mkdtempSync(join(tmpdir(), "cue-current-plan-"));
  const cwd = join(root, "project");
  mkdirSync(cwd);
  const xdg = join(root, "config");
  const write = (relative: string, value: string) => {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value);
  };
  const extra = Array.from({ length: 25 }, (_, i) => `    - unrelated/tool-${i}`);
  write("profiles/schema.json", readFileSync(new URL("../../profiles/schema.json", import.meta.url), "utf8"));
  write("profiles/core/profile.yaml", `name: core
description: Fixture profile
agents: [claude-code, codex]
skills:
  local:
    - dev/shared
    - id: dev/claude-only
      agents: [claude-code]
    - id: dev/conditional
      when: { has_file: activate }
    - dev/missing
${heavy ? extra.join("\n") : ""}
  npx:
    - repo: example/unfetched
      skills: [remote]
mcps:
  - fixture-mcp
  - id: gated
    when: { env: FIXTURE_ABSENT }
rules: [shared, missing]
`);
  write("profiles/ponytail/profile.yaml", `name: ponytail
description: Codex default fixture
agents: [codex]
skills:
  npx:
    - repo: DietrichGebert/ponytail
      agents: [codex]
      skills: [ponytail]
`);
  write("resources/skills/skills/dev/shared/SKILL.md", "# Shared");
  write("resources/skills/skills/dev/claude-only/SKILL.md", "# Claude only");
  write("resources/skills/skills/dev/conditional/SKILL.md", "# Conditional");
  write("resources/rules/shared.md", "# Shared rule");
  write("resources/mcps/configs/claude.sanitized.json", JSON.stringify({
    servers: { "fixture-mcp": { command: process.execPath, env: { SECRET: "not-public" } } },
  }));
  write("project/.git/HEAD", "ref: refs/heads/main\n");
  const run = (...args: string[]) => {
    const result = Bun.spawnSync([process.execPath, entry, "current", ...args], {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        XDG_CONFIG_HOME: xdg,
        XDG_CACHE_HOME: join(root, "cache"),
        CUE_REPO_ROOT: root,
        CUE_PROFILES_DIR: join(root, "profiles"),
      },
    });
    return { code: result.exitCode, output: result.stdout.toString(), error: result.stderr.toString() };
  };
  return { root, cwd, write, run, clean: () => rmSync(root, { recursive: true, force: true }) };
}

test("plans a pinned profile for both agents from a fresh repo without installing or writing", () => {
  const f = fixture();
  try {
    f.write("project/.cue.profile", "core\n");
    const result = f.run("--plan", "--json");
    expect(result.error).toBe("");
    const plan = JSON.parse(result.output);
    expect(plan).toMatchObject({ source: "pin-file", profile: "core", pinPath: join(f.cwd, ".cue.profile") });
    expect(plan.agents["claude-code"]).toMatchObject({
      skills: [
        { id: "dev/shared", status: "ready" },
        { id: "dev/claude-only", status: "ready" },
        { id: "dev/conditional", status: "inactive" },
        { id: "dev/missing", status: "missing" },
        { id: "remote", status: "remote", repo: "example/unfetched" },
      ],
      mcps: [{ id: "fixture-mcp", status: "ready" }, { id: "gated", status: "inactive" }],
    });
    expect(plan.agents.codex.skills.map((skill: { id: string }) => skill.id))
      .toEqual(["dev/shared", "dev/conditional", "dev/missing", "remote", "ponytail"]);
    expect(plan.agents.codex.mcps[0]).toEqual({ id: "fixture-mcp", status: "missing" });
    expect(plan.rules).toEqual([{ id: "shared", status: "ready" }, { id: "missing", status: "missing" }]);
    expect(result.output).not.toContain("not-public");
    expect(readdirSync(f.root).sort()).toEqual(["profiles", "project", "resources"]);
    expect(readdirSync(f.cwd).sort()).toEqual([".cue.profile", ".git"]);
  } finally {
    f.clean();
  }
});

test("can preview an unpinned profile and a single agent, without creating a pin or loadout cache", () => {
  const f = fixture(true);
  try {
    expect(f.run("--plan").output).toContain("No profile selected");
    f.write("project/activate", "");
    const result = f.run("--plan", "--profile", "core", "--agent", "claude", "--json");
    expect(result.error).toBe("");
    const plan = JSON.parse(result.output);
    expect(plan.source).toBe("flag");
    expect(Object.keys(plan.agents)).toEqual(["claude-code"]);
    expect(plan.agents["claude-code"].skills).toContainEqual({ id: "dev/conditional", status: "ready" });
    expect(plan.agents["claude-code"].skills).toContainEqual({ id: "unrelated/tool-0", status: "deferred" });
    expect(f.run("--plan", "--agent", "invalid").code).toBe(1);
    expect(readdirSync(f.root).sort()).toEqual(["profiles", "project", "resources"]);
    expect(readdirSync(f.cwd).sort()).toEqual([".git", "activate"]);
  } finally {
    f.clean();
  }
});
