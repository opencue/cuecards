/**
 * .env file reader and classifier utilities extracted from dashboard-server.ts.
 * Reads and parses per-folder .env files; pure string utilities for env var
 * classification and secret masking.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { configDir } from "./config-paths";

export function loadEnvFolderDefs(): ReadonlyArray<{ path: string; tag: string }> {
  const cfgPath = join(configDir(), "env-folders.json");
  try {
    if (existsSync(cfgPath)) {
      const parsed = JSON.parse(readFileSync(cfgPath, "utf8")) as unknown;
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
  return [{ path: "~/Documents/cue", tag: "cue" }];
}

export const ENV_FOLDER_DEFS: ReadonlyArray<{ path: string; tag: string }> = loadEnvFolderDefs();

export const expandHome = (p: string): string => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

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
