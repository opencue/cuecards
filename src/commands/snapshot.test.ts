import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

import { loadProfile } from "../lib/profile-loader";
import { run } from "./snapshot";

let root: string;
let project: string;
let profiles: string;
let previousCwd: string;
let previousProfilesDir: string | undefined;
let stderr = "";
let originalStdout: typeof process.stdout.write;
let originalStderr: typeof process.stderr.write;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cue-snapshot-"));
  project = join(root, "project");
  profiles = join(root, "profiles");
  mkdirSync(project, { recursive: true });
  mkdirSync(profiles, { recursive: true });
  previousCwd = process.cwd();
  previousProfilesDir = process.env.CUE_PROFILES_DIR;
  process.env.CUE_PROFILES_DIR = profiles;
  process.chdir(project);

  stderr = "";
  originalStdout = process.stdout.write.bind(process.stdout);
  originalStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stdout.write = originalStdout;
  process.stderr.write = originalStderr;
  process.chdir(previousCwd);
  if (previousProfilesDir === undefined) delete process.env.CUE_PROFILES_DIR;
  else process.env.CUE_PROFILES_DIR = previousProfilesDir;
  rmSync(root, { recursive: true, force: true });
});

function writeProfile(name: string, yaml: string): void {
  const dir = join(profiles, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "profile.yaml"), yaml);
}

describe("cue snapshot", () => {
  test("exports the complete flattened profile with the package version", async () => {
    writeProfile(
      "base-profile",
      `name: base-profile
description: Base
skills:
  local:
    - id: base-skill
      agents: [claude-code]
rules: [coding-style]
commands: [verify]
persona_includes: [integrity-protocol]
`,
    );
    writeProfile(
      "source-profile",
      `name: source-profile
description: Source
inherits: base-profile
agents: [claude-code, codex]
skills:
  local:
    - child-skill
  npx:
    - repo: owner/repo
      pin: git@abc123
      skills: [remote-skill]
mcps:
  - id: github
    pin: true
plugins: [sample@marketplace]
env:
  DEMO: "yes"
codex_config:
  sandbox_mode: workspace-write
hooks: [session-summary]
subagents: [tester]
persona: You are a test profile.
playbooks: [sprint]
qualityGates: [tests-pass]
evals: [smoke]
codex:
  approval_policy: never
persona_routing:
  - phrase: run tests
    skill: child-skill
`,
    );
    writeFileSync(join(project, ".cue.profile"), "source-profile\n");
    const snapshotFile = join(root, "snapshot.yaml");

    expect(await run(["--output", snapshotFile])).toBe(0);

    const document = parse(readFileSync(snapshotFile, "utf8")) as any;
    const packageVersion = JSON.parse(
      readFileSync(join(previousCwd, "package.json"), "utf8"),
    ).version;
    expect(document._snapshot.cue_version).toBe(packageVersion);
    expect(document._snapshot.inheritanceChain).toEqual([
      "base-profile",
      "source-profile",
    ]);
    expect(document.profile.inherits).toBeUndefined();
    expect(document.profile.skills.local.map((s: any) => s.id)).toEqual([
      "base-skill",
      "child-skill",
    ]);
    expect(document.profile.skills.npx[0].repo).toBe("owner/repo");
    expect(document.profile.rules).toEqual(["coding-style"]);
    expect(document.profile.commands).toEqual(["verify"]);
    expect(document.profile.hooks).toEqual(["session-summary"]);
    expect(document.profile.subagents).toEqual(["tester"]);
    expect(document.profile.qualityGates).toEqual(["tests-pass"]);
    expect(document.profile.codex.approval_policy).toBe("never");
    expect(document.profile.codex_config.sandbox_mode).toBe("workspace-write");
  });

  test("restores every snapshot profile field into the configured profiles dir", async () => {
    const file = join(root, "restore.yaml");
    writeFileSync(
      file,
      `profile:
  name: restored-profile
  description: Restored
  agents: [codex]
  skills:
    local: [one]
    npx:
      - repo: owner/repo
        skills: [two]
  rules: [coding-style]
  commands: [verify]
  hooks: [session-summary]
  qualityGates: [tests-pass]
  codex:
    approval_policy: never
`,
    );

    expect(await run(["restore", file])).toBe(0);

    const restored = parse(
      readFileSync(join(profiles, "restored-profile", "profile.yaml"), "utf8"),
    ) as any;
    expect(restored.skills.npx[0].repo).toBe("owner/repo");
    expect(restored.rules).toEqual(["coding-style"]);
    expect(restored.commands).toEqual(["verify"]);
    expect(restored.hooks).toEqual(["session-summary"]);
    expect(restored.qualityGates).toEqual(["tests-pass"]);
    expect(restored.codex.approval_policy).toBe("never");
    const resolved = await loadProfile("restored-profile");
    expect(resolved.rules).toEqual(["coding-style"]);
    expect(resolved.skills.npx[0]?.repo).toBe("owner/repo");
  });

  test("rejects a traversal name before creating a profile directory", async () => {
    const file = join(root, "unsafe.yaml");
    writeFileSync(
      file,
      "profile:\n  name: ../escape\n  description: Unsafe\n",
    );

    expect(await run(["restore", file])).toBe(1);
    expect(stderr).toContain("lowercase kebab-case");
    expect(existsSync(join(root, "escape", "profile.yaml"))).toBe(false);
  });
});
