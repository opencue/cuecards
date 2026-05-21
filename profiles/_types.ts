/**
 * Types for the soul profile system. Mirror of profiles/schema.json.
 *
 * Consumed by bin/cli/* via:
 *   import type { Profile, NpxSkillRef, MCPRef, SkillRef } from "../../profiles/_types";
 */

export type AgentKind = "claude-code" | "codex";

export interface AgentScoped {
  agents?: AgentKind[];
}

// String form is sugar for { id: string }.
export type MCPRef = string | (AgentScoped & { id: string });

export type SkillRef = string | (AgentScoped & { id: string });

// Top-level plugin enablement. "<plugin>@<marketplace>" or object form.
export type PluginRef = string | (AgentScoped & { id: string });

export interface NpxSkillRef extends AgentScoped {
  repo: string;
  pin?: string;
  skills: string[];
}

export interface ProfileSkills {
  local?: SkillRef[];
  npx?: NpxSkillRef[];
  // NOTE: `skills.plugins` was retired in favor of top-level `plugins:`.
  // Using it will throw a SchemaViolation.
}

export interface Profile {
  name: string;
  description: string;
  agents?: AgentKind[];
  inherits?: string;
  skills?: ProfileSkills;
  mcps?: MCPRef[];
  plugins?: PluginRef[];
  env?: Record<string, string>;
}

// In the resolved (post-inherit) form every ref is normalized to its object shape.
export interface ResolvedMCP { id: string; agents?: AgentKind[]; }
export interface ResolvedSkill { id: string; agents?: AgentKind[]; }
export interface ResolvedPlugin { id: string; agents?: AgentKind[]; }

export interface ResolvedProfile extends Omit<Profile, "skills" | "mcps" | "plugins"> {
  agents: AgentKind[];
  skills: {
    local: ResolvedSkill[];
    npx: NpxSkillRef[];
  };
  mcps: ResolvedMCP[];
  plugins: ResolvedPlugin[];
  env: Record<string, string>;
  inheritanceChain: string[];
}

export interface LinkPlan {
  source: string;
  target: string;
  origin: "local" | "npx" | "plugin";
}

export class ProfileError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ProfileError";
  }
}

export class ProfileNotFound extends ProfileError {
  constructor(name: string) {
    super("PROFILE_NOT_FOUND", `Profile "${name}" not found in profiles/`);
  }
}

export class SchemaViolation extends ProfileError {
  constructor(name: string, public errors: unknown[]) {
    super("SCHEMA_VIOLATION", `Profile "${name}" failed schema validation`);
  }
}

export class InheritanceCycle extends ProfileError {
  constructor(public chain: string[]) {
    super("INHERITANCE_CYCLE", `Inheritance cycle: ${chain.join(" -> ")}`);
  }
}

export class InheritanceDepthExceeded extends ProfileError {
  constructor(public chain: string[]) {
    super(
      "INHERITANCE_DEPTH",
      `Inheritance depth > 3 (chain: ${chain.join(" -> ")})`,
    );
  }
}
