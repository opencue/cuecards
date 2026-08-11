import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { syncCodexAuth } from "./codex-auth";

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

    expect(await syncCodexAuth(source, destination)).toEqual({ status: "copied" });
    expect(await readFile(destination, "utf8")).toBe(await readFile(source, "utf8"));
  });

  test("fails open when no canonical login exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cue-codex-auth-"));
    dirs.push(dir);
    expect(await syncCodexAuth(join(dir, "missing.json"), join(dir, "runtime.json")))
      .toEqual({ status: "invalid-source" });
  });

  test("never overwrites a newer destination from a stale concurrent session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cue-codex-auth-"));
    dirs.push(dir);
    const stale = join(dir, "stale.json");
    const fresh = join(dir, "fresh.json");
    await writeFile(stale, JSON.stringify({ tokens: { access_token: "old" }, last_refresh: "2026-08-10T09:00:00Z" }));
    await writeFile(fresh, JSON.stringify({ tokens: { access_token: "new" }, last_refresh: "2026-08-10T10:00:00Z" }));

    expect(await syncCodexAuth(stale, fresh)).toEqual({ status: "up-to-date" });
    expect(JSON.parse(await readFile(fresh, "utf8")).tokens.access_token).toBe("new");
  });

  test("copies a newer login atomically with private permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cue-codex-auth-"));
    dirs.push(dir);
    const fresh = join(dir, "fresh.json");
    const stale = join(dir, "nested", "auth.json");
    await writeFile(fresh, JSON.stringify({ auth_mode: "chatgpt", tokens: {}, last_refresh: "2026-08-10T10:00:00Z" }));

    expect(await syncCodexAuth(fresh, stale)).toEqual({ status: "copied" });
    expect((await stat(stale)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(stale, "utf8")).auth_mode).toBe("chatgpt");
  });

  test("rejects malformed auth instead of replacing a valid login", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cue-codex-auth-"));
    dirs.push(dir);
    const malformed = join(dir, "bad.json");
    const valid = join(dir, "auth.json");
    await writeFile(malformed, "{not-json");
    await writeFile(valid, JSON.stringify({ tokens: { access_token: "keep" } }));

    expect(await syncCodexAuth(malformed, valid)).toEqual({ status: "invalid-source" });
    expect(JSON.parse(await readFile(valid, "utf8")).tokens.access_token).toBe("keep");
  });

  test("returns an error result when the destination cannot be created", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cue-codex-auth-"));
    dirs.push(dir);
    const source = join(dir, "source.json");
    const blockedParent = join(dir, "blocked");
    await writeFile(source, '{"tokens":{"access_token":"test"}}\n');
    await writeFile(blockedParent, "not-a-directory");

    const result = await syncCodexAuth(source, join(blockedParent, "auth.json"));
    expect(result.status).toBe("error");
  });
});
