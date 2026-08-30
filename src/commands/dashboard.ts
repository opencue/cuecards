/**
 * `cue dashboard` — boot the local read-only dashboard server.
 *
 * v1 (this turn): server + JSON endpoints, no React UI yet. Use the API
 * with `curl http://127.0.0.1:7891/api/v1/status | jq`. The React app lives
 * under `web/` and ships in a follow-up turn.
 *
 * Flags:
 *   --port <n>    Bind port (default 7891)
 *   --host <h>    Bind host (default 127.0.0.1 — never bind public by default)
 *   --no-open     Skip auto-opening the browser
 *   --once        Boot, print a status line, exit (smoke test)
 */

import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { createHandler, webDistExists } from "../lib/dashboard-server";

/** Read a node request body into a Buffer. */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Convert a node IncomingMessage into a Web-standard Request. */
async function toWebRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((vv) => headers.append(k, vv));
    else if (v != null) headers.set(k, v);
  }
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await readBody(req) : undefined;
  return new Request(`${origin}${req.url ?? "/"}`, {
    method,
    headers,
    body: body && body.length > 0 ? body : undefined,
  });
}

/** Write a Web-standard Response back through a node ServerResponse. */
async function writeWebResponse(res: Response, out: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });

  // Streaming bodies (Server-Sent Events) must be piped chunk-by-chunk, not
  // buffered — `await res.arrayBuffer()` on a never-ending stream would hang
  // forever and the client would never see an event.
  const isStream = (headers["content-type"] ?? "").includes("text/event-stream");
  if (isStream && res.body) {
    out.writeHead(res.status, headers);
    out.flushHeaders();
    const reader = res.body.getReader();
    // Client disconnect → cancel the reader so the stream's interval timers stop.
    const onClose = () => { void reader.cancel().catch(() => { /* already gone */ }); };
    out.on("close", onClose);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out.write(Buffer.from(value));
      }
    } catch { /* client went away mid-write */ }
    finally {
      out.off("close", onClose);
      out.end();
    }
    return;
  }

  out.writeHead(res.status, headers);
  const buf = Buffer.from(await res.arrayBuffer());
  out.end(buf);
}

interface ParsedArgs {
  port: number;
  host: string;
  noOpen: boolean;
  once: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    port: 7891,
    host: "127.0.0.1",
    noOpen: false,
    once: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--port") {
      const v = Number(argv[++i] ?? "7891");
      if (Number.isFinite(v) && v > 0 && v < 65536) out.port = v;
    } else if (a === "--host") out.host = argv[++i] ?? out.host;
    else if (a === "--no-open") out.noOpen = true;
    else if (a === "--once") out.once = true;
  }
  return out;
}

function openBrowser(url: string): void {
  // Best-effort cross-platform open. Never blocks the server start.
  const cmd =
    process.platform === "darwin" ? "open" :
    process.platform === "win32"  ? "cmd"  :
    "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", url] : [url];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch { /* non-fatal */ }
}

function helpText(): string {
  return [
    "cue dashboard — local read-only dashboard server",
    "",
    "Usage:",
    "  cue dashboard [--port <n>] [--host <h>] [--no-open] [--once]",
    "",
    "Defaults: --port 7891 --host 127.0.0.1",
    "",
    "Endpoints (JSON):",
    "  GET /api/v1/status",
    "  GET /api/v1/profiles",
    "  GET /api/v1/skill-report?profile=<n>&since=<d>",
    "  GET /api/v1/pairs?profile=<n>",
    "  GET /api/v1/gates?profile=<n>  or  ?all=1",
    "  GET /api/v1/trigger-gaps?profile=<n>&since=<d>",
    "  GET /api/v1/telemetry/timeline?since=<d>",
    "",
    "All endpoints return { ok: true, data: ... } or { ok: false, error: ... }.",
    "127.0.0.1-only binding by default — never expose publicly without auth.",
    "",
    "React UI is built separately under web/. When web/dist/ exists, the",
    "server also serves static files from there at /.",
    "",
  ].join("\n");
}

export async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(helpText());
    return 0;
  }

  const handler = createHandler();
  const url = `http://${args.host}:${args.port}`;
  const origin = `http://${args.host}:${args.port}`;

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const webReq = await toWebRequest(req, origin);
        const webRes = await handler(webReq);
        await writeWebResponse(webRes, res);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
      }
    })();
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(args.port, args.host, resolve);
    });
  } catch (err) {
    process.stderr.write(`cue dashboard: failed to bind ${url}: ${(err as Error).message}\n`);
    return 1;
  }

  const uiNote = webDistExists()
    ? `serving React UI from web/dist/`
    : `JSON-only (no web/dist/ yet — UI ships in next turn)`;
  process.stdout.write(`cue dashboard ▸ ${url}  (${uiNote})\n`);
  process.stdout.write(`  curl ${url}/api/v1/status\n`);
  process.stdout.write(`  press Ctrl-C to stop\n`);

  if (args.once) {
    server.close();
    return 0;
  }

  if (!args.noOpen && webDistExists()) openBrowser(url);

  // Block forever — server keeps the process alive.
  await new Promise(() => { /* never resolves */ });
  return 0;
}
