import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";

import { parseArgs, run } from "./dashboard";
import { createHandler } from "../lib/dashboard-server";

describe("dashboard parseArgs", () => {
  test("defaults are 127.0.0.1:7891", () => {
    const a = parseArgs([]);
    expect(a.host).toBe("127.0.0.1");
    expect(a.port).toBe(7891);
    expect(a.noOpen).toBe(false);
    expect(a.once).toBe(false);
  });

  test("flags parse", () => {
    const a = parseArgs(["--port", "9000", "--host", "0.0.0.0", "--no-open", "--once"]);
    expect(a.port).toBe(9000);
    expect(a.host).toBe("0.0.0.0");
    expect(a.noOpen).toBe(true);
    expect(a.once).toBe(true);
  });

  test("invalid port falls back to default", () => {
    expect(parseArgs(["--port", "garbage"]).port).toBe(7891);
    expect(parseArgs(["--port", "70000"]).port).toBe(7891); // > 65535
  });

  test("--help short-circuits", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });
});

describe("dashboard port reuse", () => {
  const cueStatus = {
    ok: true,
    data: { parts: [], warnings: [], totalProfiles: 1, telemetryEnabled: false },
  };

  async function withListener(
    status: unknown,
    check: (port: number, requests: string[]) => Promise<void>,
  ): Promise<void> {
    const requests: string[] = [];
    const listener = createServer((req, res) => {
      requests.push(req.url ?? "");
      res.writeHead(req.url === "/api/v1/status" ? 200 : 404, {
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify(status));
    });
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
    try {
      const address = listener.address();
      if (!address || typeof address === "string") throw new Error("Missing test port");
      await check(address.port, requests);
    } finally {
      listener.closeAllConnections();
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    }
  }

  test("reuses a running Cue dashboard and exits", async () => {
    await withListener(cueStatus, async (port) => {
      expect(await run(["--port", String(port), "--no-open"])).toBe(0);
    });
  });

  test("does not request an existing listener's web page by default", async () => {
    await withListener(cueStatus, async (port, requests) => {
      expect(await run(["--port", String(port)])).toBe(0);
      expect(requests).toEqual(["/api/v1/status"]);
    });
  });

  test("rejects oversized status replies", async () => {
    await withListener({ ...cueStatus, oversized: "x".repeat(300 * 1024) }, async (port) => {
      expect(await run(["--port", String(port)])).toBe(1);
    });
  });

  test("still fails when an unrelated service owns the port", async () => {
    await withListener({ ok: true, data: { status: "healthy" } }, async (port) => {
      expect(await run(["--port", String(port), "--no-open"])).toBe(1);
    });
  });
});

describe("dashboard handler routing", () => {
  test("unknown /api/v1/ path returns 404 envelope", async () => {
    const handler = createHandler();
    const res = await handler(new Request("http://x/api/v1/nope"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "not-found" });
  });

  test("known endpoint shape returns envelope (or telemetry-disabled error)", async () => {
    const handler = createHandler();
    const res = await handler(new Request("http://x/api/v1/skill-report?profile=foo"));
    const body = (await res.json()) as { ok: boolean };
    expect(typeof body.ok).toBe("boolean");
  });

  test("/api/v1/status returns ok envelope (works even without telemetry)", async () => {
    const handler = createHandler();
    const res = await handler(new Request("http://x/api/v1/status"));
    const body = (await res.json()) as { ok: boolean; data?: { telemetryEnabled: boolean } };
    expect(body.ok).toBe(true);
    expect(typeof body.data?.telemetryEnabled).toBe("boolean");
  });

  test("non-api path: JSON discovery when no web build, static file otherwise", async () => {
    const handler = createHandler();
    const res = await handler(new Request("http://x/somethingelse"));
    const ct = res.headers.get("Content-Type") ?? "";
    if (ct.startsWith("application/json")) {
      // No web/dist/ — handler returns the discovery envelope.
      const body = (await res.json()) as { ok: boolean; data: { api: string[] } };
      expect(body.ok).toBe(true);
      expect(body.data.api).toContain("/api/v1/status");
    } else {
      // web/dist/index.html exists — SPA fallback served. Just confirm
      // we got HTML, not a 500.
      expect(res.status).toBe(200);
      expect(ct).toContain("text/html");
    }
  });
});
