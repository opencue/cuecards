import { describe, expect, test } from "bun:test";

import {
  filterUnavailableMcpServers,
  type CommandAvailabilityOptions,
} from "./mcp-availability";

describe("filterUnavailableMcpServers", () => {
  test("drops unavailable local commands from a fresh Windows runtime", () => {
    const available = new Set([String.raw`C:\Program Files\nodejs\npx.CMD`]);
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
      },
      options,
    );

    expect(Object.keys(filtered)).toEqual(["context7"]);
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
});
