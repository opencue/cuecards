/**
 * Tests for src/commands/import-profile.ts
 *
 * Only hermetic paths are tested — no network calls (URLs and org/repo
 * shortcuts require HTTP) and no writes to real config.
 *
 * Exported surface: run(args).
 * Unexported helpers tested indirectly: cmdImport source detection, cmdExport
 * profile-name extraction.
 *
 * P3 error paths:
 *  - no args          → usage error
 *  - export with no profile name → usage error
 *  - unresolvable local path → "Cannot resolve source"
 *  - export routing via --output flag
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./import-profile";

// ---- Output capture ----

let stderrBuf: string[];
let stdoutBuf: string[];
let origStdout: typeof process.stdout.write;
let origStderr: typeof process.stderr.write;

beforeEach(() => {
  stdoutBuf = [];
  stderrBuf = [];
  origStdout = process.stdout.write.bind(process.stdout);
  origStderr = process.stderr.write.bind(process.stderr);
  (process.stdout as any).write = (c: string | Uint8Array) => {
    stdoutBuf.push(typeof c === "string" ? c : Buffer.from(c).toString());
    return true;
  };
  (process.stderr as any).write = (c: string | Uint8Array) => {
    stderrBuf.push(typeof c === "string" ? c : Buffer.from(c).toString());
    return true;
  };
});

afterEach(() => {
  process.stdout.write = origStdout;
  process.stderr.write = origStderr;
});

// ---- No-arg error path ----

describe("cue import — missing source", () => {
  test("no args → usage error on stderr, returns 1", async () => {
    const code = await run([]);
    expect(code).toBe(1);
    const err = stderrBuf.join("");
    expect(err).toContain("Usage: cue import");
    expect(err).toContain("cue export");
  });
});

// ---- Export routing via --output flag ----

describe("cue export (via import-profile) — missing profile name", () => {
  test("--output without profile name → usage error, returns 1", async () => {
    // args.includes("--output") → routes to cmdExport.
    // Using "--output" as the lone arg: cmdExport receives ["--output"] and
    // profileName = args.find(a => !a.startsWith("-")) = undefined → usage error.
    const code = await run(["--output"]);
    expect(code).toBe(1);
    expect(stderrBuf.join("")).toContain("Usage: cue export");
  });

  test("'export' subword with no profile name → usage error, returns 1", async () => {
    const code = await run(["export"]);
    expect(code).toBe(1);
    expect(stderrBuf.join("")).toContain("Usage: cue export");
  });

  test("'export' subword with only flags → usage error, returns 1", async () => {
    const code = await run(["export", "--portable"]);
    expect(code).toBe(1);
    expect(stderrBuf.join("")).toContain("Usage: cue export");
  });
});

// ---- Unresolvable local path ----

describe("cue import — unresolvable source", () => {
  test("non-existent local path → stderr 'Cannot resolve source', returns 1", async () => {
    // A path that doesn't match a URL, doesn't exist on disk, and isn't
    // an org/repo pattern (contains a dot which is excluded from the regex).
    const code = await run(["totally-nonexistent-profile-x99z.yaml"]);
    expect(code).toBe(1);
    expect(stderrBuf.join("")).toContain("Cannot resolve source");
  });

  test("path with slashes but three segments is not org/repo pattern → cannot resolve", async () => {
    // The org/repo regex is /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/ — requires
    // exactly one slash with valid chars on each side. Three segments fail.
    const code = await run(["org/repo/extra"]);
    expect(code).toBe(1);
    expect(stderrBuf.join("")).toContain("Cannot resolve source");
  });
});

// ---- Import from local file ----

describe("cue import — local YAML error paths", () => {
  let tmpDir: string;
  let profilesRoot: string;
  let savedProfilesDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cue-import-profile-"));
    profilesRoot = join(tmpDir, "profiles");
    savedProfilesDir = process.env.CUE_PROFILES_DIR;
    process.env.CUE_PROFILES_DIR = profilesRoot;
  });

  afterEach(() => {
    if (savedProfilesDir === undefined) delete process.env.CUE_PROFILES_DIR;
    else process.env.CUE_PROFILES_DIR = savedProfilesDir;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("YAML missing 'name' field → stderr error, returns 1", async () => {
    const badYaml = join(tmpDir, "noname.yaml");
    writeFileSync(badYaml, "description: No name here\n");

    const code = await run([badYaml]);
    expect(code).toBe(1);
    expect(stderrBuf.join("")).toContain("name");
  });

  test("invalid YAML → 'Invalid YAML' error, returns 1", async () => {
    const badYaml = join(tmpDir, "invalid.yaml");
    writeFileSync(badYaml, "name: : :\n  [unbalanced\n");

    const code = await run([badYaml]);
    expect(code).toBe(1);
    expect(stderrBuf.join("")).toContain("Invalid YAML");
  });

  test("rejects a path-traversal profile name before writing", async () => {
    const badYaml = join(tmpDir, "traversal.yaml");
    writeFileSync(badYaml, "name: ../escape\ndescription: Unsafe\n");

    const code = await run([badYaml]);

    expect(code).toBe(1);
    expect(stderrBuf.join("")).toContain("Invalid profile name");
    expect(existsSync(join(tmpDir, "escape", "profile.yaml"))).toBe(false);
  });

  test("imports a valid profile into the configured profiles directory", async () => {
    const source = join(tmpDir, "valid.yaml");
    writeFileSync(source, "name: safe-profile\ndescription: Safe\n");

    const code = await run([source]);

    expect(code).toBe(0);
    const written = join(profilesRoot, "safe-profile", "profile.yaml");
    expect(existsSync(written)).toBe(true);
    expect(readFileSync(written, "utf8")).toContain("safe-profile");
  });
});

// ---- Export a real profile (P2) ----

describe("cue export — real profile to stdout", () => {
  let tmpDir: string;
  let savedProfilesDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cue-export-profile-"));
    savedProfilesDir = process.env.CUE_PROFILES_DIR;
    process.env.CUE_PROFILES_DIR = tmpDir;
  });

  afterEach(() => {
    if (savedProfilesDir === undefined) delete process.env.CUE_PROFILES_DIR;
    else process.env.CUE_PROFILES_DIR = savedProfilesDir;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("exports a valid profile as YAML to stdout (no --output)", async () => {
    // Create a minimal profile to export
    mkdirSync(join(tmpDir, "mypkg"), { recursive: true });
    writeFileSync(
      join(tmpDir, "mypkg", "profile.yaml"),
      "name: mypkg\ndescription: My test package\n",
    );

    const code = await run(["export", "mypkg"]);
    expect(code).toBe(0);
    const yaml = stdoutBuf.join("");
    expect(yaml).toContain("mypkg");
    // Portable metadata block is always emitted
    expect(yaml).toContain("_portable");
  });

  test("exports with --output writes file and confirms size", async () => {
    mkdirSync(join(tmpDir, "outpkg"), { recursive: true });
    writeFileSync(
      join(tmpDir, "outpkg", "profile.yaml"),
      "name: outpkg\ndescription: Output package\n",
    );
    const outputFile = join(tmpDir, "out-profile.yaml");

    const code = await run(["export", "outpkg", "--output", outputFile]);
    expect(code).toBe(0);
    const out = stdoutBuf.join("");
    expect(out).toContain("outpkg");
    expect(out).toContain("KB"); // size confirmation
    expect(existsSync(outputFile)).toBe(true);
    const content = readFileSync(outputFile, "utf8");
    expect(content).toContain("outpkg");
  });
});
