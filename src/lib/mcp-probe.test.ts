import { describe, expect, test } from "bun:test";
import { mkdtempSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findMissingExecutable, probeServer } from "./mcp-probe";

const tmp = mkdtempSync(join(tmpdir(), "mcp-probe-"));

describe("findMissingExecutable", () => {
  test("catches a dangling symlink hidden inside a bash -lc wrapper", () => {
    // This is the secret-mcp shape verbatim: the launcher is `bash`, and the
    // interpreter that actually matters is a symlink to a uv-managed Python
    // that was uninstalled. `which bash` passes, so the old check said "up".
    const dangling = join(tmp, "venv", "bin", "python");
    symlinkSync("/nonexistent/cpython-3.14/bin/python3.14", ensureDir(dangling));

    expect(
      findMissingExecutable({
        command: "bash",
        args: ["-lc", `cd /srv && export FOO=1; exec ${dangling} -m secret_mcp`],
      }),
    ).toBe(dangling);
  });

  test("passes a wrapper whose interpreter exists", () => {
    const real = join(tmp, "real", "bin", "python");
    writeFileSync(ensureDir(real), "#!/bin/sh\n");
    chmodSync(real, 0o755);

    expect(
      findMissingExecutable({ command: "bash", args: ["-lc", `exec ${real} -m thing`] }),
    ).toBeNull();
  });

  test("reports an absolute command that does not exist", () => {
    expect(findMissingExecutable({ command: "/opt/gone/server", args: [] })).toBe(
      "/opt/gone/server",
    );
  });

  test("leaves PATH-resolved commands to the spawn", () => {
    // Not our job to second-guess PATH — only absolute paths are checked.
    expect(findMissingExecutable({ command: "npx", args: ["-y", "some-mcp"] })).toBeNull();
  });
});

describe("probeServer", () => {
  test("reports up with a tool count when the server completes the handshake", async () => {
    const server = join(tmp, "fake-mcp.mjs");
    writeFileSync(
      server,
      `
let buf = "";
process.stdin.on("data", (c) => {
  buf += c;
  const lines = buf.split("\\n"); buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
    } else if (msg.method === "tools/list") {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "a" }, { name: "b" }] },
      }) + "\\n");
    }
  }
});
`,
    );

    const result = await probeServer("fake", { command: process.execPath, args: [server] }, 5000);
    expect(result.status).toBe("up");
    expect(result.tools).toBe(2);
  });

  test("reports down when the process dies immediately", async () => {
    const result = await probeServer(
      "dead",
      { command: process.execPath, args: ["-e", "process.exit(1)"] },
      5000,
    );
    expect(result.status).toBe("down");
    expect(result.reason).toContain("exited with code 1");
  });

  test("reports down, naming the missing interpreter, rather than a bare timeout", async () => {
    const gone = join(tmp, "also-gone", "bin", "python");
    symlinkSync("/nonexistent/python3.14", ensureDir(gone));

    const result = await probeServer(
      "broken",
      { command: "bash", args: ["-lc", `exec ${gone} -m x`] },
      5000,
    );
    expect(result.status).toBe("down");
    expect(result.reason).toContain(gone);
  });

  test("reports unknown when the MCP has no command", async () => {
    const result = await probeServer("nocmd", { args: [] }, 1000);
    expect(result.status).toBe("unknown");
  });
});

/** mkdir -p the parent of `file`, then hand `file` back. */
function ensureDir(file: string): string {
  require("node:fs").mkdirSync(join(file, ".."), { recursive: true });
  return file;
}
