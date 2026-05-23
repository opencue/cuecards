/**
 * Subcommand registry.
 *
 * Each entry declares a one-line summary (for `soul --help`) and a lazy
 * loader that returns the command module. Lazy loading keeps cold start
 * fast — only the command actually invoked is imported.
 *
 * Owning agent for each subcommand is noted alongside; stubs live here until
 * those agents land their real implementations.
 */

export interface Command {
  /** One-line description shown by `soul --help`. */
  summary: string;
  /** Lazy import of the command module. Must export `run(args): Promise<number>`. */
  load: () => Promise<{ run: (args: string[]) => Promise<number> }>;
}

export const COMMANDS = {
  use: {
    summary: "Materialize a profile into CWD or ~/.claude (owned by A14)",
    load: () => import("./use"),
  },
  list: {
    summary: "List available profiles with counts and active marker (A14)",
    load: () => import("./list"),
  },
  new: {
    summary: "Scaffold a new profile; --from-scan buckets discovered skills (A12)",
    load: () => import("./new"),
  },
  scan: {
    summary: "Print a tree of installed skills/plugins grouped by domain (A10/A11)",
    load: () => import("./scan"),
  },
  score: {
    summary: "Profile efficiency score (A+ to F) with SVG badge",
    load: () => import("./score"),
  },
  doctor: {
    summary: "Diff declared profile vs actual disk state; --fix repairs (A15)",
    load: () => import("./doctor"),
  },
  validate: {
    summary: "Schema + lint checks for a profile (or --all) (A13)",
    load: () => import("./validate"),
  },
  security: {
    summary: "Scan skills for prompt injection & secret exfiltration risks",
    load: () => import("./security"),
  },
  launch: {
    summary: "Resolve+materialize a profile then exec claude/codex (hot path)",
    load: () => import("./launch"),
  },
  materialize: {
    summary: "Write skills + MCPs for any agent (cursor, cline, gemini, copilot, etc.)",
    load: () => import("./materialize"),
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
    summary: "Install/uninstall ~/.local/bin/{claude,codex} shims",
    load: () => import("./shell"),
  },
  current: {
    summary: "Print the active profile and its resolved capability counts",
    load: () => import("./current"),
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
  "auto-detect": {
    summary: "Detect project type and suggest a profile",
    load: () => import("./auto-detect"),
  },
  diff: {
    summary: "Compare two profiles side-by-side",
    load: () => import("./diff"),
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
    summary: "Interactive project scanner + profile wizard",
    load: () => import("./init"),
  },
  import: {
    summary: "Import a profile from URL, file, or org/repo",
    load: () => import("./import-profile"),
  },
  export: {
    summary: "Export a profile as portable YAML",
    load: () => import("./import-profile"),
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
    summary: "Profile recommendations based on usage patterns",
    load: () => import("./suggest"),
  },
  watch: {
    summary: "Auto-switch profile notification on cd (shell hook)",
    load: () => import("./watch"),
  },
  benchmark: {
    summary: "Measure profile efficiency: tokens, skill usage, cost",
    load: () => import("./benchmark"),
  },
  tree: {
    summary: "Visualize profile inheritance tree with resources",
    load: () => import("./tree"),
  },
  sources: {
    summary: "Show GitHub repos that provide skills for a profile",
    load: () => import("./sources"),
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
    summary: "Rewrite ~/.codex and ~/.claude-accounts symlinks from soul/ to cue/",
    load: () => import("./migrate-symlinks"),
  },
} as const satisfies Record<string, Command>;

export type CommandName = keyof typeof COMMANDS;
