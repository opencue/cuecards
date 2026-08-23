import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCloudInvocation, run } from "./cloud";

let root: string;
let previousXdg: string | undefined;
let stdout = "";
let stderr = "";
let originalStdout: typeof process.stdout.write;
let originalStderr: typeof process.stderr.write;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cue-cloud-"));
  previousXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = root;
  stdout = "";
  stderr = "";
  originalStdout = process.stdout.write.bind(process.stdout);
  originalStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stdout.write = originalStdout;
  process.stderr.write = originalStderr;
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdg;
  rmSync(root, { recursive: true, force: true });
});

describe("cloud compatibility routing", () => {
  test("resolves registry dispatch without consuming command arguments", () => {
    expect(
      resolveCloudInvocation(["my-profile"], ["bun", "cue", "push"]),
    ).toEqual({ command: "push", args: ["my-profile"] });
  });

  test("resolves direct invocation and strips the command", () => {
    expect(resolveCloudInvocation(["whoami"], ["bun", "test"])).toEqual({
      command: "whoami",
      args: [],
    });
  });

  test("logout removes the shared marketplace credential file", async () => {
    const dir = join(root, "cue");
    const file = join(dir, "credentials.json");
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, '{"apiUrl":"https://cuecards.cc","token":"secret"}');

    expect(await run(["logout"])).toBe(0);
    expect(existsSync(file)).toBe(false);
    expect(stdout).toContain("credentials cleared");
  });

  test("retired pull returns migration guidance without network access", async () => {
    expect(await run(["pull", "team/profile"])).toBe(1);
    expect(stderr).toContain("has been retired");
    expect(stderr).toContain("cue import");
  });

  test("push rejects an unsafe profile name before marketplace dispatch", async () => {
    expect(await run(["push", "../escape"])).toBe(1);
    expect(stderr).toContain("lowercase kebab-case");
  });
});
