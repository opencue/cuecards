/**
 * Vercel function: GET /api/v1/me — returns the authenticated user. Accepts a
 * session cookie or `Authorization: Bearer <api-key>`. The real work lives in
 * `lib/me.ts`; this wrapper only adapts Node req/res to web `Headers`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { fromNodeHeaders } from "better-auth/node";
import { getMe } from "../../lib/me.js";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "method-not-allowed" }));
    return;
  }
  const { status, body } = await getMe(fromNodeHeaders(req.headers));
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
