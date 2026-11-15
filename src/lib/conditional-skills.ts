/**
 * Conditional skill loading — gate skills based on cwd file/dir presence or env vars.
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/**
 * Where a condition path points: `~/x` is the user's home, an absolute path is
 * itself, anything else is relative to the project (cwd). Without this a gate
 * such as `has_dir: ~/Documents/tool` was joined onto cwd and could never be true.
 */
function resolveConditionPath(name: string, cwd: string): string {
  // $HOME first: it is what the shell that launched the agent means by `~` (and it keeps this testable).
  const home = process.env.HOME || homedir();
  if (name === "~") return home;
  if (name.startsWith("~/")) return join(home, name.slice(2));
  return isAbsolute(name) ? name : join(cwd, name);
}

export interface SkillCondition {
  has_file?: string | string[];
  has_dir?: string | string[];
  env?: string | string[];
}

export interface ConditionalSkill {
  id: string;
  when: SkillCondition;
}

/** Check if a single file pattern exists (in cwd, or at a `~/` / absolute path). Supports simple glob (*) at start. */
function fileExists(pattern: string, cwd: string): boolean {
  if (pattern.startsWith("*.")) {
    const ext = pattern.slice(1); // e.g. ".pdf"
    try {
      return readdirSync(cwd).some(f => f.endsWith(ext));
    } catch { return false; }
  }
  return existsSync(resolveConditionPath(pattern, cwd));
}

/** Check if a directory exists (in cwd, or at a `~/` / absolute path). */
function dirExists(name: string, cwd: string): boolean {
  // Strip trailing slash for consistency
  const clean = name.endsWith("/") ? name.slice(0, -1) : name;
  try {
    const { statSync } = require("node:fs");
    return statSync(resolveConditionPath(clean, cwd)).isDirectory();
  } catch { return false; }
}

function toArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Evaluate whether a condition is met in the given cwd.
 * All specified checks must pass (AND logic within a condition).
 */
export function evaluateCondition(condition: SkillCondition, cwd: string): boolean {
  const files = toArray(condition.has_file);
  const dirs = toArray(condition.has_dir);
  const envs = toArray(condition.env);

  // has_file: at least one must exist
  if (files.length > 0 && !files.some(f => fileExists(f, cwd))) return false;

  // has_dir: at least one must exist
  if (dirs.length > 0 && !dirs.some(d => dirExists(d, cwd))) return false;

  // env: all must be set
  if (envs.length > 0 && !envs.every(e => process.env[e] !== undefined)) return false;

  return true;
}

/**
 * Filter conditional skills, returning IDs of those whose conditions pass.
 */
export function filterConditionalSkills(skills: ConditionalSkill[], cwd: string): string[] {
  return skills.filter(s => evaluateCondition(s.when, cwd)).map(s => s.id);
}
