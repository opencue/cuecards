import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { repair } from "./auth";

describe("cue auth repair", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("fails when neither canonical nor runtime Codex credentials are valid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cue-auth-repair-"));
    dirs.push(dir);
    expect(await repair(dir, {
      canonical: join(dir, "canonical", "auth.json"),
      runtimeRoot: join(dir, "runtime"),
      healClaude: async () => {},
    })).toBe(1);
  });

  test("promotes the freshest runtime login to canonical and updates older runtimes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cue-auth-repair-"));
    dirs.push(dir);
    const canonical = join(dir, "canonical", "auth.json");
    const runtimeRoot = join(dir, "runtime");
    const fresh = join(runtimeRoot, "fresh-profile", "codex", "auth.json");
    const stale = join(runtimeRoot, "stale-profile", "codex", "auth.json");
    await mkdir(join(fresh, ".."), { recursive: true });
    await mkdir(join(stale, ".."), { recursive: true });
    await writeFile(fresh, JSON.stringify({ tokens: { access_token: "fresh" }, last_refresh: "2026-08-11T12:00:00Z" }));
    await writeFile(stale, JSON.stringify({ tokens: { access_token: "stale" }, last_refresh: "2026-08-10T12:00:00Z" }));

    expect(await repair(dir, { canonical, runtimeRoot, healClaude: async () => {} })).toBe(0);
    expect(JSON.parse(await readFile(canonical, "utf8")).tokens.access_token).toBe("fresh");
    expect(JSON.parse(await readFile(stale, "utf8")).tokens.access_token).toBe("fresh");
  });

  test("returns failure when a runtime destination cannot be written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cue-auth-repair-"));
    dirs.push(dir);
    const canonical = join(dir, "canonical", "auth.json");
    const runtimeRoot = join(dir, "runtime");
    await mkdir(join(canonical, ".."), { recursive: true });
    await mkdir(join(runtimeRoot, "broken-profile"), { recursive: true });
    await writeFile(canonical, JSON.stringify({ tokens: { access_token: "fresh" }, last_refresh: "2026-08-11T12:00:00Z" }));
    // A file at codex/ prevents mkdir(codex/) while still leaving the profile
    // visible to the runtime-root enumeration.
    await writeFile(join(runtimeRoot, "broken-profile", "codex"), "not-a-directory");

    expect(await repair(dir, { canonical, runtimeRoot, healClaude: async () => {} })).toBe(1);
  });
});
