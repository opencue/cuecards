import { describe, expect, test } from "bun:test";

import {
  filterUnavailableMcpServers,
  type CommandAvailabilityOptions,
} from "./mcp-availability";

describe("filterUnavailableMcpServers", () => {
  test("drops unavailable local commands from a fresh Windows runtime", () => {
    const available = new Set([
      String.raw`C:\Program Files\nodejs\npx.CMD`,
      String.raw`C:\Tools\mcp-server.EXE`,
    ]);
    const options: CommandAvailabilityOptions = {
      platform: "win32",
      cwd: String.raw`C:\Users\Felhasznalo\project`,
      env: {
        Path: String.raw`C:\Program Files\nodejs;C:\Windows\System32`,
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
        USERPROFILE: String.raw`C:\Users\Felhasznalo`,
      },
      isExecutable: (path) => available.has(path),
    };

    const filtered = filterUnavailableMcpServers(
      {
        codegraph: { command: "codegraph", args: ["serve", "--mcp"] },
        headroom: { command: "headroom", args: ["mcp", "serve"] },
        "cue-tty-watch": {
          command: String.raw`C:\Users\Felhasznalo\cue\bin\cue-tty-watch.exe`,
        },
        context7: {
          command: "npx",
          args: ["-y", "@upstash/context7-mcp"],
        },
        extensionless: { command: String.raw`C:\Tools\mcp-server` },
      },
      options,
    );

    expect(Object.keys(filtered)).toEqual(["context7", "extensionless"]);
  });

  test("keeps remote and explicitly disabled servers without probing a command", () => {
    let probes = 0;
    const filtered = filterUnavailableMcpServers(
      {
        remote: { url: "https://example.test/mcp" },
        disabled: { command: "missing-command", enabled: false },
      },
      {
        isExecutable: () => {
          probes += 1;
          return false;
        },
      },
    );

    expect(Object.keys(filtered)).toEqual(["remote", "disabled"]);
    expect(probes).toBe(0);
  });

  test("resolves commands against the MCP server's PATH override", () => {
    const filtered = filterUnavailableMcpServers(
      {
        local: {
          command: "mcp-server",
          env: { Path: String.raw`C:\Mcp` },
        },
      },
      {
        platform: "win32",
        env: { Path: String.raw`C:\Windows`, PATHEXT: ".EXE" },
        isExecutable: (path) => path === String.raw`C:\Mcp\mcp-server.EXE`,
      },
    );

    expect(Object.keys(filtered)).toEqual(["local"]);
  });

  test("resolves relative PATH entries in the MCP launch cwd", () => {
    const filtered = filterUnavailableMcpServers(
      {
        local: {
          command: "mcp-server",
          cwd: "/project",
          env: { PATH: "bin" },
        },
      },
      {
        platform: "linux",
        cwd: "/workspace",
        env: { PATH: "/usr/bin" },
        isExecutable: (path) => path === "/project/bin/mcp-server",
      },
    );

    expect(Object.keys(filtered)).toEqual(["local"]);
  });

  test("resolves relative command paths in the MCP launch cwd", () => {
    const filtered = filterUnavailableMcpServers(
      {
        local: {
          command: "./bin/mcp-server",
          cwd: String.raw`C:\Project`,
        },
        missing: {
          command: "./bin/missing-server",
          cwd: String.raw`C:\Project`,
        },
      },
      {
        platform: "win32",
        env: { Path: "", PATHEXT: ".EXE" },
        isExecutable: (path) => path === String.raw`C:\Project\bin\mcp-server.EXE`,
      },
    );

    expect(Object.keys(filtered)).toEqual(["local"]);
  });

  test("probes explicit Windows extensions even when PATHEXT omits them", () => {
    const command = String.raw`C:\Tools\mcp-server.exe`;
    const filtered = filterUnavailableMcpServers(
      { local: { command } },
      {
        platform: "win32",
        env: { Path: "", PATHEXT: ".CMD" },
        isExecutable: (path) => path === command,
      },
    );

    expect(Object.keys(filtered)).toEqual(["local"]);
  });

  test("rejects non-executable Windows file extensions", () => {
    const command = String.raw`C:\Tools\mcp-server.txt`;
    const filtered = filterUnavailableMcpServers(
      { local: { command } },
      {
        platform: "win32",
        env: { Path: "", PATHEXT: ".CMD" },
        isExecutable: (path) => path === command,
      },
    );

    expect(Object.keys(filtered)).toEqual([]);
  });

  test("finds bare Windows executables when PATHEXT omits EXE", () => {
    const filtered = filterUnavailableMcpServers(
      { local: { command: "mcp-server" } },
      {
        platform: "win32",
        env: { Path: String.raw`C:\Tools`, PATHEXT: ".CMD" },
        isExecutable: (path) => path === String.raw`C:\Tools\mcp-server.EXE`,
      },
    );

    expect(Object.keys(filtered)).toEqual(["local"]);
  });

  test("searches the Windows MCP launch cwd before PATH", () => {
    const filtered = filterUnavailableMcpServers(
      { local: { command: "mcp-server", cwd: String.raw`C:\Project` } },
      {
        platform: "win32",
        env: { Path: String.raw`C:\Windows`, PATHEXT: ".EXE" },
        isExecutable: (path) => path === String.raw`C:\Project\mcp-server.EXE`,
      },
    );

    expect(Object.keys(filtered)).toEqual(["local"]);
  });

  test("does not expand Windows percent variables on POSIX", () => {
    const command = "/opt/%HOME%/mcp-server";
    const filtered = filterUnavailableMcpServers(
      { local: { command } },
      {
        platform: "linux",
        env: { HOME: "/home/test", PATH: "" },
        isExecutable: (path) => path === command,
      },
    );

    expect(Object.keys(filtered)).toEqual(["local"]);
  });

  test("expands bare environment variables in POSIX PATH entries", () => {
    const filtered = filterUnavailableMcpServers(
      {
        local: {
          command: "mcp-server",
          env: { PATH: "$HOME/bin:$PATH" },
        },
      },
      {
        platform: "linux",
        env: { HOME: "/home/test", PATH: "/usr/bin" },
        isExecutable: (path) => path === "/home/test/bin/mcp-server",
      },
    );

    expect(Object.keys(filtered)).toEqual(["local"]);
  });

  test("expands server environment references regardless of property order", () => {
    const filtered = filterUnavailableMcpServers(
      {
        local: {
          command: "mcp-server",
          env: {
            PATH: "$MCP_HOME/bin",
            MCP_HOME: "$ROOT/mcp",
            ROOT: "/opt",
          },
        },
      },
      {
        platform: "linux",
        env: { PATH: "/usr/bin" },
        isExecutable: (path) => path === "/opt/mcp/bin/mcp-server",
      },
    );

    expect(Object.keys(filtered)).toEqual(["local"]);
  });
});
