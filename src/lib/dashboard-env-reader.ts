/**
 * .env file reader and classifier utilities extracted from dashboard-server.ts.
 * Reads and parses per-folder .env files; pure string utilities for env var
 * classification and secret masking.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { configDir } from "./config-paths";

/**
 * The original 6 built-in folder definitions shipped with the dashboard.
 * Used as the fallback when no ~/.config/cue/env-folders.json is present;
 * entries whose directory does not exist on disk are filtered out at runtime.
 */
export const DEFAULT_ENV_FOLDER_DEFS: ReadonlyArray<{ path: string; tag: string }> = [
  { path: "~/Documents/cue", tag: "cue" },
  { path: "~/Documents/recodee/authmux", tag: "authmux" },
  { path: "~/Documents/x-growth-bot", tag: "x-growth-bot" },
  { path: "~/work/medusa", tag: "medusa" },
  { path: "~/Documents/medusa-shops/marva", tag: "marva" },
  { path: "~/Documents/gitguardex", tag: "gitguardex" },
];

export const expandHome = (p: string): string => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

/** Dependency-injection seams used in tests to avoid touching the real filesystem. */
export interface LoadEnvFolderDefsOpts {
  /** Override for the cue config directory (default: configDir()). */
  configDirOverride?: string;
  /** Replacement for fs.existsSync (default: node:fs existsSync). */
  existsFn?: (path: string) => boolean;
  /** Replacement for fs.readFileSync(path, "utf8") (default: node:fs readFileSync). */
  readFn?: (path: string) => string;
}

export function loadEnvFolderDefs(opts?: LoadEnvFolderDefsOpts): ReadonlyArray<{ path: string; tag: string }> {
  const dir = opts?.configDirOverride ?? configDir();
  const exists = opts?.existsFn ?? existsSync;
  const read = opts?.readFn ?? ((p: string) => readFileSync(p, "utf8"));

  const cfgPath = join(dir, "env-folders.json");
  try {
    if (exists(cfgPath)) {
      const parsed = JSON.parse(read(cfgPath)) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.every(
          (e): e is { path: string; tag: string } =>
            typeof e === "object" && e !== null &&
            typeof (e as Record<string, unknown>).path === "string" &&
            typeof (e as Record<string, unknown>).tag === "string",
        )
      ) return parsed;
    }
  } catch { /* fall through to default */ }

  // No valid config file found; fall back to the original 6 defaults, filtered
  // to those whose directories actually exist on disk so we don't advertise
  // paths that aren't present on this machine.
  return DEFAULT_ENV_FOLDER_DEFS.filter((f) => exists(expandHome(f.path)));
}

export const ENV_FOLDER_DEFS: ReadonlyArray<{ path: string; tag: string }> = loadEnvFolderDefs();

const ENV_SECRET_RE = /(SECRET|_KEY|TOKEN|PASSWORD|PASSWD|_PASS|CREDENTIAL|DATABASE_URL|_DSN|PRIVATE)/i;

export type EnvKind = "secret" | "url" | "bool" | "num" | "plain";

export function classifyEnvVar(key: string, val: string): EnvKind {
  if (ENV_SECRET_RE.test(key)) return "secret";
  if (/^https?:\/\//.test(val)) return "url";
  if (/^(true|false)$/i.test(val)) return "bool";
  if (/^\d+$/.test(val)) return "num";
  return "plain";
}

export interface EnvVarRow { key: string; value: string; kind: EnvKind; masked: boolean }

/** Mask all but the first/last 3 chars (mirrors the design's mask()). */
export function maskSecretValue(v: string): string {
  return v.length <= 8 ? "•".repeat(v.length) : v.slice(0, 3) + "•".repeat(Math.min(18, v.length - 6)) + v.slice(-3);
}

export function parseEnvText(raw: string, revealKey: string): EnvVarRow[] {
  const out: EnvVarRow[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip a single layer of surrounding quotes, like dotenv does.
    if (value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'"))) {
      value = value.slice(1, -1);
    }
    const kind = classifyEnvVar(key, value);
    const isSecret = kind === "secret";
    // `reveal` names a single key, or "*" to reveal every secret at once.
    const reveal = isSecret && (revealKey === "*" || revealKey === key);
    out.push({ key, value: isSecret && !reveal ? maskSecretValue(value) : value, kind, masked: isSecret && !reveal });
  }
  return out;
}
