/**
 * Types for the cue profile system. Mirror of profiles/schema.json.
 *
 * Consumed by bin/cli/* via:
 *   import type { Profile, NpxSkillRef, MCPRef, SkillRef } from "../../profiles/_types";
 */

export type AgentKind = "claude-code" | "codex" | "cursor" | "cline" | "windsurf" | "gemini" | "copilot" | "roo" | "amp" | "aider";

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
  icon?: string;
  iconImage?: string;
  agents?: AgentKind[];
  inherits?: string;
  // Companion profiles surfaced at `cue use` time as suggestions. Activating
  // them is opt-in: the user is offered `cue use <name>+<rec1>+<rec2>` which
  // composes via foldComposite. Recommendations are NOT inherited and do NOT
  // auto-merge skills/MCPs — purely a discovery hint.
  recommends?: string[];
  skills?: ProfileSkills;
  mcps?: MCPRef[];
  plugins?: PluginRef[];
  env?: Record<string, string>;
  rules?: string[];
  commands?: string[];
  hooks?: string[];
  // Phase 1: Persona — multi-line role-priming text injected at the top of
  // CLAUDE.md. Defines who the agent IS, not just what tools it has.
  persona?: string;
  // Phase 2: Playbooks — markdown files under resources/playbooks/ with
  // proven step-by-step protocols for common tasks ("ship-feature",
  // "triage-bug"). Symlinked into runtime, indexed in CLAUDE.md.
  playbooks?: string[];
  // Phase 3: Quality gates — script refs under resources/quality-gates/
  // that run as Stop hooks. Veto "done" claims if the work doesn't meet
  // the profile's bar (tests pass, lint clean, etc.).
  qualityGates?: string[];
  // Phase 4: Evals — scenario refs under resources/evals/ that declare
  // "for task X this profile should be able to handle it". `cue eval-behavior`
  // checks structural fit.
  evals?: string[];
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
  rules: string[];
  commands: string[];
  hooks: string[];
  persona: string;        // empty string when not declared
  playbooks: string[];
  qualityGates: string[];
  evals: string[];
  recommends: string[];
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
