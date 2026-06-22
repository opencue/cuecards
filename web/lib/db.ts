/**
 * Shared Postgres pool for server-side code that isn't BetterAuth itself
 * (BetterAuth owns its own pool inside `lib/auth.ts`). Everything that needs
 * raw SQL — the marketplace submission store — goes through this singleton so
 * a single function instance never opens more connections than it has to.
 *
 * Server-only. Never import from `web/src/*` (the browser bundle).
 */
import { Pool } from "pg";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var: ${name}`);
  return value;
}

let pool: Pool | null = null;

/**
 * Lazily create (and reuse) the process-wide pool. Defaults to a single
 * connection per instance — Neon's pooler endpoint in `DATABASE_URL` provides
 * real concurrency — matching the discipline in `lib/auth.ts`. Raise via
 * `PG_POOL_MAX` for the long-lived local dev server.
 */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: required("DATABASE_URL"),
      max: Number(process.env.PG_POOL_MAX ?? 1),
    });
  }
  return pool;
}
