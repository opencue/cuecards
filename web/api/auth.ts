/**
 * Vercel function for BetterAuth. `vercel.json` rewrites every `/api/auth/*`
 * request here with its original suffix in `__cue_auth_path` because generic
 * Vercel functions do not expand a framework-style `[...all]` filename across
 * multiple URL segments.
 *
 * Body parsing is disabled so BetterAuth reads the raw request itself.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { toNodeHandler } from "better-auth/node";
import { auth } from "../lib/auth.js";

export const config = { api: { bodyParser: false } };

const handleAuth = toNodeHandler(auth);

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/api/auth", "http://localhost");
  const path = url.searchParams.get("__cue_auth_path");
  if (path) {
    url.searchParams.delete("__cue_auth_path");
    const query = url.searchParams.toString();
    req.url = `/api/auth/${path}${query ? `?${query}` : ""}`;
  }
  await handleAuth(req, res);
}
