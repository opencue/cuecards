import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { __test, shouldCopyBackCreds } from "./skill-subset";

const { setupClassifierHome, teardownClassifierHome, credExpiresAt } = __test;

// Item E: the classifier spawn must run in an ephemeral CLAUDE_CONFIG_DIR that
// carries NO plugins/hooks — only copied-in credentials — and must carry a
// rotated token back to the source without ever clobbering a live one.

describe("shouldCopyBackCreds", () => {
  test("copies back only a strictly newer token", () => {
    expect(shouldCopyBackCreds(200, 100)).toBe(true); // home refreshed → newer
    expect(shouldCopyBackCreds(100, 100)).toBe(false); // unchanged
    expect(shouldCopyBackCreds(50, 100)).toBe(false); // source already newer
  });
});

describe("classifier home isolation", () => {
  let tmp: string;
  let prevXdg: string | undefined;
  let prevConfig: string | undefined;

  beforeEach(() => {
    prevXdg = process.env.XDG_CACHE_HOME;
    prevConfig = process.env.CLAUDE_CONFIG_DIR;
    tmp = mkdtempSync(join(tmpdir(), "cue-iso-"));
    process.env.XDG_CACHE_HOME = tmp; // redirect cacheDir() into the temp tree
  });

  afterEach(() => {
    if (prevXdg === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = prevXdg;
    if (prevConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevConfig;
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ok */ }
  });

  test("returns null when no CLAUDE_CONFIG_DIR is set (inherit path)", () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    expect(setupClassifierHome()).toBeNull();
  });

  test("builds a home with empty settings, no plugins, and copied credentials", () => {
    const src = mkdtempSync(join(tmp, "src-"));
    writeFileSync(join(src, ".credentials.json"), JSON.stringify({ claudeAiOauth: { expiresAt: 111, accessToken: "live" } }));
    process.env.CLAUDE_CONFIG_DIR = src;

    const h = setupClassifierHome();
    expect(h).not.toBeNull();
    // settings.json must be empty: no enabledPlugins, no hooks.
    const settings = JSON.parse(readFileSync(join(h!.home, "settings.json"), "utf8"));
    expect(settings.enabledPlugins).toBeUndefined();
    expect(settings.hooks).toBeUndefined();
    // credentials copied in so the spawn can still auth.
    expect(existsSync(join(h!.home, ".credentials.json"))).toBe(true);
    expect(h!.credSrc).toBe(join(src, ".credentials.json"));

    teardownClassifierHome(h!);
    expect(existsSync(h!.home)).toBe(false); // temp home cleaned up
  });

  test("teardown carries a rotated (newer) token back to source", () => {
    const src = mkdtempSync(join(tmp, "src-"));
    const srcCred = join(src, ".credentials.json");
    writeFileSync(srcCred, JSON.stringify({ claudeAiOauth: { expiresAt: 100, accessToken: "old" } }));
    process.env.CLAUDE_CONFIG_DIR = src;

    const h = setupClassifierHome()!;
    // Simulate the classifier refreshing the OAuth token in its home.
    writeFileSync(join(h.home, ".credentials.json"), JSON.stringify({ claudeAiOauth: { expiresAt: 999, accessToken: "new" } }));
    teardownClassifierHome(h);

    expect(credExpiresAt(srcCred)).toBe(999);
    expect(JSON.parse(readFileSync(srcCred, "utf8")).claudeAiOauth.accessToken).toBe("new");
  });

  test("teardown never clobbers a live source token with a stale home copy", () => {
    const src = mkdtempSync(join(tmp, "src-"));
    const srcCred = join(src, ".credentials.json");
    writeFileSync(srcCred, JSON.stringify({ claudeAiOauth: { expiresAt: 500, accessToken: "live" } }));
    process.env.CLAUDE_CONFIG_DIR = src;

    const h = setupClassifierHome()!;
    // Home token is OLDER (a sibling launch rotated the source mid-classify).
    writeFileSync(join(h.home, ".credentials.json"), JSON.stringify({ claudeAiOauth: { expiresAt: 200, accessToken: "stale" } }));
    teardownClassifierHome(h);

    expect(JSON.parse(readFileSync(srcCred, "utf8")).claudeAiOauth.accessToken).toBe("live");
  });
});
