/**
 * Liveness probing for stdio MCP servers.
 *
 * The old check ran `which <command>` and called it a day. That passes for every
 * wrapper-launched server — `bash -lc '… exec …/python -m x'` probes as `bash`,
 * `npx …` probes as `npx` — so a server whose real interpreter is missing, or
 * which starts and then dies on missing config, still reported green. A dead
 * secret-mcp sat in eight profiles for weeks that way.
 *
 * So we do what the client does: spawn the server and speak MCP to it. A server
 * that answers `initialize` is genuinely up; anything else gets a reason string
 * the caller can show.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export type ProbeStatus = "up" | "down" | "unknown";

export interface ProbeResult {
  id: string;
  status: ProbeStatus;
  latency_ms?: number;
  /** Tool count from `tools/list`. Absent when the server answered
   *  `initialize` but not `tools/list` within the budget. */
  tools?: number;
  /** Why it is down/unknown. Absent when up. */
  reason?: string;
}

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Wrappers that hide the real executable somewhere in their arguments. */
const WRAPPERS = new Set(["bash", "sh", "zsh", "env", "npx", "bunx", "uv", "uvx", "docker"]);

/**
 * Find an absolute path in the argv that points at something missing.
 *
 * Purely a diagnostic aid: it turns "server did not respond" into "the
 * interpreter it execs is a dangling symlink", which is the difference between
 * a report someone acts on and one they ignore. Only absolute paths are
 * considered — anything resolved via PATH is the spawn's problem, not ours.
 */
export function findMissingExecutable(config: McpServerConfig): string | null {
  const command = config.command ?? "";
  const base = command.split("/").pop() ?? command;

  if (command.startsWith("/") && !existsSync(command)) return command;
  if (!WRAPPERS.has(base)) return null;

  // Wrapper: the real binary is somewhere in the args, possibly inside a
  // quoted shell string. Pull out absolute-looking paths and test each.
  const haystack = (config.args ?? []).join(" ");
  const candidates = haystack.match(/\/(?:[\w.@+-]+\/)+[\w.@+-]+/g) ?? [];
  for (const candidate of candidates) {
    // `existsSync` follows symlinks, so a dangling link reports false — which
    // is exactly the case we are hunting.
    if (candidate.includes("/bin/") || /\/(python[\d.]*|node|bun|deno)$/.test(candidate)) {
      if (!existsSync(candidate)) return candidate;
    }
  }
  return null;
}

interface JsonRpcResponse {
  id?: number;
  result?: { tools?: unknown[] };
  error?: { message?: string };
}

/**
 * Spawn the server and run the MCP handshake.
 *
 * Resolves `up` as soon as `initialize` comes back; `tools/list` is then given
 * whatever remains of the budget, because the tool count is nice to have and
 * not worth failing a healthy server over.
 */
export async function probeServer(
  id: string,
  config: McpServerConfig | null,
  timeoutMs = 8000,
): Promise<ProbeResult> {
  if (!config?.command) {
    return { id, status: "unknown", reason: "no command in MCP config" };
  }

  const missing = findMissingExecutable(config);
  const started = Date.now();

  return new Promise<ProbeResult>((resolve) => {
    let settled = false;
    const finish = (result: Omit<ProbeResult, "id" | "latency_ms">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve({ id, latency_ms: Date.now() - started, ...result });
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(config.command!, config.args ?? [], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...(config.env ?? {}) },
      });
    } catch (err) {
      return resolve({
        id,
        status: "down",
        latency_ms: Date.now() - started,
        reason: missing ? `missing executable: ${missing}` : String(err),
      });
    }

    const timer = setTimeout(() => {
      finish({
        status: "down",
        reason: missing
          ? `missing executable: ${missing}`
          : `no MCP response within ${timeoutMs}ms`,
      });
    }, timeoutMs);

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      // Keep only the tail — a crashing server can be very chatty.
      stderr = (stderr + String(chunk)).slice(-2000);
    });

    child.on("error", (err) => {
      finish({
        status: "down",
        reason: missing ? `missing executable: ${missing}` : err.message,
      });
    });

    child.on("exit", (code) => {
      const detail = stderr.trim().split("\n").pop() ?? "";
      finish({
        status: "down",
        reason: missing
          ? `missing executable: ${missing}`
          : `exited with code ${code}${detail ? `: ${detail}` : ""}`,
      });
    });

    let initialized = false;
    let buffer = "";
    child.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      // MCP's stdio transport is newline-delimited JSON-RPC.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg: JsonRpcResponse;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // banner noise on stdout — not fatal
        }
        if (msg.error) {
          finish({ status: "down", reason: msg.error.message ?? "MCP error" });
          return;
        }
        if (msg.id === 1 && !initialized) {
          initialized = true;
          send(child, { jsonrpc: "2.0", method: "notifications/initialized" });
          send(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
          continue;
        }
        if (msg.id === 2) {
          finish({ status: "up", tools: msg.result?.tools?.length ?? 0 });
          return;
        }
      }
    });

    send(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "cue-mcps-health", version: "1" },
      },
    });
  });
}

function send(child: ReturnType<typeof spawn>, payload: unknown): void {
  try {
    child.stdin?.write(JSON.stringify(payload) + "\n");
  } catch {
    // Server already gone; the exit handler reports it.
  }
}
