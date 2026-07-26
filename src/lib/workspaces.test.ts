import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  computeOverrides,
  exportWorkspace,
  getActiveWorkspace,
  getWorkspace,
  hasWorkspaces,
  importWorkspace,
  listWorkspaceIds,
  loadWorkspaces,
  resolveWorkspaceForCwd,
  saveWorkspace,
  setActiveWorkspace,
} from "./workspaces";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
// profilesDir() reads CUE_PROFILES_DIR at call time (lazy getter).
// configBase() reads XDG_CONFIG_HOME for active/shared workspace paths.

let scratchProfiles: string; // CUE_PROFILES_DIR
let scratchConfig: string;   // XDG_CONFIG_HOME
let prevProfiles: string | undefined;
let prevXdg: string | undefined;

beforeEach(() => {
  prevProfiles = process.env.CUE_PROFILES_DIR;
  prevXdg = process.env.XDG_CONFIG_HOME;

  scratchProfiles = mkdtempSync(join(tmpdir(), "cue-ws-profiles-"));
  scratchConfig = mkdtempSync(join(tmpdir(), "cue-ws-config-"));

  process.env.CUE_PROFILES_DIR = scratchProfiles;
  process.env.XDG_CONFIG_HOME = scratchConfig;
});

afterEach(() => {
  if (prevProfiles === undefined) delete process.env.CUE_PROFILES_DIR;
  else process.env.CUE_PROFILES_DIR = prevProfiles;

  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;

  for (const dir of [scratchProfiles, scratchConfig]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a workspaces.yaml under <scratchProfiles>/<profile>/workspaces.yaml. */
function writeWorkspacesYaml(profile: string, body: string): void {
  const dir = join(scratchProfiles, profile);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "workspaces.yaml"), body, "utf8");
}

/** Return a minimal valid workspaces YAML string. */
const MINIMAL_YAML = `
workspaces:
  acme:
    name: Acme Corp
    description: Test client
    env:
      SHOP_URL: https://acme.example.com
  beta:
    name: Beta Client
    skills:
      - medusa/building-with-medusa
`.trimStart();

// ---------------------------------------------------------------------------
// hasWorkspaces
// ---------------------------------------------------------------------------

describe("hasWorkspaces", () => {
  test("returns false when no workspaces.yaml exists for the profile", () => {
    expect(hasWorkspaces("no-such-profile")).toBe(false);
  });

  test("returns true when workspaces.yaml exists", () => {
    writeWorkspacesYaml("myprofile", MINIMAL_YAML);
    expect(hasWorkspaces("myprofile")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadWorkspaces
// ---------------------------------------------------------------------------

describe("loadWorkspaces", () => {
  test("returns null when no file exists and shared dir is absent", () => {
    expect(loadWorkspaces("ghost")).toBeNull();
  });

  test("parses a valid workspaces.yaml", () => {
    writeWorkspacesYaml("dev", MINIMAL_YAML);
    const config = loadWorkspaces("dev");
    expect(config).not.toBeNull();
    expect(config!.workspaces["acme"]!.name).toBe("Acme Corp");
    expect(config!.workspaces["acme"]!.env!["SHOP_URL"]).toBe("https://acme.example.com");
    expect(config!.workspaces["beta"]!.skills).toEqual(["medusa/building-with-medusa"]);
  });

  test("returns null on malformed YAML", () => {
    writeWorkspacesYaml("bad", "workspaces:\n  key: : unbalanced [{\n");
    expect(loadWorkspaces("bad")).toBeNull();
  });

  test("merges shared workspaces when shared dir exists", () => {
    // No profile-level workspaces.yaml — only a shared workspace file.
    const sharedDir = join(scratchConfig, "cue", "workspaces", "shared");
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(
      join(sharedDir, "shared-ws.yaml"),
      "name: Shared WS\ndescription: available everywhere\n",
      "utf8",
    );
    const config = loadWorkspaces("emptyprofile");
    expect(config).not.toBeNull();
    expect(config!.workspaces["shared-ws"]!.name).toBe("Shared WS");
  });

  test("profile-specific workspace takes precedence over shared", () => {
    // Profile defines "overlap"; shared also defines "overlap".
    writeWorkspacesYaml(
      "myprofile",
      "workspaces:\n  overlap:\n    name: Profile Version\n",
    );
    const sharedDir = join(scratchConfig, "cue", "workspaces", "shared");
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(
      join(sharedDir, "overlap.yaml"),
      "name: Shared Version\n",
      "utf8",
    );
    const config = loadWorkspaces("myprofile");
    expect(config!.workspaces["overlap"]!.name).toBe("Profile Version");
  });
});

// ---------------------------------------------------------------------------
// listWorkspaceIds
// ---------------------------------------------------------------------------

describe("listWorkspaceIds", () => {
  test("returns [] when no workspaces config exists", () => {
    expect(listWorkspaceIds("nonexistent")).toEqual([]);
  });

  test("returns the workspace ids from the config", () => {
    writeWorkspacesYaml("dev", MINIMAL_YAML);
    expect(listWorkspaceIds("dev").sort()).toEqual(["acme", "beta"]);
  });
});

// ---------------------------------------------------------------------------
// getWorkspace
// ---------------------------------------------------------------------------

describe("getWorkspace", () => {
  test("returns null when the profile has no workspaces", () => {
    expect(getWorkspace("ghost", "acme")).toBeNull();
  });

  test("returns null for an unknown workspace id", () => {
    writeWorkspacesYaml("dev", MINIMAL_YAML);
    expect(getWorkspace("dev", "unknown-ws")).toBeNull();
  });

  test("returns the workspace object for a known id", () => {
    writeWorkspacesYaml("dev", MINIMAL_YAML);
    const ws = getWorkspace("dev", "acme");
    expect(ws).not.toBeNull();
    expect(ws!.name).toBe("Acme Corp");
    expect(ws!.description).toBe("Test client");
  });
});

// ---------------------------------------------------------------------------
// getActiveWorkspace / setActiveWorkspace
// ---------------------------------------------------------------------------

describe("getActiveWorkspace", () => {
  test("returns null when no active file exists", () => {
    expect(getActiveWorkspace("myprofile")).toBeNull();
  });

  test("returns the trimmed workspace id from the active file", () => {
    setActiveWorkspace("myprofile", "acme");
    expect(getActiveWorkspace("myprofile")).toBe("acme");
  });

  test("trims trailing whitespace from the stored value", () => {
    // Write the file manually with trailing newline.
    const dir = join(scratchConfig, "cue", "workspaces");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "myprofile.active"), "acme\n", "utf8");
    expect(getActiveWorkspace("myprofile")).toBe("acme");
  });
});

describe("setActiveWorkspace", () => {
  test("creates parent directories and writes the workspace id", () => {
    // The cue/workspaces/ subtree should not exist yet.
    expect(existsSync(join(scratchConfig, "cue", "workspaces"))).toBe(false);
    setActiveWorkspace("myprofile", "beta");
    expect(getActiveWorkspace("myprofile")).toBe("beta");
  });

  test("overwrites an existing active workspace", () => {
    setActiveWorkspace("myprofile", "acme");
    setActiveWorkspace("myprofile", "beta");
    expect(getActiveWorkspace("myprofile")).toBe("beta");
  });
});

// ---------------------------------------------------------------------------
// resolveWorkspaceForCwd
// ---------------------------------------------------------------------------

describe("resolveWorkspaceForCwd", () => {
  // Helper: create a workspaces.yaml that declares "ws1", then plant a
  // .cue-workspace file pointing to it inside the given directory.
  function setupProfileWithWorkspace(profile: string, wsId: string): void {
    writeWorkspacesYaml(profile, `workspaces:\n  ${wsId}:\n    name: Test WS\n`);
  }

  test("returns the workspace id when .cue-workspace is in cwd", () => {
    const cwd = mkdtempSync(join(tmpdir(), "cue-ws-cwd-"));
    try {
      setupProfileWithWorkspace("dev", "ws1");
      writeFileSync(join(cwd, ".cue-workspace"), "ws1", "utf8");
      expect(resolveWorkspaceForCwd("dev", cwd)).toBe("ws1");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("returns null when .cue-workspace points to a workspace id not in the profile", () => {
    const cwd = mkdtempSync(join(tmpdir(), "cue-ws-cwd-"));
    try {
      setupProfileWithWorkspace("dev", "ws1");
      writeFileSync(join(cwd, ".cue-workspace"), "unknown-ws", "utf8");
      expect(resolveWorkspaceForCwd("dev", cwd)).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("walks up parent directory to find .cue-workspace", () => {
    const parentDir = mkdtempSync(join(tmpdir(), "cue-ws-parent-"));
    const childDir = join(parentDir, "sub");
    mkdirSync(childDir, { recursive: true });
    try {
      setupProfileWithWorkspace("dev", "ws1");
      writeFileSync(join(parentDir, ".cue-workspace"), "ws1", "utf8");
      // cwd is childDir, file is in parentDir — must walk up one level.
      expect(resolveWorkspaceForCwd("dev", childDir)).toBe("ws1");
    } finally {
      rmSync(parentDir, { recursive: true, force: true });
    }
  });

  test("returns null when no .cue-workspace file is found anywhere in the tree", () => {
    const cwd = mkdtempSync(join(tmpdir(), "cue-ws-cwd-"));
    try {
      setupProfileWithWorkspace("dev", "ws1");
      expect(resolveWorkspaceForCwd("dev", cwd)).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// computeOverrides
// ---------------------------------------------------------------------------

describe("computeOverrides", () => {
  test("returns null when the workspace id does not exist", () => {
    writeWorkspacesYaml("dev", MINIMAL_YAML);
    expect(computeOverrides("dev", "no-such-ws")).toBeNull();
  });

  test("builds env overrides from workspace env block", () => {
    writeWorkspacesYaml("dev", MINIMAL_YAML);
    const result = computeOverrides("dev", "acme");
    expect(result).not.toBeNull();
    expect(result!.env["SHOP_URL"]).toBe("https://acme.example.com");
  });

  test("personaPrefix is empty when workspace has no context field", () => {
    writeWorkspacesYaml("dev", MINIMAL_YAML);
    const result = computeOverrides("dev", "beta");
    expect(result!.personaPrefix).toBe("");
  });

  test("personaPrefix is built from context field when present", () => {
    writeWorkspacesYaml(
      "dev",
      "workspaces:\n  ctx:\n    name: CTX WS\n    context: \"Sell widgets worldwide.\"\n",
    );
    const result = computeOverrides("dev", "ctx");
    expect(result!.personaPrefix).toContain("## Active Workspace: CTX WS");
    expect(result!.personaPrefix).toContain("Sell widgets worldwide.");
  });

  test("secret: prefix falls back to literal value when secret store is absent", () => {
    // XDG_CONFIG_HOME points to scratch; no store file exists → getSecret returns null.
    writeWorkspacesYaml(
      "dev",
      "workspaces:\n  secretws:\n    name: Secret WS\n    env:\n      API_KEY: \"secret:my-token\"\n",
    );
    const result = computeOverrides("dev", "secretws");
    // Falls back to the original literal (secret:my-token).
    expect(result!.env["API_KEY"]).toBe("secret:my-token");
  });

  test("personaOverride is set when workspace defines a persona field", () => {
    writeWorkspacesYaml(
      "dev",
      "workspaces:\n  persona-ws:\n    name: Persona WS\n    persona: \"You are a specialized agent.\"\n",
    );
    const result = computeOverrides("dev", "persona-ws");
    expect(result!.personaOverride).toBe("You are a specialized agent.");
  });

  test("skills are included when workspace defines skills list", () => {
    writeWorkspacesYaml("dev", MINIMAL_YAML);
    const result = computeOverrides("dev", "beta");
    expect(result!.skills).toEqual(["medusa/building-with-medusa"]);
  });

  test("skills is undefined when workspace has no skills field", () => {
    writeWorkspacesYaml("dev", MINIMAL_YAML);
    const result = computeOverrides("dev", "acme");
    expect(result!.skills).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// exportWorkspace / importWorkspace
// ---------------------------------------------------------------------------

describe("exportWorkspace", () => {
  test("returns false when the workspace id does not exist", () => {
    writeWorkspacesYaml("dev", MINIMAL_YAML);
    expect(exportWorkspace("dev", "no-such-ws")).toBe(false);
  });

  test("writes the workspace to the shared dir and returns true", () => {
    writeWorkspacesYaml("dev", MINIMAL_YAML);
    const result = exportWorkspace("dev", "acme");
    expect(result).toBe(true);
    const sharedPath = join(scratchConfig, "cue", "workspaces", "shared", "acme.yaml");
    expect(existsSync(sharedPath)).toBe(true);
    const content = readFileSync(sharedPath, "utf8");
    expect(content).toContain("Acme Corp");
  });
});

describe("importWorkspace", () => {
  test("returns false when the shared workspace file does not exist", () => {
    expect(importWorkspace("dev", "nonexistent")).toBe(false);
  });

  test("imports a shared workspace into the profile and returns true", () => {
    // First export to shared dir, then import into a different profile.
    writeWorkspacesYaml("dev", MINIMAL_YAML);
    exportWorkspace("dev", "acme");

    // Create the target profile directory so writeFileSync can write there.
    mkdirSync(join(scratchProfiles, "staging"), { recursive: true });

    const result = importWorkspace("staging", "acme");
    expect(result).toBe(true);
    expect(getWorkspace("staging", "acme")!.name).toBe("Acme Corp");
  });
});

// ---------------------------------------------------------------------------
// saveWorkspace
// ---------------------------------------------------------------------------

describe("saveWorkspace", () => {
  test("creates workspaces.yaml when none exists", () => {
    mkdirSync(join(scratchProfiles, "fresh"), { recursive: true });
    saveWorkspace("fresh", "client1", { name: "Client One", description: "New client" });
    const ws = getWorkspace("fresh", "client1");
    expect(ws).not.toBeNull();
    expect(ws!.name).toBe("Client One");
  });

  test("adds a workspace to an existing workspaces.yaml without clobbering others", () => {
    writeWorkspacesYaml("dev", MINIMAL_YAML);
    saveWorkspace("dev", "gamma", { name: "Gamma Client", url: "https://gamma.test" });

    expect(getWorkspace("dev", "acme")!.name).toBe("Acme Corp"); // pre-existing untouched
    const gamma = getWorkspace("dev", "gamma");
    expect(gamma!.name).toBe("Gamma Client");
    expect(gamma!.url).toBe("https://gamma.test");
  });

  test("overwrites an existing workspace entry with the new data", () => {
    writeWorkspacesYaml("dev", MINIMAL_YAML);
    saveWorkspace("dev", "acme", { name: "Acme Corp v2", description: "Updated" });
    expect(getWorkspace("dev", "acme")!.name).toBe("Acme Corp v2");
  });
});
