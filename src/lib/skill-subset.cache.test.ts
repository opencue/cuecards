import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { __test, classifierSpawnArgs, selectRelevantSkills } from "./skill-subset";

const {
  subsetCacheKey,
  subsetCacheDir,
  readSubsetCache,
  writeSubsetCache,
  finalizeSelection,
  CACHE_VERSION,
} = __test;

// --- env isolation: redirect the cache dir to a temp dir, restore after each ---
let tmp: string;
let prevXdg: string | undefined;

beforeEach(() => {
  prevXdg = process.env.XDG_CACHE_HOME;
  tmp = mkdtempSync(join(tmpdir(), "cue-subset-"));
  process.env.XDG_CACHE_HOME = tmp;
});

afterEach(() => {
  if (prevXdg === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = prevXdg;
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

const desc = (ids: string[]) => ids.map(id => ({ id, description: "" }));

describe("subsetCacheKey", () => {
  test("is deterministic for the same inputs", () => {
    const ids = ["s/a", "s/b", "s/c", "s/d", "s/e"];
    const k1 = subsetCacheKey(ids, "build an oauth flow", desc(ids));
    const k2 = subsetCacheKey(ids, "build an oauth flow", desc(ids));
    expect(k1).toBe(k2);
  });

  test("is order-independent over skill ids", () => {
    const a = subsetCacheKey(["s/a", "s/b", "s/c"], "p prompt", desc(["s/a", "s/b", "s/c"]));
    const b = subsetCacheKey(["s/c", "s/a", "s/b"], "p prompt", desc(["s/c", "s/a", "s/b"]));
    expect(a).toBe(b);
  });

  test("changes when the prompt changes", () => {
    const ids = ["s/a", "s/b", "s/c"];
    expect(subsetCacheKey(ids, "prompt one", desc(ids))).not.toBe(subsetCacheKey(ids, "prompt two", desc(ids)));
  });

  test("changes when a skill description changes (SKILL.md edit invalidates)", () => {
    const ids = ["s/a", "s/b"];
    const withOld = [{ id: "s/a", description: "old" }, { id: "s/b", description: "" }];
    const withNew = [{ id: "s/a", description: "new" }, { id: "s/b", description: "" }];
    expect(subsetCacheKey(ids, "same prompt", withOld)).not.toBe(subsetCacheKey(ids, "same prompt", withNew));
  });

  test("changes when the skill set changes", () => {
    expect(subsetCacheKey(["s/a", "s/b"], "p", desc(["s/a", "s/b"])))
      .not.toBe(subsetCacheKey(["s/a", "s/b", "s/c"], "p", desc(["s/a", "s/b", "s/c"])));
  });
});

describe("write/read cache round-trip", () => {
  test("read returns null on miss", () => {
    expect(readSubsetCache("deadbeefdeadbeefdeadbeef")).toBeNull();
  });

  test("round-trips picked + why and stores under subsetCacheDir", () => {
    writeSubsetCache("key1234567890key1234567", ["s/a", "s/b"], "because");
    const got = readSubsetCache("key1234567890key1234567");
    expect(got?.picked).toEqual(["s/a", "s/b"]);
    expect(got?.why).toBe("because");
    expect(existsSync(join(subsetCacheDir(), "key1234567890key1234567.json"))).toBe(true);
  });

  test("expired entries read as null", () => {
    const key = "expirekeyexpirekeyexpire";
    writeSubsetCache(key, ["s/a"], "old");
    const file = join(subsetCacheDir(), `${key}.json`);
    const entry = JSON.parse(readFileSync(file, "utf8"));
    entry.ts = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days ago (TTL is 7)
    writeFileSync(file, JSON.stringify(entry));
    expect(readSubsetCache(key)).toBeNull();
  });

  test("version mismatch reads as null", () => {
    const key = "versionkeyversionkeyvers";
    writeSubsetCache(key, ["s/a"], "x");
    const file = join(subsetCacheDir(), `${key}.json`);
    const entry = JSON.parse(readFileSync(file, "utf8"));
    entry.v = CACHE_VERSION + 999;
    writeFileSync(file, JSON.stringify(entry));
    expect(readSubsetCache(key)).toBeNull();
  });

  test("corrupt JSON reads as null", () => {
    writeSubsetCache("corruptcorruptcorruptcor", ["s/a"], "x");
    writeFileSync(join(subsetCacheDir(), "corruptcorruptcorruptcor.json"), "{not json");
    expect(readSubsetCache("corruptcorruptcorruptcor")).toBeNull();
  });
});

describe("finalizeSelection", () => {
  test("applies ALWAYS_KEEP even when the classifier omits it", () => {
    const ids = ["meta/analyze", "s/b", "s/c", "s/d", "s/e"];
    const r = finalizeSelection(["s/b", "s/c"], ids, 3, "why");
    expect(r?.selected).toContain("meta/analyze");
  });

  test("returns null when the result keeps fewer than minKeep", () => {
    expect(finalizeSelection(["s/b"], ["s/a", "s/b", "s/c"], 3, "why")).toBeNull();
  });

  test("preserves original ordering", () => {
    const ids = ["s/a", "s/b", "s/c", "s/d"];
    const r = finalizeSelection(["s/c", "s/a"], ids, 2, "why");
    expect(r?.selected).toEqual(["s/a", "s/c"]);
  });
});

describe("selectRelevantSkills — warm cache hit (no LLM call)", () => {
  test("serves the cached keep-set with a (cached) reason", async () => {
    const ids = ["s/a", "s/b", "s/c", "s/d", "s/e"];
    const prompt = "implement an oauth login flow";
    // Pre-seed the cache with the exact key selectRelevantSkills will compute.
    // These ids don't resolve to real skills, so descriptions are empty "".
    const key = subsetCacheKey(ids, prompt, desc(ids));
    writeSubsetCache(key, ["s/a", "s/b", "s/c"], "test reason");

    const result = await selectRelevantSkills(ids, prompt);
    expect(result.classified).toBe(true);
    expect(result.selected).toEqual(["s/a", "s/b", "s/c"]);
    expect(result.reason).toContain("(cached)");
  });
});

// --- classifier spawn args: the launch-freeze guard -------------------------
// The classifier claude must NOT boot the user's MCP servers (observed: a
// dozen npm/python daemons per call, blowing the 30s budget and freezing
// `cue launch`), and must use a fast model instead of the account default.
describe("classifierSpawnArgs", () => {
  test("always passes --strict-mcp-config and a --print prompt", () => {
    const args = classifierSpawnArgs("pick skills");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--print");
    expect(args.slice(-2)).toEqual(["-p", "pick skills"]);
  });

  test("defaults the model to haiku, overridable via CUE_SMART_SUBSET_MODEL", () => {
    const prev = process.env.CUE_SMART_SUBSET_MODEL;
    delete process.env.CUE_SMART_SUBSET_MODEL;
    try {
      let args = classifierSpawnArgs("x");
      expect(args[args.indexOf("--model") + 1]).toBe("haiku");

      process.env.CUE_SMART_SUBSET_MODEL = "claude-sonnet-5";
      args = classifierSpawnArgs("x");
      expect(args[args.indexOf("--model") + 1]).toBe("claude-sonnet-5");
    } finally {
      if (prev === undefined) delete process.env.CUE_SMART_SUBSET_MODEL;
      else process.env.CUE_SMART_SUBSET_MODEL = prev;
    }
  });
});
