/**
 * BetterAuth browser client. Talks to the server `auth` instance over HTTP at
 * the same origin (`/api/auth/*`) — in production those are the Vercel
 * functions; in dev, Vite proxies `/api/auth` to the local auth server.
 *
 * This is the ONLY auth module `src/*` may import. The server instance in
 * `web/lib/auth.ts` must never reach the browser bundle.
 */
import { createAuthClient } from "better-auth/react";
import { apiKeyClient } from "@better-auth/api-key/client";

export const authClient = createAuthClient({
  // baseURL defaults to the current origin, which is what we want both on
  // Vercel (same-origin functions) and in dev (Vite proxy). Left implicit.
  plugins: [apiKeyClient()],
});

export const { useSession, signIn, signUp, signOut } = authClient;

/**
 * One API key as returned by `authClient.apiKey.list()` (in `data.apiKeys`).
 * Date fields arrive as `Date` from the typed client; `fmtDate` accepts both.
 */
export interface ApiKeyRow {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  enabled: boolean;
  createdAt: Date | string;
  expiresAt: Date | string | null;
  lastRequest: Date | string | null;
}
