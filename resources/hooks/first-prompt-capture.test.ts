import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "first-prompt-capture.sh");

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "cue-first-prompt-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function run(payload: unknown): ReturnType<typeof spawnSync> {
  return spawnSync("bash", [SCRIPT], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
}

describe("first-prompt-capture UserPromptSubmit hook", () => {
  test("fails open when the prompt field is missing", () => {
    const result = run({});

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("captures a prompt when optional payload fields are missing", async () => {
    const result = run({ prompt: "fix the hook" });

    expect(result.status).toBe(0);
    const captureDir = join(home, ".config", "cue", "first-prompts");
    const files = await readdir(captureDir);
    expect(files).toHaveLength(1);

    const capture = JSON.parse(await readFile(join(captureDir, files[0]), "utf8"));
    expect(capture.prompt).toBe("fix the hook");
    expect(capture.session_id).toBe("");
  });
});
