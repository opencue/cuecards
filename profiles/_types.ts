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

export interface SkillCondition {
  has_file?: string | string[];
  has_dir?: string | string[];
  env?: string | string[];
}

// String form is sugar for { id: string }. The object form accepts an optional
// `when:` condition (same shape as skills) so a server only activates when the
// cwd/env warrants it — keeping per-profile MCP schema cost off until needed.
// `pin: true` marks an MCP the agent uses directly (not via a skill), so the
// launcher's smart-prune never drops it. `when:` gates activation on a cwd/env
// condition. Both are independent and may combine.
export type MCPRef = string | (AgentScoped & { id: string; pin?: boolean; when?: SkillCondition });

export type SkillRef = string | (AgentScoped & { id: string; when?: SkillCondition });

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

/** Machine-readable provenance and discovery metadata for catalog-generated profiles. */
export interface ProfileCatalog {
  /** Stable source identifier, e.g. `agentic-awesome-skills`. */
  source: string;
  /** Broad semantic domain used to group profiles in discovery surfaces. */
  group: string;
  /** Narrow capability within the broad group. */
  capability: string;
  /** True when the profile is owned by a generator rather than hand-authored. */
  generated: boolean;
  /** `search` keeps large generated catalogs out of the empty picker view. */
  discoverability: "catalogue" | "search";
  /** True when one or more assignments need a human taxonomy decision. */
  reviewRequired?: boolean;
}

/**
 * Default MCP prune mode applied at launch when no `CUE_PRUNE_MCPS` env override
 * is set. `off` keeps all MCPs (fail-open, the global default); `profile` drops
 * unused profile-declared MCPs; `all` also drops unused global servers from the
 * runtime .claude.json. Leaf-wins through single inheritance; most-aggressive
 * wins across composite parts (off < profile < all). Pruning only ever drops
 * MCPs no active skill needs and that aren't pinned, so a higher mode is safe.
 */
export type McpPruneMode = "off" | "profile" | "all";

/** How prominently a profile appears in human-facing discovery surfaces. */
export type ProfileKind = "primary" | "overlay" | "internal";

export interface Profile {
  name: string;
  description: string;
  catalog?: ProfileCatalog;
  /** Primary profiles lead discovery; overlays are opt-in extensions. */
  kind?: ProfileKind;
  icon?: string;
  iconImage?: string;
  /** Default non-interactive prune mode; `CUE_PRUNE_MCPS` overrides per launch. */
  mcpPrune?: McpPruneMode;
  /**
   * Target main-session model id (e.g. "claude-opus-4-8"). Advisory only — cue
   * can't pin the main session model (that's a per-launch `/model` choice) — but
   * the model-aware startup budget (lib/token-budget.ts) uses it to resolve the
   * context window so the over-budget warning knows what window to size against.
   * Leaf-wins through inheritance. Env `CUE_MODEL` overrides per launch.
   */
  model?: string;
  /**
   * Explicit context window (tokens) to budget the startup load against, when
   * the model id alone isn't enough (custom/long-context deployments). Takes
   * precedence over `model`. Leaf-wins; env `CUE_CONTEXT_WINDOW` overrides.
   */
  contextWindow?: number;
  agents?: AgentKind[];
  inherits?: string | string[];
  // Companion profiles surfaced at `cue use` time as suggestions. Activating
  // them is opt-in: the user is offered `cue use <name>+<rec1>+<rec2>` which
  // composes via foldComposite. Recommendations are NOT inherited and do NOT
  // auto-merge skills/MCPs — purely a discovery hint.
  recommends?: string[];
  /**
   * Companion profiles that start CHECKED in the picker's combine-multiselect
   * whenever this profile is the primary, regardless of cwd detection. Stronger
   * than `recommends` (which only tags a row): use it when a profile is only
   * useful alongside a specific companion (e.g. designer-medusa-vite always
   * wants the medusa-dev backend). Still opt-out — the user can uncheck.
   */
  autoSelect?: string[];
  /**
   * Mutually-exclusive profile names. Used by the picker's combine-multiselect
   * to disable rows that would conflict with an already-checked option (e.g.
   * picking medusa-vite greys out medusa-next, since both are Medusa
   * storefront frameworks and cannot reasonably coexist). Symmetric is
   * recommended (both sides declare each other) but the picker also derives
   * the inverse so a one-sided declaration still works.
   */
  conflicts?: string[];
  /**
   * Human-facing list of the profiles this one conceptually bundles. Purely a
   * display hint — the picker renders it as `includes: a + b + c` next to the
   * row so a fat profile (e.g. `webshop`, which inlines medusa-dev/backend/
   * designer/… rather than composing them via `+`) advertises what it packs.
   * Does NOT drive resolution; skills/mcps/plugins are still the source of
   * truth for what actually loads. Inherited leaf-wins (a child that omits it
   * keeps its parent's list).
   */
  bundles?: string[];
  skills?: ProfileSkills;
  mcps?: MCPRef[];
  plugins?: PluginRef[];
  env?: Record<string, string>;
  // Extra keys merged into the Codex runtime's config.toml alongside the
  // profile's MCP servers. cue repoints CODEX_HOME at the materialized runtime,
  // so a user's own ~/.codex/config.toml is never read — anything Codex needs
  // beyond MCP servers (sandbox_mode, sandbox_workspace_write, approval_policy,
  // shell_environment_policy) has to come through here. Values are emitted
  // verbatim as TOML. Ignored for non-Codex agents. Shallow merge, later wins.
  codex_config?: Record<string, unknown>;
  rules?: string[];
  commands?: string[];
  hooks?: string[];
  // Claude Code subagents (relative to resources/subagents/, no .md). Each ref
  // points at a subagent definition (frontmatter + system prompt) that cue
  // symlinks flat into the runtime's agents/ dir so Claude Code can delegate to
  // it via the Task tool. Inheritance: concat + dedupe across the chain.
  subagents?: string[];
  // Phase 1: Persona — multi-line role-priming text injected at the top of
  // CLAUDE.md. Defines who the agent IS, not just what tools it has.
  persona?: string;
  // Shared persona snippets (relative to resources/personas/, no .md). Each
  // snippet is read at materialize-time and PREPENDED to the persona, so
  // cross-profile policies (Integrity Protocol, voice rules) live in one file
  // instead of being copy-pasted into every persona. Inheritance: concat +
  // dedupe across the chain — children inherit parent includes automatically.
  persona_includes?: string[];
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
  // Codex-only `config.toml` overrides. cue redirects CODEX_HOME at the runtime
  // dir, so the runtime config.toml is the only one Codex reads; keys here are
  // written into it verbatim, on top of the inherited ~/.codex/config.toml.
  // Use it to pin autonomy knobs per profile (`model_reasoning_effort`,
  // `approval_policy`, `sandbox_mode`, `model_auto_compact_token_limit`).
  codex?: CodexProfileConfig;
  // Phase 5: Skill router overrides — hand-tuned rows the auto-built router
  // can't (or shouldn't) produce. Merged into the materialized CLAUDE.md
  // router section under a "Skill overrides (manual)" sub-section so it's
  // obvious which rows are author-edited vs auto-parsed. Use sparingly —
  // the auto-router covers most cases.
  persona_routing?: PersonaRoutingEntry[];
}

