/**
 * `cue dash` — a thin CLI over the running cue studio dashboard's REST API
 * (`cue dashboard`, default http://127.0.0.1:7891/api/v1/*). Read subcommands
 * query live profile/skill/MCP/gap data; mutating ones add an MCP to a profile,
 * kill a session, or run a merge. The dashboard must be running.
 *
 * The MCP server (resources/mcps/cue-dashboard) wraps the same endpoints as
 * tools; both are independent HTTP clients — dashboard-server.ts is the only
 * source of truth.
 */

const DEFAULT_PORT = 7891;
const DEFAULT_HOST = "127.0.0.1";

export interface DashArgs {
  sub: string;
  rest: string[];
  port: number;
  host: string;
  json: boolean;
  sigkill: boolean;
  as?: string;
  help: boolean;
}

/** Parse `cue dash` argv: `<sub> [positional...] [--port N] [--host H] [--json] [--sigkill] [--as name]`. */
export function parseDashArgs(argv: string[]): DashArgs {
  const out: DashArgs = {
    sub: "",
    rest: [],
    port: Number(process.env.CUE_DASH_PORT) || DEFAULT_PORT,
    host: process.env.CUE_DASH_HOST || DEFAULT_HOST,
    json: false,
    sigkill: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--sigkill") out.sigkill = true;
    else if (a === "--port") { const v = Number(argv[++i]); if (Number.isFinite(v) && v > 0 && v < 65536) out.port = v; }
    else if (a === "--host") { const v = argv[++i]; if (v) out.host = v; }
    else if (a === "--as") { const v = argv[++i]; if (v) out.as = v; }
    else if (!out.sub) out.sub = a;
    else out.rest.push(a);
  }
  return out;
}

