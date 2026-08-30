/**
 * Tests for `cue install`. The command defaults to dry-run, so these never
 * write real runtimes or execute package managers.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { run as installRun } from "./install";

async function capture<T>(fn: () => Promise<T>): Promise<{ stdout: string; stderr: string; value: T }> {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";
  (process.stdout as any).write = (c: string | Uint8Array) => { stdout += String(c); return true; };
  (process.stderr as any).write = (c: string | Uint8Array) => { stderr += String(c); return true; };
  try {
    const value = await fn();
    return { stdout, stderr, value };
  } finally {
    (process.stdout as any).write = origOut;
    (process.stderr as any).write = origErr;
  }
}

const envKeys = ["XDG_CONFIG_HOME", "CUE_PROFILES_DIR", "SOUL_PROFILES_DIR"] as const;
const oldEnv = new Map<string, string | undefined>();
for (const key of envKeys) oldEnv.set(key, process.env[key]);

afterEach(() => {
  for (const key of envKeys) {
    const value = oldEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("cue install", () => {
  test("dry-run JSON plans Claude and Codex runtimes for an explicit profile", async () => {
    const root = mkdtempSync(join(tmpdir(), "cue-install-test-"));
    process.env.XDG_CONFIG_HOME = root;
    try {
      const { stdout, value } = await capture(() => installRun(["core", "--json"]));
      expect(value).toBe(0);
      const out = JSON.parse(stdout) as {
        dryRun: boolean;
        profiles: string[];
        agents: string[];
        actions: Array<{ profile: string; agent: string; targetDir: string; status: string }>;
      };
      expect(out.dryRun).toBe(true);
      expect(out.profiles).toEqual(["core"]);
      expect(out.agents).toEqual(["claude-code", "codex"]);
      expect(out.actions.map((a) => [a.profile, a.agent, a.status])).toEqual([
        ["core", "claude-code", "planned"],
        ["core", "codex", "planned"],
      ]);
      expect(out.actions[0]!.targetDir).toContain(join(root, "cue", "runtime", "core"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("--all-profiles uses the configured profile directory in dry-run", async () => {
    const root = mkdtempSync(join(tmpdir(), "cue-install-test-"));
    const profiles = join(root, "profiles");
    mkdirSync(join(profiles, "alpha"), { recursive: true });
    mkdirSync(join(profiles, "beta"), { recursive: true });
    writeFileSync(join(profiles, "alpha", "profile.yaml"), "name: alpha\ndescription: Alpha profile\n");
    writeFileSync(join(profiles, "beta", "profile.yaml"), "name: beta\ndescription: Beta profile\n");
    process.env.CUE_PROFILES_DIR = profiles;
    process.env.XDG_CONFIG_HOME = root;
    try {
      const { stdout, value } = await capture(() => installRun(["--all-profiles", "--agents", "claude", "--json"]));
      expect(value).toBe(0);
      const out = JSON.parse(stdout) as {
        profiles: string[];
        agents: string[];
        actions: Array<{ profile: string; agent: string; status: string }>;
      };
      expect(out.profiles).toEqual(["alpha", "beta"]);
      expect(out.agents).toEqual(["claude-code"]);
      expect(out.actions).toHaveLength(2);
      expect(out.actions.every((a) => a.status === "planned")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("--with-clis --json includes CLI plans without executing installers", async () => {
    const root = mkdtempSync(join(tmpdir(), "cue-install-test-"));
    process.env.XDG_CONFIG_HOME = root;
    try {
      const { stdout, value } = await capture(() => installRun(["core", "--with-clis", "--json"]));
      expect(value).toBe(0);
      const out = JSON.parse(stdout) as {
        dryRun: boolean;
        cliResults: Array<{ profile: string; code: number; plan?: { plans?: unknown[]; text?: string } }>;
      };
      expect(out.dryRun).toBe(true);
      expect(out.cliResults).toHaveLength(1);
      expect(out.cliResults[0]!.profile).toBe("core");
      expect(out.cliResults[0]!.code).toBe(0);
      expect(out.cliResults[0]!.plan?.plans || out.cliResults[0]!.plan?.text).toBeTruthy();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("external agents require explicit scope and stay dry-run by default", async () => {
    const root = mkdtempSync(join(tmpdir(), "cue-install-test-"));
    const target = join(root, "target");
    process.env.XDG_CONFIG_HOME = root;
    try {
      const { stdout, value } = await capture(() => installRun(["core", "--agents", "cursor", "--dir", target, "--json"]));
      expect(value).toBe(0);
      const out = JSON.parse(stdout) as {
        dryRun: boolean;
        agents: string[];
        actions: Array<{ agent: string; targetDir: string; status: string }>;
      };
      expect(out.dryRun).toBe(true);
      expect(out.agents).toEqual(["cursor"]);
      expect(out.actions[0]).toMatchObject({ agent: "cursor", targetDir: target, status: "planned" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("doctor JSON reports profile runtime checks", async () => {
    const root = mkdtempSync(join(tmpdir(), "cue-install-test-"));
    process.env.XDG_CONFIG_HOME = root;
    try {
      const { stdout } = await capture(() => installRun(["doctor", "core", "--json"]));
      const out = JSON.parse(stdout) as { reports: Array<{ profile: string; agent: string; missingMcps: string[] }> };
      expect(out.reports.length).toBeGreaterThan(0);
      expect(out.reports[0]!.profile).toBe("core");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("repo installer dry-run describes clone without network", async () => {
    const root = mkdtempSync(join(tmpdir(), "cue-install-test-"));
    process.env.XDG_CONFIG_HOME = root;
    try {
      const { stdout, value } = await capture(() => installRun(["repo", "garrytan/gstack", "--profile", "maker", "--json"]));
      expect(value).toBe(0);
      const out = JSON.parse(stdout) as { dryRun: boolean; repo: string; profile: string; discoveredSkills: string[] };
      expect(out.dryRun).toBe(true);
      expect(out.repo).toBe("garrytan/gstack");
      expect(out.profile).toBe("maker");
      expect(out.discoveredSkills).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("repo installer accepts flags before the repo argument", async () => {
    const root = mkdtempSync(join(tmpdir(), "cue-install-test-"));
    process.env.XDG_CONFIG_HOME = root;
    try {
      const { stdout, value } = await capture(() => installRun(["repo", "--profile", "maker", "garrytan/gstack", "--json"]));
      expect(value).toBe(0);
      const out = JSON.parse(stdout) as { repo: string; profile: string };
      expect(out.repo).toBe("garrytan/gstack");
      expect(out.profile).toBe("maker");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("missing profile context returns a usage-level error", async () => {
    const cwd = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), "cue-install-cwd-"));
    const configRoot = mkdtempSync(join(tmpdir(), "cue-install-empty-config-"));
    try {
      process.env.XDG_CONFIG_HOME = configRoot;
      process.chdir(dir);
      const { stderr, value } = await capture(() => installRun(["--json"]));
      expect(value).toBe(1);
      expect(stderr).toContain("no active profile");
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
      rmSync(configRoot, { recursive: true, force: true });
    }
  });
});
