import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, lstat, readlink, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { linkPluginCache } from "./runtime-materializer";

/**
 * Re-materializing a runtime happens while sessions are live, so replacing the
 * plugin-cache symlink has to be atomic. The rm-then-symlink it used to do left
 * the path absent for a moment, and a hook firing in that window failed with
 * "Plugin directory does not exist … run /plugin to reinstall" — the very error
 * linkPluginCache exists to prevent.
 */
describe("linkPluginCache — atomic swap", () => {
  let src: string;
  let tgt: string;

  beforeEach(async () => {
    src = await mkdtemp(join(tmpdir(), "cue-plugsrc-"));
    tgt = await mkdtemp(join(tmpdir(), "cue-plugtgt-"));
    const verDir = join(src, "plugins", "cache", "thedotmack", "claude-mem", "13.13.1");
    await mkdir(verDir, { recursive: true });
    await writeFile(join(verDir, "hooks.json"), "{}");
    await mkdir(join(src, "plugins", "marketplaces"), { recursive: true });
    await writeFile(join(src, "plugins", "known_marketplaces.json"), "{}");
  });

  afterEach(async () => {
    await rm(src, { recursive: true, force: true });
    await rm(tgt, { recursive: true, force: true });
  });

  test("re-linking over an existing symlink keeps the version dir resolvable", async () => {
    await linkPluginCache(tgt, src);
    // Second pass is the one that used to open the window: the target is
    // already a symlink, so rm would unlink it before symlink recreated it.
    await linkPluginCache(tgt, src);

    const cacheLink = join(tgt, "plugins", "cache");
    expect((await lstat(cacheLink)).isSymbolicLink()).toBe(true);
    expect(await readlink(cacheLink)).toBe(join(src, "plugins", "cache"));
    const hooks = join(cacheLink, "thedotmack", "claude-mem", "13.13.1", "hooks.json");
    expect((await stat(hooks)).isFile()).toBe(true);
  });

  test("leaves no staging entries behind", async () => {
    await linkPluginCache(tgt, src);
    await linkPluginCache(tgt, src);

    const entries = await readdir(join(tgt, "plugins"));
    expect(entries.filter((e) => e.includes(".cue-tmp-"))).toEqual([]);
    expect(entries.sort()).toEqual(["cache", "known_marketplaces.json", "marketplaces"]);
  });

  test("still replaces Claude's lazy empty directory", async () => {
    // rename() refuses to clobber a real directory, so this exercises the
    // fallback path — first materialization, before any session reads it.
    await mkdir(join(tgt, "plugins", "cache"), { recursive: true });

    await linkPluginCache(tgt, src);

    const cacheLink = join(tgt, "plugins", "cache");
    expect((await lstat(cacheLink)).isSymbolicLink()).toBe(true);
    expect(await readlink(cacheLink)).toBe(join(src, "plugins", "cache"));
  });

  test("the target path is never absent while it is being replaced", async () => {
    // The actual invariant, and the only assertion here that fails against a
    // rm-then-symlink implementation: a reader polling the path across many
    // swaps must never see ENOENT. Cannot false-fail — an atomic rename has no
    // window in which the entry is missing.
    await linkPluginCache(tgt, src);
    const cacheLink = join(tgt, "plugins", "cache");

    let polling = true;
    let misses = 0;
    let polls = 0;
    const reader = (async () => {
      while (polling) {
        polls++;
        try {
          await lstat(cacheLink);
        } catch {
          misses++;
        }
      }
    })();

    for (let i = 0; i < 300; i++) await linkPluginCache(tgt, src);
    polling = false;
    await reader;

    expect(polls).toBeGreaterThan(0);
    expect(misses).toBe(0);
  });

  test("a source entry that disappears mid-run leaves the old link in place", async () => {
    await linkPluginCache(tgt, src);
    const cacheLink = join(tgt, "plugins", "cache");
    const before = await readlink(cacheLink);

    // symlink() itself doesn't require the source to exist, so the link stays
    // valid-shaped either way; what must not happen is the target vanishing.
    await rm(join(src, "plugins", "marketplaces"), { recursive: true, force: true });
    await linkPluginCache(tgt, src);

    expect((await lstat(cacheLink)).isSymbolicLink()).toBe(true);
    expect(await readlink(cacheLink)).toBe(before);
  });
});
