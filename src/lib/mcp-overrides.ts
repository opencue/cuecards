/**
 * MCP overrides — a per-directory record of which MCP servers the user disabled
 * for a given pinned profile.
 *
 * The launcher computes a "smart-prune" default (pin + skill-needed MCPs on,
 * the rest off) and lets the user toggle it interactively. To avoid re-prompting
 * on every launch, the resulting choice is stored here, keyed by the pinned
 * directory (the dir holding the resolving `.cue.profile`, else cwd) — mirroring
 * how `.cue.profile` itself is per-directory.
 *
 * A `fingerprint` of the profile's full (pre-prune) MCP id set is stored too:
 * when the profile's MCP set changes, the fingerprint mismatches and the
 * launcher re-prompts instead of silently applying a stale disabled list.
 *
 * All writes are best-effort: a failure never blocks a launch.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { configDir } from "./config-paths.ts";
import type { McpPruneMode } from "../../profiles/_types.ts";

export type { McpPruneMode };

/** One directory's MCP override. */
export interface McpOverride {
  /** The composite profile selector this override was captured for. */
  profile: string;
  /** Hash of the profile's full sorted MCP id list at capture time. */
  fingerprint: string;
  /** MCP ids the user disabled (lowercased). */
  disabled: string[];
}

/** On-disk shape: a map of absolute directory path -> override. */
type McpOverridesFile = Record<string, McpOverride>;

/** Resolved path, same config dir as combo-history / repo-defaults. */
export function mcpOverridesPath(): string {
  return join(configDir(), "mcp-overrides.json");
}

/**
 * Stable fingerprint of a profile's MCP id set. Order-independent (sorted),
 * case-insensitive — so re-ordering profile.yaml doesn't force a re-prompt but
 * adding/removing an MCP does.
 */
export function mcpFingerprint(mcpIds: string[]): string {
  const normalized = [...new Set(mcpIds.map((id) => id.toLowerCase()))].sort();
  return createHash("sha256").update(normalized.join(",")).digest("hex").slice(0, 16);
}

function readFile(path: string): McpOverridesFile {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as McpOverridesFile) : {};
  } catch {
    return {};
  }
}

/** Read the override for a directory, or undefined if none / unreadable. */
export function readMcpOverride(dir: string, path: string = mcpOverridesPath()): McpOverride | undefined {
  return readFile(path)[dir];
}

/**
 * Reconcile a remembered disabled-list against the MCPs the currently-active
 * skills need. An MCP the user disabled earlier (when nothing referenced it)
 * may have become needed by a skill added since — replaying the stale override
 * verbatim would keep it disabled and silently starve that skill. This splits
 * the stored ids into those still safe to keep off vs those to re-enable.
 *
 * All ids are compared lowercased (matching the override / needed conventions).
 * Output ids are lowercased.
 */
export function reconcileDisabledWithNeeded(
  disabled: string[],
  neededIds: Iterable<string>,
): { keepDisabled: string[]; reEnabled: string[] } {
  const need = new Set<string>();
  for (const id of neededIds) need.add(id.toLowerCase());
  const keepDisabled: string[] = [];
  const reEnabled: string[] = [];
  for (const raw of disabled) {
    const id = raw.toLowerCase();
    if (need.has(id)) reEnabled.push(id);
    else keepDisabled.push(id);
  }
  return { keepDisabled, reEnabled };
}

/**
 * Non-interactive auto-prune policy (opt-in via `CUE_PRUNE_MCPS`).
 *
 * Returns the lowercased MCP ids to disable: every server that is neither
 * pinned (agent-core, always on) nor referenced by an active skill — i.e. the
 * "unused (optional)" group the interactive picker shows. Applying it without a
 * TTY is what lets shims, CI, and headless launches get the same token saving a
 * human gets by opening the picker once.
 *
 * Default launches never call this (they stay fail-open, keep-all by design);
 * the explicit opt-in is what makes dropping safe — the caller asked for it.
 *
 * `pinned` is a lowercased set; `neededIds` are the keys from getNeededMcps()
 * (lowercased). Output ids are lowercased, matching the override conventions.
 */
