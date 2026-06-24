/**
 * Vercel function: the community marketplace API.
 *
 *   GET  /api/v1/community          -> approved community submissions
 *   GET  /api/v1/community?mine=1   -> the caller's own items (any status)
 *   POST /api/v1/community          -> publish/re-publish one item
 *
 * Auth: session cookie OR `Authorization: Bearer <api-key>` (GET?mine + POST).
 * The real work lives in `lib/market.ts`; this wrapper only adapts Node
 * req/res to web `Headers` and reads the JSON body.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { fromNodeHeaders } from "better-auth/node";

import { getMarket, publishMarket, type PublishInput } from "../../lib/market";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1_000_000) req.destroy(); });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(
  req: IncomingMessage & { url?: string },
  res: ServerResponse,
): Promise<void> {
  const headers = fromNodeHeaders(req.headers);
  res.setHeader("content-type", "application/json");

  if (req.method === "GET") {
    const mine = /[?&]mine=1\b/.test(req.url ?? "");
    const { status, body } = await getMarket(headers, { mine });
    res.statusCode = status;
    res.end(JSON.stringify(body));
    return;
  }

  if (req.method === "POST") {
    let input: PublishInput;
    try {
      input = JSON.parse((await readBody(req)) || "{}") as PublishInput;
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: "invalid-json" }));
      return;
    }
    const { status, body } = await publishMarket(headers, input);
    res.statusCode = status;
    res.end(JSON.stringify(body));
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ ok: false, error: "method-not-allowed" }));
}
