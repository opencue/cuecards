import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { syncCodexAuth } from "../commands/launch";

describe("syncCodexAuth", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("copies canonical Codex auth into a Cue runtime", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cue-codex-auth-"));
    dirs.push(dir);
    const source = join(dir, "source.json");
    const destination = join(dir, "runtime.json");
    await writeFile(source, '{"tokens":{"access_token":"test"}}\n');

    expect(await syncCodexAuth(source, destination)).toBe(true);
    expect(await readFile(destination, "utf8")).toBe(await readFile(source, "utf8"));
  });

  test("fails open when no canonical login exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cue-codex-auth-"));
    dirs.push(dir);
    expect(await syncCodexAuth(join(dir, "missing.json"), join(dir, "runtime.json"))).toBe(false);
  });
});
