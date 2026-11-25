import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { run } from "./mcps";

let stdoutBuf = "";
let stderrBuf = "";
let stdoutSpy: ReturnType<typeof spyOn>;
let stderrSpy: ReturnType<typeof spyOn>;
let fetchSpy: ReturnType<typeof spyOn> | undefined;

function setup() {
  stdoutBuf = "";
  stderrBuf = "";
  stdoutSpy = spyOn(process.stdout, "write").mockImplementation((s: unknown) => {
    stdoutBuf += String(s);
    return true;
  });
  stderrSpy = spyOn(process.stderr, "write").mockImplementation((s: unknown) => {
    stderrBuf += String(s);
    return true;
  });
}

afterEach(() => {
  stdoutSpy?.mockRestore();
  stderrSpy?.mockRestore();
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
});

describe("cue mcps search — official MCP Registry", () => {
  let inheritedOffline: string | undefined;
  beforeEach(() => {
    inheritedOffline = process.env.CUE_OFFLINE;
    process.env.CUE_OFFLINE = "0";
  });
  afterEach(() => {
    if (inheritedOffline === undefined) delete process.env.CUE_OFFLINE;
    else process.env.CUE_OFFLINE = inheritedOffline;
  });

  test("only fetches public discovery metadata, not servers or packages", async () => {
    setup();
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      servers: [
        { server: null },
        { server: {
          name: "io.github.example/weather",
          version: "1.2.3",
          description: "Forecast\u001b[2J",
          repository: { url: "https://github.com/example/weather" },
          packages: [{
            registryType: "npm", identifier: "@example/weather", version: "1.2.0",
            environmentVariables: [{ name: "TOKEN", default: "never-echo-me" }],
          }],
          remotes: [{ type: "streamable-http", url: "https://example.com/mcp?token=never-echo-me" }],
        }},
      ],
      metadata: { nextCursor: "opaque-cursor" },
    }));
    expect(await run(["search", "weather & wind", "--limit", "2", "--json"])).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [request, options] = fetchSpy.mock.calls[0] ?? [];
    const url = new URL(String(request));
    expect(url.origin + url.pathname).toBe("https://registry.modelcontextprotocol.io/v0.1/servers");
    expect(Object.fromEntries(url.searchParams)).toEqual({ search: "weather & wind", version: "latest", limit: "2" });
    expect(options).toMatchObject({ redirect: "error" });
    expect(JSON.parse(stdoutBuf)).toEqual({ hasMore: true, servers: [{
      name: "io.github.example/weather", version: "1.2.3", description: "Forecast [2J",
      repository: "https://github.com/example/weather",
      packages: [{ registry: "npm", identifier: "@example/weather", version: "1.2.0" }],
      transports: ["streamable-http"],
    }] });
    expect(stdoutBuf).not.toContain("never-echo-me");
  });

  test("validates query and limit before any network request", async () => {
    setup();
    fetchSpy = spyOn(globalThis, "fetch");
    expect(await run(["search", "ab"])).toBe(1);
    expect(await run(["search", "github", "--limit", "31"])).toBe(1);
    expect(await run(["search", "github", "--apply"])).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(stderrBuf).toContain("Usage: cue mcps search");
  });

  test("shows a usable empty result and reports bad upstream responses without dumping them", async () => {
    setup();
    fetchSpy = spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ servers: [] }))
      .mockResolvedValueOnce(new Response("private upstream error", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ unexpected: [] }));
    expect(await run(["search", "github"])).toBe(0);
    expect(stdoutBuf).toContain("No matching servers");
    expect(await run(["search", "github"])).toBe(1);
    expect(stderrBuf).toContain("HTTP 503");
    expect(await run(["search", "github"])).toBe(1);
    expect(stderrBuf).toContain("invalid response");
    expect(stderrBuf).not.toContain("private upstream error");
  });

  test("does not send a search when offline mode is on", async () => {
    setup();
    fetchSpy = spyOn(globalThis, "fetch");
    process.env.CUE_OFFLINE = "1";
    expect(await run(["search", "github"])).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(stderrBuf).toContain("offline");
  });

  test("explains that a page with no displayable servers may not be the last page", async () => {
    setup();
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      servers: [{ server: null }],
      metadata: { nextCursor: "opaque-cursor" },
    }));
    expect(await run(["search", "github"])).toBe(0);
    expect(stdoutBuf).toContain("More matches exist");
    expect(stdoutBuf).not.toContain("No matching servers");
  });

  test("cancels an oversized registry stream before printing any results", async () => {
    setup();
    let canceled = false;
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
      cancel() { canceled = true; },
    });
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(body));
    expect(await run(["search", "github", "--json"])).toBe(1);
    expect(canceled).toBe(true);
    expect(stdoutBuf).toBe("");
    expect(stderrBuf).toContain("invalid response");
  });
});

describe("cue mcps run — hermetic paths", () => {
  test("--help returns 0 and prints usage", async () => {
    setup();
    const code = await run(["--help"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("cue mcps");
    expect(stdoutBuf).toContain("Subcommands:");
  });

  test("-h returns 0 and prints usage", async () => {
    setup();
    const code = await run(["-h"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("Usage:");
  });

  test("unknown subcommand returns 1 with error on stderr", async () => {
    setup();
    const code = await run(["doesnotexist"]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("doesnotexist");
  });
});