/** A value a profile may set for a top-level Codex `config.toml` key. */
export type CodexScalar = string | number | boolean;

/**
 * A profile's `codex:` block. Keys are written into the runtime `config.toml`
 * verbatim, so cue needs no allowlist tracking Codex's config surface (Codex's
 * own `--strict-config` is what catches typos). `features` is special-cased
 * because it renders as a `[features]` table instead of a top-level key.
 */
export interface CodexProfileConfig {
  features?: Record<string, boolean>;
  /** Native Codex lifecycle hooks, rendered as a top-level TOML inline table. */
  hooks?: Record<string, unknown>;
  [key: string]: CodexScalar | Record<string, unknown> | undefined;
}

/**
 * One hand-tuned router entry. Either `phrase` (reactive — user-said
 * trigger) or `capability` (proactive — "when you're about to do X"), plus
 * the skill to route to. `note` is rendered alongside as context for Claude.
 */
export interface PersonaRoutingEntry {
  /** Trigger phrase the user might say verbatim. */
  phrase?: string;
  /** Task shape this skill handles — proactive routing. */
  capability?: string;
  /** Skill slug to route to (must be in this profile's resolved skill list). */
  skill: string;
  /** Optional short context line rendered with the row. */
  note?: string;
}

// In the resolved (post-inherit) form every ref is normalized to its object shape.
export interface ResolvedMCP { id: string; agents?: AgentKind[]; pin?: boolean; when?: SkillCondition; }
export interface ResolvedSkill { id: string; agents?: AgentKind[]; when?: SkillCondition; }
export interface ResolvedPlugin { id: string; agents?: AgentKind[]; }

/**
 * A skill the project loadout excluded from the runtime skills dir. The
 * materializer renders these into one generated index skill
 * (`cue-deferred-skills`) so the agent can still discover and load them on
 * demand — deferral is "defer, not drop".
 */
export interface DeferredSkillEntry { id: string; description: string; path: string; }

export interface ResolvedProfile extends Omit<Profile, "skills" | "mcps" | "plugins"> {
  kind: ProfileKind;
  agents: AgentKind[];
  skills: {
    local: ResolvedSkill[];
    npx: NpxSkillRef[];
  };
  mcps: ResolvedMCP[];
  plugins: ResolvedPlugin[];
  env: Record<string, string>;
  codexConfig: Record<string, unknown>;
  rules: string[];
  commands: string[];
  hooks: string[];
  subagents: string[];
  persona: string;        // empty string when not declared
  personaIncludes: string[];  // resolved persona snippet refs (concat+dedupe across chain)
  playbooks: string[];
  qualityGates: string[];
  evals: string[];
  recommends: string[];
  autoSelect: string[];
  conflicts: string[];
  inheritanceChain: string[];
  personaRouting: PersonaRoutingEntry[];
  /** Set at launch by the project loadout; absent on a full load. Part of the
   *  materializer content hash, so a loadout change rebuilds the runtime. */
  deferredSkills?: DeferredSkillEntry[];
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