/** Build the absolute API URL for a path + optional query. Exported for tests. */
export function dashUrl(host: string, port: number, path: string, query?: Record<string, string>): string {
  const qs = query && Object.keys(query).length > 0 ? "?" + new URLSearchParams(query).toString() : "";
  return `http://${host}:${port}/api/v1${path}${qs}`;
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Fetch one API path and unwrap the `{ok, data|error}` envelope. Throws on a
 * `{ok:false}` body (message = the server's `error`) and on a refused
 * connection (the dashboard isn't running) with an actionable hint.
 */
export async function dashFetch<T = unknown>(
  args: Pick<DashArgs, "host" | "port">,
  path: string,
  opts: { query?: Record<string, string>; method?: "GET" | "POST"; body?: unknown } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const url = dashUrl(args.host, args.port, path, opts.query);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: opts.method ?? "GET",
      headers: opts.body ? { "content-type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    throw new Error(
      `cannot reach the dashboard at ${args.host}:${args.port} (${(err as Error).message}). ` +
        `Start it with \`cue dashboard\`.`,
    );
  }
  let env: Envelope<T>;
  try { env = (await res.json()) as Envelope<T>; }
  catch { throw new Error(`dashboard returned non-JSON (HTTP ${res.status}) for ${path}`); }
  if (!env.ok) throw new Error(env.error);
  return env.data;
}

/** Subcommand → how to call the API. Pure data so the help text and the MCP can mirror it. */
interface Route {
  summary: string;
  build: (a: DashArgs) => { path: string; query?: Record<string, string>; method?: "POST"; body?: unknown };
  mutating?: boolean;
}

export const ROUTES: Record<string, Route> = {
  status: { summary: "dashboard + runtime status", build: () => ({ path: "/status" }) },
  profiles: { summary: "all profiles with counts", build: () => ({ path: "/profiles" }) },
  profile: {
    summary: "one profile's resolved skills/mcps/plugins/commands (arg: <name>)",
    build: (a) => ({ path: "/profile-detail", query: { profile: a.rest[0] ?? "" } }),
  },
  "trigger-gaps": {
    summary: "skills that matched a prompt but never fired (arg: [profile])",
    build: (a) => ({ path: "/trigger-gaps", query: a.rest[0] ? { profile: a.rest[0] } : undefined }),
  },
  "skill-report": { summary: "per-skill usage report", build: () => ({ path: "/skill-report" }) },
  pairs: { summary: "profile pair-affinity suggestions", build: () => ({ path: "/pairs" }) },
  sessions: { summary: "active cue sessions", build: () => ({ path: "/active-sessions" }) },
  mcps: { summary: "the MCP catalog cue knows about", build: () => ({ path: "/mcps/catalog" }) },
  plugins: { summary: "plugins discovered on the machine", build: () => ({ path: "/plugins/discovered" }) },
  timeline: { summary: "telemetry timeline", build: () => ({ path: "/telemetry/timeline" }) },
  "add-mcp": {
    summary: "add an MCP to a profile (args: <profile> <mcp>)",
    mutating: true,
    build: (a) => ({ path: "/mcps/add", method: "POST", body: { profile: a.rest[0], id: a.rest[1] } }),
  },
  kill: {
    summary: "kill a cue session by pid (arg: <pid>, --sigkill for SIGKILL)",
    mutating: true,
    build: (a) => ({ path: "/sessions/kill", method: "POST", body: { pid: Number(a.rest[0]), signal: a.sigkill ? "SIGKILL" : "SIGTERM" } }),
  },
  "merge-preview": {
    summary: "preview merging 2+ profiles (args: <name> <name> ...)",
    mutating: false,
    build: (a) => ({ path: "/merge/preview", method: "POST", body: { names: a.rest } }),
  },
  "merge-save": {
    summary: "save a merge of 2+ profiles (args: <name> <name> ... [--as <name>])",
    mutating: true,
    build: (a) => ({ path: "/merge/save", method: "POST", body: { names: a.rest, name: a.as } }),
  },
};

function helpText(): string {
  const rows = Object.entries(ROUTES)
    .map(([k, r]) => `  ${k.padEnd(15)} ${r.summary}${r.mutating ? "  [mutates]" : ""}`)
    .join("\n");
  return [
    "cue dash — query and drive the running cue studio dashboard",
    "",
    "Usage: cue dash <subcommand> [args] [--port N] [--host H] [--json]",
    "",
    "Subcommands:",
    rows,
    "",
    "Defaults: --host 127.0.0.1 --port 7891 (override with CUE_DASH_HOST/CUE_DASH_PORT).",
    "Requires `cue dashboard` to be running.",
    "",
  ].join("\n");
}

/**
 * Write to stdout and wait until it has flushed to the OS. `cue` exits via
 * `process.exit()` (src/index.ts), which does NOT drain a pending stdout
 * buffer — so a large payload piped to another process (`cue dash profile X |
 * jq`) would be truncated. Awaiting the write callback blocks until the reader
 * has drained the pipe, so the full output always lands.
 */
function writeOut(s: string): Promise<void> {
  return new Promise<void>((resolve) => {
    process.stdout.write(s, () => resolve());
  });
}

export async function run(argv: string[]): Promise<number> {
  const a = parseDashArgs(argv);
  if (a.help || !a.sub) {
    process.stdout.write(helpText());
    return a.sub ? 0 : a.help ? 0 : 1;
  }
  const route = ROUTES[a.sub];
  if (!route) {
    process.stderr.write(`unknown subcommand: ${a.sub}\n\n${helpText()}`);
    return 1;
  }
  // Guard required positionals so we fail fast with a clear message, not a
  // server-side "missing-profile" / NaN-pid.
  if (a.sub === "profile" && !a.rest[0]) { process.stderr.write("profile: needs a profile name\n"); return 1; }
  if (a.sub === "add-mcp" && (!a.rest[0] || !a.rest[1])) { process.stderr.write("add-mcp: needs <profile> <mcp>\n"); return 1; }
  if (a.sub === "kill" && !Number.isFinite(Number(a.rest[0]))) { process.stderr.write("kill: needs a numeric <pid>\n"); return 1; }

  const spec = route.build(a);
  try {
    const data = await dashFetch(a, spec.path, { query: spec.query, method: spec.method, body: spec.body });
    if (route.mutating && !a.json) await writeOut(`✓ ${a.sub}: done\n`);
    await writeOut(JSON.stringify(data, null, a.json ? 0 : 2) + "\n");
    return 0;
  } catch (err) {
    process.stderr.write(`✗ ${a.sub}: ${(err as Error).message}\n`);
    return 1;
  }
}
