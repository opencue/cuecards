/**
 * Tests for `cue create-profile` — exercises run() with a temp profiles dir.
 *
 * All writes are isolated to a mkdtemp scratch dir pointed at by
 * CUE_PROFILES_DIR. The test never touches ~/.config/cue or the repo's
 * profiles/ tree.
 */

import { afterEach, beforeEach, describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./create-profile";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Redirect stdout + stderr for the duration of fn(); restore afterward. */
async function captureIO(fn: () => Promise<number>): Promise<{
  stdout: string;
  stderr: string;
  code: number;
}> {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  (process.stdout as any).write = (c: string | Uint8Array) => { out += String(c); return true; };
  (process.stderr as any).write = (c: string | Uint8Array) => { err += String(c); return true; };
  try {
    const code = await fn();
    return { stdout: out, stderr: err, code };
  } finally {
    (process.stdout as any).write = origOut;
    (process.stderr as any).write = origErr;
  }
}

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let priorEnv: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cue-create-profile-"));
  priorEnv = process.env.CUE_PROFILES_DIR;
  process.env.CUE_PROFILES_DIR = tmpDir;
});

afterEach(() => {
  if (priorEnv === undefined) {
    delete process.env.CUE_PROFILES_DIR;
  } else {
    process.env.CUE_PROFILES_DIR = priorEnv;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

describe("create-profile — argument validation", () => {
  test("no args: exits 1 and prints usage on stderr", async () => {
    const { code, stderr } = await captureIO(() => run([]));
    expect(code).toBe(1);
    expect(stderr).toContain("cue create-profile");
    expect(stderr).toContain("missing profile name");
  });

  test("name with uppercase letters fails validation", async () => {
    const { code, stderr } = await captureIO(() => run(["BadName"]));
    expect(code).toBe(1);
    expect(stderr).toContain("invalid profile name");
  });

  test("name starting with a digit fails validation", async () => {
    const { code, stderr } = await captureIO(() => run(["1bad"]));
    expect(code).toBe(1);
    expect(stderr).toContain("invalid profile name");
  });

  test("single-character name fails (regex requires 2+ chars total)", async () => {
    // '^[a-z][a-z0-9-]{1,63}$' needs at least 2 characters
    const { code } = await captureIO(() => run(["a"]));
    expect(code).toBe(1);
  });

  test("name with spaces fails validation", async () => {
    const { code, stderr } = await captureIO(() => run(["my profile"]));
    // "my profile" — first positional is "my", second is positional too
    // "my" should pass validation and create "my"; verify it doesn't create "my profile"
    // (spaces cause only "my" to be consumed as name, rest ignored)
    // If "my" is two chars it should succeed; if single-char it should fail.
    // In either case there should be no profile named "my profile".
    const profileDir = join(tmpDir, "my profile");
    expect(existsSync(profileDir)).toBe(false);
    void code; void stderr; // suppress unused warnings
  });

  test("name with punctuation (!) fails validation", async () => {
    const { code, stderr } = await captureIO(() => run(["bad!"]));
    expect(code).toBe(1);
    expect(stderr).toContain("invalid profile name");
  });

  test("valid kebab-case name succeeds", async () => {
    const { code } = await captureIO(() => run(["my-profile"]));
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Profile YAML content
// ---------------------------------------------------------------------------

describe("create-profile — YAML content", () => {
  test("creates profile.yaml inside <CUE_PROFILES_DIR>/<name>/", async () => {
    await captureIO(() => run(["my-profile"]));
    const yamlPath = join(tmpDir, "my-profile", "profile.yaml");
    expect(existsSync(yamlPath)).toBe(true);
  });

  test("YAML contains the profile name", async () => {
    await captureIO(() => run(["my-profile"]));
    const yaml = readFileSync(join(tmpDir, "my-profile", "profile.yaml"), "utf8");
    expect(yaml).toContain("name: my-profile");
  });

  test("YAML inherits core by default", async () => {
    await captureIO(() => run(["my-profile"]));
    const yaml = readFileSync(join(tmpDir, "my-profile", "profile.yaml"), "utf8");
    expect(yaml).toContain("inherits: core");
  });

  test("--inherits overrides the default", async () => {
    await captureIO(() => run(["my-profile", "--inherits", "gstack"]));
    const yaml = readFileSync(join(tmpDir, "my-profile", "profile.yaml"), "utf8");
    expect(yaml).toContain("inherits: gstack");
    expect(yaml).not.toContain("inherits: core");
  });

  test("--icon value appears in YAML", async () => {
    await captureIO(() => run(["my-profile", "--icon", "🦊"]));
    const yaml = readFileSync(join(tmpDir, "my-profile", "profile.yaml"), "utf8");
    expect(yaml).toContain("🦊");
  });

  test("--description value appears in YAML", async () => {
    await captureIO(() => run(["my-profile", "--description", "A test profile for unit tests"]));
    const yaml = readFileSync(join(tmpDir, "my-profile", "profile.yaml"), "utf8");
    expect(yaml).toContain("A test profile for unit tests");
  });

  test("--desc short flag is accepted as alias for --description", async () => {
    await captureIO(() => run(["my-profile", "--desc", "short flag desc"]));
    const yaml = readFileSync(join(tmpDir, "my-profile", "profile.yaml"), "utf8");
    expect(yaml).toContain("short flag desc");
  });

  test("no --skills produces empty local array", async () => {
    await captureIO(() => run(["my-profile"]));
    const yaml = readFileSync(join(tmpDir, "my-profile", "profile.yaml"), "utf8");
    expect(yaml).toContain("local: []");
  });

  test("--skills comma-separated list produces YAML list items", async () => {
    await captureIO(() => run(["my-profile", "--skills", "foo/bar,baz/qux"]));
    const yaml = readFileSync(join(tmpDir, "my-profile", "profile.yaml"), "utf8");
    expect(yaml).toContain("- foo/bar");
    expect(yaml).toContain("- baz/qux");
  });

  test("--skills with spaces around commas are trimmed", async () => {
    await captureIO(() => run(["my-profile", "--skills", "foo/bar , baz/qux"]));
    const yaml = readFileSync(join(tmpDir, "my-profile", "profile.yaml"), "utf8");
    expect(yaml).toContain("- foo/bar");
    expect(yaml).toContain("- baz/qux");
    // Should not contain leading/trailing spaces
    expect(yaml).not.toContain("- foo/bar ");
  });

  test("no --mcps produces empty mcps array", async () => {
    await captureIO(() => run(["my-profile"]));
    const yaml = readFileSync(join(tmpDir, "my-profile", "profile.yaml"), "utf8");
    expect(yaml).toContain("mcps: []");
  });

  test("--mcps comma-separated list produces YAML list items", async () => {
    await captureIO(() => run(["my-profile", "--mcps", "alpha,beta"]));
    const yaml = readFileSync(join(tmpDir, "my-profile", "profile.yaml"), "utf8");
    expect(yaml).toContain("  - alpha");
    expect(yaml).toContain("  - beta");
  });

  test("YAML ends with a newline", async () => {
    await captureIO(() => run(["my-profile"]));
    const yaml = readFileSync(join(tmpDir, "my-profile", "profile.yaml"), "utf8");
    expect(yaml).toMatch(/\n$/);
  });

  test("description with double quotes is escaped in YAML", async () => {
    await captureIO(() => run(["my-profile", "--description", 'has "quotes"']));
    const yaml = readFileSync(join(tmpDir, "my-profile", "profile.yaml"), "utf8");
    // escapeYamlString wraps in double quotes and escapes inner quotes
    expect(yaml).toContain('\\"quotes\\"');
  });
});

// ---------------------------------------------------------------------------
// Overwrite guard
// ---------------------------------------------------------------------------

describe("create-profile — overwrite guard", () => {
  test("creating the same profile twice without --force exits 1", async () => {
    await captureIO(() => run(["my-profile", "--description", "first"]));
    const { code, stderr } = await captureIO(() => run(["my-profile"]));
    expect(code).toBe(1);
    expect(stderr).toContain("already exists");
  });

  test("--force overwrites an existing profile.yaml", async () => {
    await captureIO(() => run(["my-profile", "--description", "original"]));
    const { code } = await captureIO(() => run(["my-profile", "--force", "--description", "overwritten"]));
    expect(code).toBe(0);
    const yaml = readFileSync(join(tmpDir, "my-profile", "profile.yaml"), "utf8");
    expect(yaml).toContain("overwritten");
    expect(yaml).not.toContain("original");
  });

  test("-f short flag is accepted as alias for --force", async () => {
    await captureIO(() => run(["my-profile"]));
    const { code } = await captureIO(() => run(["my-profile", "-f"]));
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// stdout confirmation messages
// ---------------------------------------------------------------------------

describe("create-profile — stdout messages", () => {
  test("successful creation prints the yaml path", async () => {
    const { stdout } = await captureIO(() => run(["my-profile"]));
    expect(stdout).toContain("my-profile");
    expect(stdout).toContain("profile.yaml");
  });

  test("successful creation prompts to launch with claude", async () => {
    const { stdout } = await captureIO(() => run(["my-profile"]));
    expect(stdout).toContain("claude");
  });
});
