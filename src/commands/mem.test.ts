import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { run } from "./mem";

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

describe("cue mem run — help flag", () => {
  test("--help returns 0 and prints usage", async () => {
    setup();
    const code = await run(["--help"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("cue mem");
    expect(stdoutBuf).toContain("seed");
  });

  test("-h returns 0 and prints usage", async () => {
    setup();
    const code = await run(["-h"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("Usage:");
  });
});

describe("cue mem run — path subcommand (hermetic)", () => {
  test("path <profile> prints the isolated data dir path", async () => {
    setup();
    const code = await run(["path", "myprofile"]);
    expect(code).toBe(0);
    // claudeMemDataDir computes ~/.claude-mem/profiles/<safe-name>
    const expected = join(homedir(), ".claude-mem", "profiles", "myprofile");
    expect(stdoutBuf.trim()).toBe(expected);
  });

  test("path with profile containing special chars is sanitised", async () => {
    setup();
    const code = await run(["path", "a+b"]);
    expect(code).toBe(0);
    // '+' is allowed in the safe-char set, so it should be preserved as-is
    const expected = join(homedir(), ".claude-mem", "profiles", "a+b");
    expect(stdoutBuf.trim()).toBe(expected);
  });

  test("path with unsafe chars sanitises to underscores", async () => {
    setup();
    // '/' and ' ' are not in [A-Za-z0-9._+@-], so they become '_'
    await run(["path", "has/slash"]);
    expect(stdoutBuf).toContain("has_slash");
  });

  test("path with no profile name → returns 1 with error", async () => {
    setup();
    const code = await run(["path"]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("expected a <profile>");
  });

  test("path with only flags (no positional name) → returns 1", async () => {
    setup();
    const code = await run(["path", "--json"]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("expected a <profile>");
  });
});

describe("cue mem run — unknown subcommand", () => {
  test("unknown subcommand → returns 1 with error on stderr", async () => {
    setup();
    const code = await run(["nosuchsub"]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("nosuchsub");
  });
});
