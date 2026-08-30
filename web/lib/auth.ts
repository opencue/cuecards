/**
 * BetterAuth server instance — the single source of truth for auth on
 * cuecards.cc. Imported ONLY by server-side code (Vercel functions in
 * `web/api/*` and the local dev/check scripts). Never import this from
 * `web/src/*` (the browser bundle) — the client talks to it over HTTP via
 * `src/lib/auth-client.ts`.
 *
 * Storage: Neon Postgres in production, a local Postgres for the check.
 * Both are reached through the same `DATABASE_URL` connection string.
 */
import { betterAuth } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { Pool } from "pg";

import { resolveAuthBaseUrl } from "./auth-origin.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var: ${name}`);
  return value;
}

export const auth = betterAuth({
  // Public origin of the auth server. On Vercel this is the site URL; for the
  // local check it falls back to the dev server port.
  baseURL: resolveAuthBaseUrl(),
  // Extra origins allowed to make authenticated requests (CSRF allowlist).
  // Same-origin (baseURL) is always trusted; this covers the Vite dev proxy
  // origin in development. Comma-separated env var, e.g.
  // "http://localhost:5173". Unset in production (same-origin on Vercel).
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS
    ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",").map((o) => o.trim())
    : undefined,
  // Signs session cookies + tokens. Required in every environment so a missing
  // secret fails loudly at boot instead of silently weakening sessions.
  secret: required("BETTER_AUTH_SECRET"),
  // On Vercel each function instance gets its own Pool; an unbounded pool
  // exhausts Neon's connection cap under concurrency. Default to 1 connection
  // per instance (use Neon's pooler endpoint in DATABASE_URL for real
  // concurrency); raise via PG_POOL_MAX for the long-lived local dev server.
  database: new Pool({
    connectionString: required("DATABASE_URL"),
    max: Number(process.env.PG_POOL_MAX ?? 1),
  }),
  emailAndPassword: {
    enabled: true,
    // Free signup: no email-verification gate so a new user can register and
    // immediately mint a token. Tighten later if abuse appears.
    requireEmailVerification: false,
  },
  plugins: [
    apiKey({
      // Without this an API key never resolves into a session, so
      // `getSession()` on the /me endpoint would ignore the Bearer token.
      enableSessionForAPIKeys: true,
      // The plugin defaults to 10 requests / 24h PER KEY, which silently
      // cripples a token meant for programmatic use (Claude, CI, scripts).
      // Use a generous per-minute ceiling instead; coarse abuse control
      // belongs at the edge/network layer, not baked into every token.
      rateLimit: {
        enabled: true,
        maxRequests: 120,
        timeWindow: 60_000,
      },
      // The screenshot's token UX is "Authorization: Bearer <token>". The
      // plugin reads `x-api-key` by default; this getter accepts either.
      customAPIKeyGetter: (ctx: { headers?: Headers | null }) => {
        const authz = ctx.headers?.get("authorization");
        if (authz && authz.toLowerCase().startsWith("bearer ")) {
          return authz.slice(7).trim();
        }
        return ctx.headers?.get("x-api-key") ?? null;
      },
    }),
  ],
});

export type Auth = typeof auth;
