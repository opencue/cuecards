/**
 * Subcommand registry.
 *
 * Each entry declares a one-line summary (shown in shell tab-completion and
 * `cue --help`) and a lazy loader that returns the command module. Lazy
 * loading keeps cold start fast — only the command actually invoked is
 * imported. Keep summaries user-facing: no internal owner/agent IDs.
 */

export interface Command {
  /** One-line description shown by `cue --help`. */
  summary: string;
  /** Lazy import of the command module. Must export `run(args): Promise<number>`. */
  load: () => Promise<{ run: (args: string[]) => Promise<number> }>;
}

export const COMMANDS = {
  use: {
    summary: "Materialize a profile into the current directory or ~/.claude",
    load: () => import("./use"),
  },
  list: {
    summary: "List available profiles with counts and the active marker",
    load: () => import("./list"),
  },
  new: {
    summary: "Scaffold a new profile; --from-scan buckets discovered skills",
    load: () => import("./new"),
  },
  scan: {
    summary: "Print a tree of installed skills/plugins grouped by domain",
    load: () => import("./scan"),
  },
  score: {
    summary: "Profile efficiency score (A+ to F) with SVG badge",
    load: () => import("./score"),
  },
  doctor: {
    summary: "Diff declared profile vs actual disk state; --fix repairs",
    load: () => import("./doctor"),
  },
  validate: {
    summary: "Schema + lint checks for a profile (or --all)",
    load: () => import("./validate"),
  },
  router: {
    summary: "Preview the auto-built skill router for a profile, or --audit cross-profile",
    load: () => import("./router"),
  },
  security: {
    summary: "Scan skills for prompt injection & secret exfiltration risks",
    load: () => import("./security"),
  },
  launch: {
    summary: "Resolve+materialize a profile then exec claude/codex (hot path)",
    load: () => import("./launch"),
  },
  loadout: {
    summary: "Inspect/edit the project's skill loadout (keep/defer/on/off/reset)",
    load: () => import("./loadout"),
  },
  install: {
    summary: "Prepare profile runtimes and optionally install required CLIs",
    load: () => import("./install"),
  },
  sync: {
    summary: "Refresh materialized runtimes after editing a profile source (--dry-run to preview)",
    load: () => import("./sync"),
  },
  gc: {
    summary: "Remove materialized runtimes idle past the age threshold (--dry-run, --days N)",
    load: () => import("./gc"),
  },
  materialize: {
    summary: "Write skills + MCPs for any agent (cursor, cline, gemini, copilot, etc.)",
    load: () => import("./materialize"),
  },
  ruler: {
    summary: "Distribute the active profile's rules into every agent's native rule file (--revert undoes)",
    load: () => import("./ruler"),
  },
  summon: {
    summary: "Bind a profile into the LIVE session (soft-load + pin), no cold restart",
    load: () => import("./summon"),
  },
  resolve: {
    summary: "Find library skills matching a query, loaded or not; --deep for an LLM pass",
    load: () => import("./resolve"),
  },
  quick: {
    summary: "One-shot bare launch — no profile, no skills, fastest cold start",
    load: () => import("./quick"),
  },
  login: {
    summary: "Authenticate with cue cloud (GitHub OAuth)",
    load: () => import("./cloud"),
  },
  logout: {
    summary: "Clear cue cloud credentials",
    load: () => import("./cloud"),
  },
  push: {
    summary: "Upload a profile to cue cloud",
    load: () => import("./cloud"),
  },
  pull: {
    summary: "Download a profile from cue cloud",
    load: () => import("./cloud"),
  },
  whoami: {
    summary: "Show current cue cloud user",
    load: () => import("./cloud"),
  },
  shell: {
    summary: "Install/uninstall the {claude,codex} shims",
    load: () => import("./shell"),
  },
  current: {
    summary: "Print the active profile and its resolved capability counts",
    load: () => import("./current"),
  },
  tui: {
    summary: "Three-pane interactive viewer: profiles, skills, preview",
    load: () => import("./tui"),
  },
  ask: {
    summary: "Show what a skill does — description, summary, size",
    load: () => import("./ask"),
  },
  ai: {
    summary: "Create a profile from natural language description",
    load: () => import("./ai"),
  },
  builtin: {
    summary: "Manage built-in skills shared across all profiles",
    load: () => import("./builtin"),
  },
  icon: {
    summary: "Pick an emoji icon for a profile",
    load: () => import("./icon"),
  },
  "create-profile": {
    summary: "Create a new profile.yaml from skills/MCPs (interactive or from agent skill)",
    load: () => import("./create-profile"),
  },
  profile: {
    summary: "Profile-scoped operations: `cue profile suggest` audits for regroupings",
    load: () => import("./profile"),
  },
  skills: {
    summary: "Manage skills: list, search, add/remove from profiles",
    load: () => import("./skills"),
  },
  mcps: {
    summary: "Manage MCP servers: list, add, remove, health check",
    load: () => import("./mcps"),
  },
  marketplace: {
    summary: "Search and install skills from the remote registry",
    load: () => import("./marketplace"),
  },
  stats: {
    summary: "Profile usage analytics dashboard",
    load: () => import("./stats"),
  },
  status: {
    summary: "Single-glance overview: active profile, stats, and warnings",
    load: () => import("./status"),
  },
  optimizer: {
    summary: "Review profiles: skills, MCPs, and CLIs per profile",
    load: () => import("./optimizer"),
  },
  merge: {
    summary: "Merge several profiles into one fat profile (static or live alias)",
    load: () => import("./merge"),
  },
  "auto-detect": {
    summary: "Detect project type and suggest a profile",
    load: () => import("./auto-detect"),
  },
  diff: {
    summary: "Compare two profiles side-by-side",
    load: () => import("./diff"),
  },
  eval: {
    summary: "Benchmark profile performance — token savings, usage, score",
    load: () => import("./eval"),
  },
  debug: {
    summary: "Trace why skills/MCPs aren't loading — full resolution chain",
    load: () => import("./debug"),
  },
  cli: {
    summary: "List or install the system CLIs a profile's skills need",
    load: () => import("./cli"),
  },
  "lint-skill": {
    summary: "Validate a SKILL.md against the skill spec (R001-R008); --fix to auto-correct",
    load: () => import("./lint-skill"),
  },
  "eval-behavior": {
    summary: "Structural eval — does this profile have the skills/commands/playbooks/gates for its declared scenarios?",
    load: () => import("./eval-behavior"),
  },
  failures: {
    summary: "Review session-log.jsonl + transcripts for failure patterns per profile",
    load: () => import("./failures"),
  },
  snapshot: {
    summary: "Export/restore current profile state as portable YAML",
    load: () => import("./snapshot"),
  },
  why: {
    summary: "Trace why a skill/MCP/plugin is loaded (inheritance chain)",
    load: () => import("./why"),
  },
  lock: {
    summary: "Lock a profile to prevent modifications",
    load: () => import("./lock"),
  },
  unlock: {
    summary: "Unlock a previously locked profile",
    load: () => import("./lock"),
  },
  packs: {
    summary: "Manage skill packs (grouped skill bundles)",
    load: () => import("./packs"),
  },
  init: {
    summary: "Project scanner + profile wizard. First run also walks default-profile and telemetry opt-in (replay with --re-onboard)",
    load: () => import("./init"),
  },
  setup: {
    summary: "One-command install: shim, project scan, and profile pin (alias of init)",
    load: () => import("./init"),
  },
  import: {
    summary: "Import a profile from URL, file, or org/repo",
    load: () => import("./import-profile"),
  },
  export: {
    summary: "Export a profile as portable YAML or Dockerfile (--docker)",
    load: async () => ({
      run: async (args: string[]) => {
        if (args.includes("--docker")) {
          const { run } = await import("./export-docker");
          return run(args.filter(a => a !== "--docker"));
        }
        const { run } = await import("./import-profile");
        return run(args);
      },
    }),
  },
  share: {
    summary: "Publish & browse community profiles on the marketplace",
    load: () => import("./share"),
  },
  "colony-dispatch": {
    summary: "Resolve profile for a Colony task based on keywords",
    load: () => import("./colony-dispatch"),
  },
  handoff: {
    summary: "Multi-agent handoff protocol — pass skill context between agents",
    load: () => import("./handoff"),
  },
  cost: {
    summary: "Estimate token budget for a profile",
    load: () => import("./cost"),
  },
  trace: {
    summary: "Live session inspector — tail skill/MCP invocations",
    load: () => import("./trace"),
  },
  replay: {
    summary: "Replay a session with a different profile (capability diff)",
    load: () => import("./replay"),
  },
  "skills-test": {
    summary: "Run skill unit tests",
    load: () => import("./skills-test"),
  },
  "skills-lint": {
    summary: "Lint skills for quality issues",
    load: () => import("./skills-lint"),
  },
  "skills-new": {
    summary: "Scaffold a new skill with template",
    load: () => import("./skills-new"),
  },
  "skills-pin": {
    summary: "Pin/rollback/unpin a skill to a specific commit",
    load: () => import("./skills-pin"),
  },
  update: {
    summary: "Self-update: git pull + bun install + sync",
    load: () => import("./update"),
  },
  upgrade: {
    summary: "Pull new skills/profiles from the registry",
    load: () => import("./upgrade"),
  },
  completions: {
    summary: "Output shell completion script (bash/zsh)",
    load: () => import("./completions"),
  },
  clean: {
    summary: "Prune stale runtimes, old cache, reclaim disk space",
    load: () => import("./clean"),
  },
  migrate: {
    summary: "Auto-migrate profiles to latest schema version",
    load: () => import("./migrate"),
  },
  suggest: {
    summary: "Skill recommendations based on session transcript analysis",
    load: () => import("./suggest"),
  },
  watch: {
    summary: "Auto-switch profile notification on cd (shell hook)",
    load: () => import("./watch"),
  },
  "watch-live": {
    summary: "File watcher for auto-rematerialization on profile/skill changes",
    load: () => import("./watch-live"),
  },
  audit: {
    summary: "Profile audit: --security checks tools, MCPs, hooks, gates",
    load: () => import("./audit"),
  },
  benchmark: {
    summary: "Measure profile efficiency: tokens, skill usage, cost",
    load: () => import("./benchmark"),
  },
  brief: {
    summary: "Show this directory's verified facts as handed to the agent; --write persists them",
    load: () => import("./brief"),
  },
  tree: {
    summary: "Visualize profile inheritance tree with resources",
    load: () => import("./tree"),
  },
  sources: {
    summary: "Show GitHub repos that provide skills for a profile",
    load: () => import("./sources"),
  },
  discover: {
    summary: "Find hidden gem skill repos on GitHub and export docs/discovered.md",
    load: () => import("./discover"),
  },
  playground: {
    summary: "Try a skill in an isolated temp environment without modifying your profile",
    load: () => import("./playground"),
  },
  workspace: {
    summary: "Select a workspace (sub-config) within the active profile",
    load: () => import("./workspace"),
  },
  evolve: {
    summary: "Auto-evolve profiles: detect gaps, suggest skills, prune unused",
    load: () => import("./evolve"),
  },
  sponsor: {
    summary: "Star the repo / show support links",
    load: async () => ({
      run: async () => {
        const { maybePromptStar } = await import("../lib/star-prompt");
        // Force the prompt regardless of session count
        const { existsSync, unlinkSync } = await import("node:fs");
        const { join } = await import("node:path");
        const { homedir } = await import("node:os");
        const flag = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cue", ".star-prompted");
        if (existsSync(flag)) unlinkSync(flag);
        await maybePromptStar();
        return 0;
      },
    }),
  },
  "migrate-symlinks": {
    summary: "Rewrite ~/.codex and ~/.claude-accounts symlinks from soul/ to cue/ to cue/",
    load: () => import("./migrate-symlinks"),
  },
  feedback: {
    summary: "Share what's working / what's missing (local-only, opt-in to share as GitHub issue)",
    load: () => import("./feedback"),
  },
  "submit-profile": {
    summary: "Fork opencue/claude-code-skills, branch, commit your profile.yaml, open PR (community contribution)",
    load: () => import("./submit-profile"),
  },
  telemetry: {
    summary: "Opt-in local activation telemetry (enable/disable/status/purge/ingest/report)",
    load: () => import("./telemetry"),
  },
  "suggest-pairs": {
    summary: "Show \"you usually pair X with Y\" from local session history (same data the picker uses)",
    load: () => import("./suggest-pairs"),
  },
  gates: {
    summary: "Inspect and run profile quality gates (list / run / status)",
    load: () => import("./gates"),
  },
  "skill-report": {
    summary: "Show which declared skills actually fire (active vs zombie) from local telemetry",
    load: () => import("./skill-report"),
  },
  prune: {
    summary: "Remove zombie skills (0 hits in window) from a profile.yaml — dry-run by default",
    load: () => import("./prune"),
  },
  "trigger-gaps": {
    summary: "Find skills whose trigger phrases appear in your prompts but never fire (description too weak)",
    load: () => import("./trigger-gaps"),
  },
  dashboard: {
    summary: "Boot the local read-only dashboard server (JSON endpoints)",
    load: () => import("./dashboard"),
  },
  dash: {
    summary: "Query + drive the running dashboard's API (status/profiles/profile/add-mcp/kill/...)",
    load: () => import("./dash"),
  },
  mcp: {
    summary: "Expose cue data over MCP (stdio JSON-RPC) so Claude can query it as tool calls",
    load: () => import("./mcp"),
  },
  mem: {
    summary: "Inspect/manage per-profile claude-mem stores (status / path / ports / seed)",
    load: () => import("./mem"),
  },
} as const satisfies Record<string, Command>;

export type CommandName = keyof typeof COMMANDS;
