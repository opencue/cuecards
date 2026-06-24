/**
 * Credentials for the hosted cuecards.cc API — the token a user mints in the
 * studio's "API" view (BetterAuth apiKey) and uses from their own machine to
 * publish skills / profiles / mcps to the marketplace.
 *
 * Resolution order for the token (first hit wins):
 *   1. an explicit `--token <t>` flag (handled by the caller)
 *   2. the `CUE_API_TOKEN` environment variable
 *   3. `~/.config/cue/credentials.json` (written by `cue marketplace login`)
 *
 * The file is written with 0600 perms — it holds a bearer secret.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { configDir } from "./config-paths";

/** Public site, overridable for self-hosting / local dev via CUE_API_URL. */
export const DEFAULT_API_URL = "https://cuecards.cc";

export interface Credentials {
  apiUrl: string;
  token: string;
}

function credentialsPath(): string {
  return join(configDir(), "credentials.json");
}

/** The API base URL: `CUE_API_URL` env > saved file > default. */
export function resolveApiUrl(saved?: Credentials | null): string {
  const env = process.env.CUE_API_URL;
  if (env && env.length > 0) return env.replace(/\/+$/, "");
  if (saved?.apiUrl) return saved.apiUrl.replace(/\/+$/, "");
  return DEFAULT_API_URL;
}

export function loadCredentials(): Credentials | null {
  const path = credentialsPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Credentials>;
    if (typeof parsed.token === "string" && parsed.token.length > 0) {
      return { apiUrl: parsed.apiUrl ?? DEFAULT_API_URL, token: parsed.token };
    }
  } catch { /* corrupt file → treat as unauthenticated */ }
  return null;
}

export function saveCredentials(creds: Credentials): string {
  const dir = configDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = credentialsPath();
  writeFileSync(path, JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 });
  return path;
}

/** Resolve the active token: flag > env > saved file. */
export function resolveToken(flagToken?: string | null): string | null {
  if (flagToken && flagToken.length > 0) return flagToken;
  const env = process.env.CUE_API_TOKEN;
  if (env && env.length > 0) return env;
  return loadCredentials()?.token ?? null;
}
