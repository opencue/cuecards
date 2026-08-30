/**
 * Tests for `cue packs` command.
 *
 * The command's only exported symbol is `run()`. `cmdList` / `cmdShow` /
 * `cmdCreate` are internal. Tests focus on:
 *  - Error paths that return before any filesystem write (hermetic)
 *  - Unknown-subcommand dispatch
 *
 * `cmdCreate` writes to the repo's resources/skill-packs dir (computed at
 * module load time from repoRoot(), with no env-var override). Tests that
 * would trigger a write are therefore excluded to keep the suite hermetic.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { run } from "./packs";

let stdoutBuf = "";
let stderrBuf = "";
let stdoutSpy: ReturnType<typeof spyOn>;
let stderrSpy: ReturnType<typeof spyOn>;

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
});

describe("cue packs — subcommand dispatch errors", () => {
  test("unknown subcommand returns 1 with hint in stderr", async () => {
    setup();
    const code = await run(["explode"]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("explode");
    expect(stderrBuf).toMatch(/list|show|create/i);
  });

  test("show without a name argument returns 1 with usage hint", async () => {
    setup();
    const code = await run(["show"]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("Usage");
    expect(stderrBuf).toContain("show");
  });

  test("show with a non-existent pack name returns 1", async () => {
    setup();
    const code = await run(["show", "this-pack-does-not-exist-xyzzy"]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("this-pack-does-not-exist-xyzzy");
  });

  test("create without a name argument returns 1 with usage hint", async () => {
    setup();
    const code = await run(["create"]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("Usage");
  });

  test("create with a name but no --skills returns 1", async () => {
    // Requires at least one skill — must bail before touching the filesystem.
    setup();
    const code = await run(["create", "my-pack"]);
    expect(code).toBe(1);
    expect(stderrBuf).toMatch(/skill/i);
  });
});

describe("cue packs list", () => {
  test("list returns 0 (pack dir may be empty or populated)", async () => {
    // We cannot control which packs are installed, but the command must
    // always exit cleanly when the directory exists or is absent.
    setup();
    const code = await run(["list"]);
    expect(code).toBe(0);
  });

  test("list --json emits valid JSON array", async () => {
    setup();
    const code = await run(["list", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdoutBuf);
    expect(Array.isArray(parsed)).toBe(true);
  });
});
