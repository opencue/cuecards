/**
 * Read the real Claude Code tool-permission rules (allow / ask / deny) the way
 * Claude Code itself loads them — a union across the managed → project → user
 * settings files. Powers the studio's Permissions page.
 *
 * Read-only: this reflects what's in settings.json, it never mutates it. The
 * pure parser + merger are exported so they're unit-testable without disk.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type PermMode = "allow" | "ask" | "deny";

export interface PermRule {
  /** The tool the rule scopes, e.g. "Bash", "Read", or a bare "mcp__x__y". */
  tool: string;
  /** The glob/argument pattern inside the parens, "" for bare tool rules. */
  pattern: string;
  mode: PermMode;
  /** Friendly labels of the settings files this exact rule appears in. */
  sources: string[];
}

export interface PermSourceFile { label: string; path: string; present: boolean }

export interface PermissionsData {
  rules: PermRule[];
  counts: Record<PermMode, number>;
  /** permissions.defaultMode from the highest-precedence file that sets it. */
  defaultMode: string | null;
  sources: PermSourceFile[];
}

interface RawPerms { allow?: string[]; ask?: string[]; deny?: string[]; defaultMode?: string }

/**
 * Split a Claude Code rule string into tool + pattern.
 *   `Bash(git *)`        → { tool: "Bash", pattern: "git *" }
 *   `mcp__codegraph__x`  → { tool: "mcp__codegraph__x", pattern: "" }
 */
export function parseRuleString(raw: string): { tool: string; pattern: string } {
  const m = raw.match(/^\s*([^(]+?)\s*\((.*)\)\s*$/);
  if (m) return { tool: m[1]!.trim(), pattern: m[2]!.trim() };
  return { tool: raw.trim(), pattern: "" };
}

/**
 * Merge permission blocks from several settings files (passed highest-priority
 * first) into one deduped, grouped view. A rule appearing in multiple files is
 * listed once with its sources merged; the first-seen `defaultMode` wins.
 */
export function buildPermissions(blocks: { label: string; perms: RawPerms | null }[]): {
  rules: PermRule[];
  counts: Record<PermMode, number>;
  defaultMode: string | null;
} {
  const map = new Map<string, PermRule>();
  let defaultMode: string | null = null;
  for (const { label, perms } of blocks) {
    if (!perms) continue;
    if (perms.defaultMode && !defaultMode) defaultMode = perms.defaultMode;
    for (const mode of ["deny", "ask", "allow"] as const) {
      for (const raw of perms[mode] ?? []) {
        if (typeof raw !== "string" || !raw.trim()) continue;
        const { tool, pattern } = parseRuleString(raw);
        const key = `${mode}|${tool}|${pattern}`;
        const ex = map.get(key);
        if (ex) { if (!ex.sources.includes(label)) ex.sources.push(label); }
        else map.set(key, { tool, pattern, mode, sources: [label] });
      }
    }
  }
  const rules = [...map.values()];
  const counts: Record<PermMode, number> = {
    allow: rules.filter((r) => r.mode === "allow").length,
    ask: rules.filter((r) => r.mode === "ask").length,
    deny: rules.filter((r) => r.mode === "deny").length,
  };
  return { rules, counts, defaultMode };
}

/**
 * The user's GLOBAL Claude config dir — always ~/.claude, NOT CLAUDE_CONFIG_DIR.
 * cue sets CLAUDE_CONFIG_DIR to a per-profile runtime when it launches the
 * dashboard; honoring it here would surface the materialized runtime defaults
 * (Bash/Read/Write/Edit *) instead of the real global permission rules the user
 * manages. CUE_CLAUDE_HOME stays as a test-injection override.
 */
function claudeUserDir(): string {
  return process.env.CUE_CLAUDE_HOME ?? join(homedir(), ".claude");
}

function readPermsFile(path: string): RawPerms | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { permissions?: RawPerms };
    return raw.permissions ?? null;
  } catch {
    return null;
  }
}

/**
 * Read every Claude Code settings file that can carry permission rules and
 * fold them into one grouped, deduped view. Missing files degrade silently.
 */
export function collectPermissions(): PermissionsData {
  const userDir = claudeUserDir();
  const proj = join(process.cwd(), ".claude");
  // Highest precedence first — matches Claude Code's managed→project→user order.
  const files: PermSourceFile[] = [
    { label: "managed", path: "/etc/claude-code/managed-settings.json", present: false },
    { label: "project · local", path: join(proj, "settings.local.json"), present: false },
    { label: "project", path: join(proj, "settings.json"), present: false },
    { label: "user · local", path: join(userDir, "settings.local.json"), present: false },
    { label: "user", path: join(userDir, "settings.json"), present: false },
  ];
  const blocks = files.map((f) => {
    f.present = existsSync(f.path);
    return { label: f.label, perms: f.present ? readPermsFile(f.path) : null };
  });
  const { rules, counts, defaultMode } = buildPermissions(blocks);
  return { rules, counts, defaultMode, sources: files };
}
