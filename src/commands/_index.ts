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
  doctor: {
    summary: "Diff declared profile vs actual disk state; --fix repairs (A15)",
    load: () => import("./doctor"),
  },
  validate: {
    summary: "Schema + lint checks for a profile (or --all) (A13)",
    load: () => import("./validate"),
  },
  launch: {
    summary: "Resolve+materialize a profile then exec claude/codex (hot path)",
    load: () => import("./launch"),
  },
  shell: {
    summary: "Install/uninstall ~/.local/bin/{claude,codex} shims",
    load: () => import("./shell"),
  },
  current: {
    summary: "Print the active profile and its resolved capability counts",
    load: () => import("./current"),
  },
  icon: {
    summary: "Pick an emoji icon for a profile",
    load: () => import("./icon"),
  },
  "create-profile": {
    summary: "Create a new profile.yaml from skills/MCPs (interactive or from agent skill)",
    load: () => import("./create-profile"),
  },
  "migrate-symlinks": {
    summary: "Rewrite ~/.codex and ~/.claude-accounts symlinks from soul/ to cue/",
    load: () => import("./migrate-symlinks"),
  },
} as const satisfies Record<string, Command>;

export type CommandName = keyof typeof COMMANDS;
