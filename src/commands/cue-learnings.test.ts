import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const LEARNINGS_BIN = join(REPO_ROOT, "bin", "cue-learnings");
const scratch: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("cue-learnings", () => {
  test("is published as a global package command", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    expect(pkg.bin["cue-learnings"]).toBe("bin/cue-learnings");
  });

  test("logs valid JSONL when invoked through a global-style symlink", () => {
    const home = tempDir("cue-learnings-home-");
    const project = tempDir("cue-learnings-project-");
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const installedBin = join(binDir, "cue-learnings");
    symlinkSync(LEARNINGS_BIN, installedBin);
    const env = {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    };

    const result = spawnSync(
      installedBin,
      [
        "log",
        "--type",
        "tool",
        "--key",
        "global-command",
        "--insight",
        'Works outside the repo with "quotes" and \\slashes.',
        "--confidence",
        "9",
        "--source",
        "observed",
      ],
      { cwd: project, env, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    const file = join(home, ".cue", "projects", basename(project), "learnings.jsonl");
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      slug: basename(project),
      branch: "unknown",
      type: "tool",
      key: "global-command",
      insight: 'Works outside the repo with "quotes" and \\slashes.',
      confidence: 9,
      source: "observed",
      files: null,
    });
  });
});
