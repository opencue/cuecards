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
    const filtered = filterUnavailableMcpServers(
      {
        remote: { url: "https://example.test/mcp" },
        disabled: { command: "missing-command", enabled: false },
      },
      { isExecutable: () => false },
    );

    expect(Object.keys(filtered)).toEqual(["remote", "disabled"]);
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
});
