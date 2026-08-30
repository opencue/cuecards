import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  classifierBinOrder,
  classifierSpawnArgs,
  credExpiresAt,
  setupClassifierHome,
  shouldCopyBackCreds,
  teardownClassifierHome,
} from "./claude-classifier";

const tmps: string[] = [];
function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "cue-classifier-"));
  tmps.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("classifierSpawnArgs", () => {
  test("keeps the spawn lightweight", () => {
    const args = classifierSpawnArgs("hello");
    // Without --strict-mcp-config the child boots every MCP server in the
    // user's config just to answer one line.
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--print");
    expect(args.at(-1)).toBe("hello");
  });

  test("defaults to a fast model", () => {
    const prev = process.env.CUE_SMART_SUBSET_MODEL;
    delete process.env.CUE_SMART_SUBSET_MODEL;
    try {
      const args = classifierSpawnArgs("x");
      expect(args[args.indexOf("--model") + 1]).toBe("haiku");
    } finally {
      if (prev !== undefined) process.env.CUE_SMART_SUBSET_MODEL = prev;
    }
  });

  test("honours the model override", () => {
    const prev = process.env.CUE_SMART_SUBSET_MODEL;
    process.env.CUE_SMART_SUBSET_MODEL = "sonnet";
    try {
      const args = classifierSpawnArgs("x");
      expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
    } finally {
      if (prev === undefined) delete process.env.CUE_SMART_SUBSET_MODEL;
      else process.env.CUE_SMART_SUBSET_MODEL = prev;
    }
  });

  // --bare skips credential loading and comes back "Not logged in".
  test("never passes --bare", () => {
    expect(classifierSpawnArgs("x")).not.toContain("--bare");
  });
});

describe("shouldCopyBackCreds", () => {
  // Anthropic rotates the refresh token on every refresh, so a stale copy must
  // never clobber a live source token.
  test("only carries back a strictly newer token", () => {
    expect(shouldCopyBackCreds(200, 100)).toBe(true);
    expect(shouldCopyBackCreds(100, 100)).toBe(false);
    expect(shouldCopyBackCreds(50, 100)).toBe(false);
  });
});

describe("credExpiresAt", () => {
  test("reads the OAuth expiry", () => {
    const d = tmpDir();
    const f = join(d, ".credentials.json");
    writeFileSync(f, JSON.stringify({ claudeAiOauth: { expiresAt: 12345 } }));
    expect(credExpiresAt(f)).toBe(12345);
  });

  test("returns 0 for missing, malformed, or shapeless files", () => {
    const d = tmpDir();
    expect(credExpiresAt(join(d, "nope.json"))).toBe(0);
    const bad = join(d, "bad.json");
    writeFileSync(bad, "{{{");
    expect(credExpiresAt(bad)).toBe(0);
    const empty = join(d, "empty.json");
    writeFileSync(empty, JSON.stringify({ other: true }));
    expect(credExpiresAt(empty)).toBe(0);
  });
});

