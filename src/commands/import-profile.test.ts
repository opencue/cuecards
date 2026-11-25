/**
 * Tests for src/commands/import-profile.ts
 *
 * Tests make no live network calls or writes to real config.
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

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { loadProfile } from "../lib/profile-loader";
import { applyProjectLoadout } from "../lib/project-loadout";
import { createLocalSkillResolver } from "../lib/resolver-local";
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
    expect(existsSync(written)).toBe(false);
    expect(stdoutBuf.join("")).toContain("--apply");
    expect(await run([source, "--apply"])).toBe(0);
    expect(existsSync(written)).toBe(true);
    expect(readFileSync(written, "utf8")).toContain("safe-profile");
    expect(await run([source, "--apply"])).toBe(1);
    expect(readFileSync(written, "utf8")).toContain("Safe");
  });

  test("requires a matching preview digest before applying a remote profile", async () => {
    const source = "https://example.com/team.yaml";
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response("name: remote-team\ndescription: Safe\n"));
    try {
      expect(await run([source, "--apply"])).toBe(1);
      expect(fetch).not.toHaveBeenCalled();
      expect(await run([source])).toBe(0);
      const digest = stdoutBuf.join("").match(/^SHA-256: ([a-f0-9]{64})$/m)?.[1];
      expect(digest).toBeDefined();
      const written = join(profilesRoot, "remote-team", "profile.yaml");
      expect(existsSync(written)).toBe(false);
      expect(await run([source, "--apply", "--sha256", "0".repeat(64)])).toBe(1);
      expect(existsSync(written)).toBe(false);
      expect(await run([source, "--apply", "--sha256", digest!])).toBe(0);
      expect(existsSync(written)).toBe(true);
    } finally {
      fetch.mockRestore();
    }
  });
});

test("portable export pins local and remote skills, omits env and previews before applying", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cue-portable-profile-"));
  const prev = { CUE_REPO_ROOT: process.env.CUE_REPO_ROOT, CUE_PROFILES_DIR: process.env.CUE_PROFILES_DIR,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  const root = join(dir, "repo");
  const profiles = join(root, "profiles");
  const skillsRoot = join(root, "resources", "skills", "skills");
  const skill = join(skillsRoot, "tools", "portable-example");
  try {
    mkdirSync(join(profiles, "example"), { recursive: true });
    const originalSchema = join(import.meta.dir, "..", "..", "profiles", "schema.json");
    writeFileSync(join(profiles, "schema.json"), readFileSync(originalSchema));
    mkdirSync(join(skill, "references"), { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), "---\nname: portable-example\ndescription: Demo\n---\nRun the checks.\n");
    writeFileSync(join(skill, "references", "checks.md"), "original\n");
    writeFileSync(join(skill, "references", "prepare.sh"), "#!/bin/sh\nexit 0\n");
    if (process.platform !== "win32") chmodSync(join(skill, "references", "prepare.sh"), 0o755);
    writeFileSync(join(skill, ".env"), "PRIVATE=secret-in-env-file\n");
    writeFileSync(join(profiles, "example", "profile.yaml"), stringify({
      name: "example", description: "Portable example", env: { PRIVATE: "secret-in-profile" },
      skills: {
        local: [{ id: "tools/portable-example", agents: ["codex"] }],
        npx: [{ repo: "demo/skills", pin: "git@" + "a".repeat(40), skills: ["remote-example"] }],
      },
    }));
    Object.assign(process.env, { CUE_REPO_ROOT: root, CUE_PROFILES_DIR: profiles, XDG_CONFIG_HOME: join(dir, "config") });
    const bundle = join(dir, "pack.yaml");
    expect(await run(["export", "example", "--portable", "--output", bundle])).toBe(0);
    const serialized = readFileSync(bundle, "utf8");
    expect(serialized).not.toContain("secret-in-profile");
    expect(serialized).not.toContain("secret-in-env-file");
    const imported = join(profiles, "team-example", "profile.yaml");
    expect(await run([bundle, "--name", "team-example"])).toBe(0);
    expect(existsSync(imported)).toBe(false);
    expect(existsSync(join(dir, "config"))).toBe(false);
    expect(stdoutBuf.join("")).toContain("demo/skills");
    expect(stdoutBuf.join("")).toContain("references/checks.md");
    expect(await run([bundle, "--apply"])).toBe(1); // existing source profile is never replaced
    expect(await run([bundle, "--name", "team-example", "--apply"])).toBe(0);
    writeFileSync(join(skill, "references", "checks.md"), "changed locally\n");
    const loaded = await loadProfile("team-example");
    expect(loaded.skills.local[0]?.agents).toEqual(["codex"]);
    expect(loaded.skills.npx[0]?.pin).toBe("git@" + "a".repeat(40));
    const resolved = await createLocalSkillResolver({ skillsRoot })(loaded.skills.local[0]!.id);
    expect(readFileSync(join(resolved, "references", "checks.md"), "utf8")).toBe("original\n");
    if (process.platform !== "win32") {
      expect(statSync(join(resolved, "references", "prepare.sh")).mode & 0o777).toBe(0o700);
      expect(stdoutBuf.join("")).toContain("references/prepare.sh [executable]");
    }

    const pack = parse(serialized);
    expect(pack._portable.skills[0].files.map(({ path }: { path: string }) => path))
      .toEqual(["SKILL.md", "references/checks.md", "references/prepare.sh"]);
    loaded.skills.local.push(...Array.from({ length: 24 }, (_, index) => ({ id: `test/stub-${index}` })));
    const loadout = await applyProjectLoadout({
      profile: loaded, cwd: dir, pinDir: dir, persist: false,
      readSkill: async () => ({ description: "", path: "" }),
    });
    expect(loadout?.deferred.find(row => row.id === loaded.skills.local[0]?.id)?.path)
      .toBe(join(resolved, "SKILL.md"));
    expect(existsSync(join(dir, "config", "cue", "loadouts.json"))).toBe(false);

    const invalid = join(dir, "tampered.yaml");
    const companion = pack._portable.skills[0].files[2];
    companion.executable = !companion.executable;
    writeFileSync(invalid, stringify(pack));
    expect(await run([invalid, "--name", "tampered", "--apply"])).toBe(1);
    expect(stderrBuf.join("")).toContain("checksum does not match");
    companion.executable = !companion.executable;
    pack._portable.skills[0].files[0].path = "../outside";
    writeFileSync(invalid, stringify(pack));
    expect(await run([invalid, "--name", "tampered", "--apply"])).toBe(1);
    expect(existsSync(join(profiles, "tampered"))).toBe(false);
    expect(existsSync(join(dir, "outside"))).toBe(false);
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
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
