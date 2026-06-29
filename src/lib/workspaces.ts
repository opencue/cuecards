/**
 * Workspace system — per-client/site sub-configurations within a profile.
 *
 * A profile can have a `workspaces.yaml` file that defines multiple
 * workspaces. Each workspace overrides env vars and injects context
 * into the persona. The user picks a workspace on launch (TUI picker)
 * or via `cue workspace <name>`.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, } from "node:fs";
import { join, dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { profilesDir } from "./repo-root";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Workspace {
  name: string;
  url?: string;
  description?: string;
  env?: Record<string, string>;
  context?: string;
  skills?: string[];
  persona?: string;
}

export interface WorkspacesConfig {
  workspaces: Record<string, Workspace>;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function configBase(): string {
  return process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "~", ".config");
}

function workspacesPath(profileName: string): string {
  return join(profilesDir(), profileName, "workspaces.yaml");
}

function activeWorkspacePath(profileName: string): string {
  return join(configBase(), "cue", "workspaces", `${profileName}.active`);
}

function sharedWorkspacesDir(): string {
  return join(configBase(), "cue", "workspaces", "shared");
}

function sharedWorkspacePath(name: string): string {
  return join(sharedWorkspacesDir(), `${name}.yaml`);
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

export function hasWorkspaces(profileName: string): boolean {
  return existsSync(workspacesPath(profileName));
}

export function loadWorkspaces(profileName: string): WorkspacesConfig | null {
  const path = workspacesPath(profileName);
  let config: WorkspacesConfig | null = null;

  if (existsSync(path)) {
    try {
      config = parseYaml(readFileSync(path, "utf8")) as WorkspacesConfig;
    } catch {
      return null;
    }
  }

  // Merge shared workspaces (profile-specific takes precedence)
  const sharedDir = sharedWorkspacesDir();
  if (existsSync(sharedDir)) {
    try {
      const { readdirSync } = require("node:fs") as typeof import("node:fs");
      const files = readdirSync(sharedDir).filter((f: string) => f.endsWith(".yaml"));
      for (const file of files) {
        const shared = parseYaml(readFileSync(join(sharedDir, file), "utf8")) as Workspace;
        const id = file.replace(/\.yaml$/, "");
        if (!config) config = { workspaces: {} };
        if (!config.workspaces) config.workspaces = {};
        // Profile-specific takes precedence
        if (!config.workspaces[id]) {
          config.workspaces[id] = shared;
        }
      }
    } catch { /* shared dir read failed — skip */ }
  }

  return config;
}

export function listWorkspaceIds(profileName: string): string[] {
  const config = loadWorkspaces(profileName);
  if (!config?.workspaces) return [];
  return Object.keys(config.workspaces);
}

export function getWorkspace(profileName: string, workspaceId: string): Workspace | null {
  const config = loadWorkspaces(profileName);
  return config?.workspaces?.[workspaceId] ?? null;
}

export function getActiveWorkspace(profileName: string): string | null {
  const path = activeWorkspacePath(profileName);
  try {
    if (existsSync(path)) return readFileSync(path, "utf8").trim();
  } catch {}
  return null;
}

export function setActiveWorkspace(profileName: string, workspaceId: string): void {
  const path = activeWorkspacePath(profileName);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, workspaceId);
}

// ---------------------------------------------------------------------------
// .cue-workspace auto-switch (Feature 4)
// ---------------------------------------------------------------------------

export function resolveWorkspaceForCwd(profileName: string, cwd: string): string | null {
  const { homedir } = require("node:os") as typeof import("node:os");
  const home = homedir();
  let dir = cwd;
  while (true) {
    const candidate = join(dir, ".cue-workspace");
    if (existsSync(candidate)) {
      const id = readFileSync(candidate, "utf8").trim();
      // Validate it exists in this profile
      if (getWorkspace(profileName, id)) return id;
    }
    const parent = dirname(dir);
    if (parent === dir || dir === home) break;
    dir = parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Apply workspace to profile env/persona
// ---------------------------------------------------------------------------

export interface WorkspaceOverrides {
  env: Record<string, string>;
  personaPrefix: string;
  personaOverride?: string;
  skills?: string[];
}

/**
 * Compute the overrides a workspace applies to a profile.
 * Returns env vars to merge, persona text to prepend, and optional skills.
 * Resolves `secret:` prefixed env values via workspace-secrets.
 */
export function computeOverrides(profileName: string, workspaceId: string): WorkspaceOverrides | null {
  const ws = getWorkspace(profileName, workspaceId);
  if (!ws) return null;

  const env: Record<string, string> = {};

  // Resolve env vars, handling secret: prefix
  if (ws.env) {
    for (const [key, val] of Object.entries(ws.env)) {
      if (val.startsWith("secret:")) {
        try {
          const { getSecret } = require("./workspace-secrets") as typeof import("./workspace-secrets");
          const secretName = val.slice(7);
          const resolved = getSecret(secretName);
          env[key] = resolved ?? val;
        } catch {
          env[key] = val;
        }
      } else {
        env[key] = val;
      }
    }
  }

  let personaPrefix = "";
  if (ws.context) {
    personaPrefix = `## Active Workspace: ${ws.name}\n\n${ws.context.trim()}\n\n`;
  }

  const result: WorkspaceOverrides = { env, personaPrefix };

  if (ws.persona) {
    result.personaOverride = ws.persona;
  }

  if (ws.skills && ws.skills.length > 0) {
    result.skills = ws.skills;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Cross-profile workspace sharing (Feature 7)
// ---------------------------------------------------------------------------

export function exportWorkspace(profileName: string, workspaceId: string): boolean {
  const ws = getWorkspace(profileName, workspaceId);
  if (!ws) return false;
  const dir = sharedWorkspacesDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(sharedWorkspacePath(workspaceId), stringifyYaml(ws));
  return true;
}

export function importWorkspace(profileName: string, workspaceId: string): boolean {
  const sharedPath = sharedWorkspacePath(workspaceId);
  if (!existsSync(sharedPath)) return false;
  const ws = parseYaml(readFileSync(sharedPath, "utf8")) as Workspace;

  // Append to profile's workspaces.yaml
  const wsPath = workspacesPath(profileName);
  let config: WorkspacesConfig;
  if (existsSync(wsPath)) {
    config = parseYaml(readFileSync(wsPath, "utf8")) as WorkspacesConfig;
  } else {
    config = { workspaces: {} };
  }
  config.workspaces[workspaceId] = ws;
  writeFileSync(wsPath, stringifyYaml(config));
  return true;
}

// ---------------------------------------------------------------------------
// Save workspace to profile's workspaces.yaml
// ---------------------------------------------------------------------------

export function saveWorkspace(profileName: string, workspaceId: string, ws: Workspace): void {
  const wsPath = workspacesPath(profileName);
  let config: WorkspacesConfig;
  if (existsSync(wsPath)) {
    config = parseYaml(readFileSync(wsPath, "utf8")) as WorkspacesConfig;
  } else {
    config = { workspaces: {} };
  }
  if (!config.workspaces) config.workspaces = {};
  config.workspaces[workspaceId] = ws;
  writeFileSync(wsPath, stringifyYaml(config));
}