export function autoPrunableMcps(
  allMcpIds: string[],
  pinned: Set<string>,
  neededIds: Iterable<string>,
): string[] {
  const need = new Set<string>();
  for (const id of neededIds) need.add(id.toLowerCase());
  const drop: string[] = [];
  for (const id of allMcpIds) {
    const key = id.toLowerCase();
    if (pinned.has(key) || need.has(key)) continue;
    drop.push(key);
  }
  return drop;
}

/**
 * Extend a profile-level disable list with unused runtime-global MCPs.
 *
 * A remembered picker override only governs profile MCP ids. In `all` prune
 * mode it must not suppress pruning of global servers overlaid from the user's
 * Claude config, while the remembered profile choices remain authoritative.
 */
export function withAutoPrunedGlobals(
  disabledIds: string[],
  profileMcpIds: string[],
  runtimeMcpIds: string[],
  pinned: Set<string>,
  neededIds: Iterable<string>,
): string[] {
  const profile = new Set(profileMcpIds.map((id) => id.toLowerCase()));
  const globals = runtimeMcpIds.filter((id) => !profile.has(id.toLowerCase()));
  const merged = new Set(disabledIds.map((id) => id.toLowerCase()));
  for (const id of autoPrunableMcps(globals, pinned, neededIds)) merged.add(id);
  return [...merged];
}

/**
 * Parse a `CUE_PRUNE_MCPS` value into an {@link McpPruneMode}:
 *   - "off"     — keep all (fail-open).
 *   - "profile" — drop unused PROFILE-declared MCPs only. Preserves cue's
 *     invariant that user-global MCPs are never touched.
 *   - "all"     — also drop unused GLOBAL MCPs present in the runtime
 *     .claude.json (heavy servers a coding profile never calls). A louder
 *     opt-in because it deletes config the user set globally.
 */
const PRUNE_ALL_TOKENS = ["all", "global", "aggressive"];
const PRUNE_PROFILE_TOKENS = ["auto", "unused", "profile", "1", "true", "on"];
const PRUNE_OFF_TOKENS = ["off", "0", "false", "no", ""];

export function mcpPruneMode(value: string | undefined): McpPruneMode {
  const v = (value ?? "").trim().toLowerCase();
  if (PRUNE_ALL_TOKENS.includes(v)) return "all";
  if (PRUNE_PROFILE_TOKENS.includes(v)) return "profile";
  return "off";
}

/**
 * Whether `value` is a token `mcpPruneMode` recognizes (any of all/profile/off
 * spellings). A non-empty, unrecognized value (a typo like `profil`) returns
 * false so the caller can warn and fall through to the profile default instead
 * of silently parsing it to "off" and suppressing that default.
 */
export function isRecognizedPruneEnv(value: string): boolean {
  const v = value.trim().toLowerCase();
  return (
    PRUNE_ALL_TOKENS.includes(v) ||
    PRUNE_PROFILE_TOKENS.includes(v) ||
    PRUNE_OFF_TOKENS.includes(v)
  );
}

/** Back-compat predicate: any prune mode at all (profile or all). */
export function autoPruneEnabled(value: string | undefined): boolean {
  return mcpPruneMode(value) !== "off";
}

/**
 * Read the MCP server ids present in a runtime `.claude.json` (top-level
 * `mcpServers`). Used by `all`-mode prune to discover user-global servers that
 * aren't profile-declared. Best-effort: missing/garbage file → empty list.
 */
export function readRuntimeMcpServerIds(claudeJsonPath: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(claudeJsonPath, "utf8")) as { mcpServers?: unknown };
    const ms = parsed.mcpServers;
    return ms && typeof ms === "object" && !Array.isArray(ms) ? Object.keys(ms) : [];
  } catch {
    return [];
  }
}

/**
 * Write (upsert) a directory's override. Best-effort — returns whether it wrote.
 * `path` is injectable so tests don't touch the real config dir.
 */
export function writeMcpOverride(
  dir: string,
  override: McpOverride,
  path: string = mcpOverridesPath(),
): boolean {
  try {
    const all = readFile(path);
    all[dir] = override;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(all, null, 2) + "\n");
    return true;
  } catch {
    return false; // never block a launch on a persistence failure
  }
}