describe("setupClassifierHome", () => {
  test("isolates against ~/.claude when CLAUDE_CONFIG_DIR is not set", () => {
    const prev = process.env.CLAUDE_CONFIG_DIR;
    const prevHome = process.env.HOME;
    const home = tmpDir();
    const defaultClaude = join(home, ".claude");
    mkdirSync(defaultClaude, { recursive: true });
    delete process.env.CLAUDE_CONFIG_DIR;
    process.env.HOME = home;
    try {
      const h = setupClassifierHome();
      expect(h).not.toBeNull();
      expect(readFileSync(join(h!.home, "settings.json"), "utf8")).toBe("{}\n");
      expect(h!.credSrc).toBeNull();
      teardownClassifierHome(h!);
    } finally {
      if (prev !== undefined) process.env.CLAUDE_CONFIG_DIR = prev;
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
    }
  });

  test("builds a minimal config that loads no plugins, hooks or MCP servers", () => {
    const src = tmpDir();
    const cache = tmpDir();
    const prevCfg = process.env.CLAUDE_CONFIG_DIR;
    const prevCache = process.env.XDG_CACHE_HOME;
    process.env.CLAUDE_CONFIG_DIR = src;
    process.env.XDG_CACHE_HOME = cache;
    try {
      const h = setupClassifierHome();
      expect(h).not.toBeNull();
      const settings = JSON.parse(readFileSync(join(h!.home, "settings.json"), "utf8")) as Record<string, unknown>;
      expect(settings).toEqual({});
      const claudeJson = JSON.parse(readFileSync(join(h!.home, ".claude.json"), "utf8")) as Record<string, unknown>;
      expect(claudeJson.hasCompletedOnboarding).toBe(true);
      teardownClassifierHome(h!);
      expect(existsSync(h!.home)).toBe(false);
    } finally {
      if (prevCfg === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prevCfg;
      if (prevCache === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = prevCache;
    }
  });

  test("copies live credentials in so the call still authenticates", () => {
    const src = tmpDir();
    const cache = tmpDir();
    writeFileSync(join(src, ".credentials.json"), JSON.stringify({ claudeAiOauth: { expiresAt: 999 } }));
    const prevCfg = process.env.CLAUDE_CONFIG_DIR;
    const prevCache = process.env.XDG_CACHE_HOME;
    process.env.CLAUDE_CONFIG_DIR = src;
    process.env.XDG_CACHE_HOME = cache;
    try {
      const h = setupClassifierHome()!;
      expect(credExpiresAt(join(h.home, ".credentials.json"))).toBe(999);
      expect(h.credSrc).toBe(join(src, ".credentials.json"));

      // Teardown must not clobber the source with an equal-or-older token.
      teardownClassifierHome(h);
      expect(credExpiresAt(join(src, ".credentials.json"))).toBe(999);
    } finally {
      if (prevCfg === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prevCfg;
      if (prevCache === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = prevCache;
    }
  });

  test("carries a rotated token back to the source", () => {
    const src = tmpDir();
    const cache = tmpDir();
    const srcCred = join(src, ".credentials.json");
    writeFileSync(srcCred, JSON.stringify({ claudeAiOauth: { expiresAt: 100 } }));
    const prevCfg = process.env.CLAUDE_CONFIG_DIR;
    const prevCache = process.env.XDG_CACHE_HOME;
    process.env.CLAUDE_CONFIG_DIR = src;
    process.env.XDG_CACHE_HOME = cache;
    try {
      const h = setupClassifierHome()!;
      // Simulate the child refreshing the token inside the ephemeral home.
      writeFileSync(join(h.home, ".credentials.json"), JSON.stringify({ claudeAiOauth: { expiresAt: 500 } }));
      teardownClassifierHome(h);
      expect(credExpiresAt(srcCred)).toBe(500);
    } finally {
      if (prevCfg === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prevCfg;
      if (prevCache === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = prevCache;
    }
  });
});

// The classifier used to spawn the bare name `claude`, trusting CUE_BYPASS to
// make cue's shim "transparent". It was not, at the time: nothing implemented
// the documented bypass, so the shim re-entered `cue launch`, which folded the
// child's own argv into a fresh classification prompt and spawned another
// classifier. `cue launch` now honors CUE_BYPASS for real, but resolving the
// real binary FIRST is still the better primary path — it skips a whole
// `cue launch` boot per classification, and holds on an older cue too.
describe("classifierBinOrder", () => {
  const prevPath = process.env.PATH;
  const prevReal = process.env.CUE_REAL_CLAUDE;
  const prevExec = process.env.CLAUDE_CODE_EXECPATH;
  afterEach(() => {
    process.env.PATH = prevPath;
    if (prevReal === undefined) delete process.env.CUE_REAL_CLAUDE;
    else process.env.CUE_REAL_CLAUDE = prevReal;
    if (prevExec === undefined) delete process.env.CLAUDE_CODE_EXECPATH;
    else process.env.CLAUDE_CODE_EXECPATH = prevExec;
  });

  test("puts the real binary ahead of the bare PATH name", () => {
    const realDir = tmpDir();
    const realBin = join(realDir, "claude");
    writeFileSync(realBin, "#!/usr/bin/env bash\necho real\n", { mode: 0o755 });
    delete process.env.CUE_REAL_CLAUDE;
    delete process.env.CLAUDE_CODE_EXECPATH;
    process.env.PATH = realDir;

    expect(classifierBinOrder()).toEqual([realBin, "claude"]);
  });

  test("skips a cue shim sitting earlier on PATH", () => {
    const shimHome = tmpDir();
    const realDir = tmpDir();
    const shimBin = join(shimHome, "claude");
    // Same body cue actually installs — the absolute-path `exec` form.
    writeFileSync(shimBin, '#!/usr/bin/env bash\nexec "/opt/cue/bin/cue" launch claude "$@"\n', { mode: 0o755 });
    const realBin = join(realDir, "claude");
    writeFileSync(realBin, "#!/usr/bin/env bash\necho real\n", { mode: 0o755 });
    delete process.env.CUE_REAL_CLAUDE;
    delete process.env.CLAUDE_CODE_EXECPATH;
    process.env.PATH = `${shimHome}:${realDir}`;

    expect(classifierBinOrder()[0]).toBe(realBin);
  });

  test("still falls back to the bare name when no real binary resolves", () => {
    delete process.env.CUE_REAL_CLAUDE;
    delete process.env.CLAUDE_CODE_EXECPATH;
    process.env.PATH = tmpDir(); // empty dir — nothing named claude
    expect(classifierBinOrder()).toEqual(["claude"]);
  });

  test("never returns duplicates", () => {
    const realDir = tmpDir();
    writeFileSync(join(realDir, "claude"), "#!/usr/bin/env bash\n", { mode: 0o755 });
    delete process.env.CUE_REAL_CLAUDE;
    delete process.env.CLAUDE_CODE_EXECPATH;
    process.env.PATH = realDir;
    const order = classifierBinOrder();
    expect(new Set(order).size).toBe(order.length);
  });
});
