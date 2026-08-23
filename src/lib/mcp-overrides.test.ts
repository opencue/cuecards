import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readMcpOverride,
  writeMcpOverride,
  mcpFingerprint,
  reconcileDisabledWithNeeded,
  autoPrunableMcps,
  withAutoPrunedGlobals,
  autoPruneEnabled,
  mcpPruneMode,
  isRecognizedPruneEnv,
  readRuntimeMcpServerIds,
} from "./mcp-overrides";
import { writeFile as writeFileAsync } from "node:fs/promises";

let dir: string;
let path: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cue-mcpov-"));
  path = join(dir, "mcp-overrides.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("mcpFingerprint", () => {
  test("is order-independent and case-insensitive", () => {
    expect(mcpFingerprint(["gbrain", "Coolify", "postgres"])).toBe(
      mcpFingerprint(["postgres", "coolify", "GBRAIN"]),
    );
  });

  test("changes when an MCP is added or removed", () => {
    expect(mcpFingerprint(["a", "b"])).not.toBe(mcpFingerprint(["a", "b", "c"]));
    expect(mcpFingerprint(["a", "b"])).not.toBe(mcpFingerprint(["a"]));
  });
});

describe("mcp-overrides round-trip", () => {
  test("write then read returns the same override", () => {
    const ov = { profile: "core+commerce", fingerprint: "abc123", disabled: ["gbrain"] };
    expect(writeMcpOverride("/proj/a", ov, path)).toBe(true);
    expect(readMcpOverride("/proj/a", path)).toEqual(ov);
  });

  test("missing directory key returns undefined", () => {
    writeMcpOverride("/proj/a", { profile: "core", fingerprint: "x", disabled: [] }, path);
    expect(readMcpOverride("/proj/nope", path)).toBeUndefined();
  });

  test("missing file returns undefined (no throw)", () => {
    expect(readMcpOverride("/proj/a", join(dir, "does-not-exist.json"))).toBeUndefined();
  });

  test("upsert keeps other directories intact", () => {
    writeMcpOverride("/proj/a", { profile: "core", fingerprint: "f1", disabled: ["x"] }, path);
    writeMcpOverride("/proj/b", { profile: "core", fingerprint: "f2", disabled: ["y"] }, path);
    expect(readMcpOverride("/proj/a", path)?.disabled).toEqual(["x"]);
    expect(readMcpOverride("/proj/b", path)?.disabled).toEqual(["y"]);
  });
});

describe("reconcileDisabledWithNeeded", () => {
  test("re-enables a disabled MCP that an active skill now needs", () => {
    // gbrain was disabled earlier; a skill added since needs it → re-enable it,
    // keep the genuinely-unused one off.
    const { keepDisabled, reEnabled } = reconcileDisabledWithNeeded(
      ["gbrain", "postiz"],
      ["gbrain"],
    );
    expect(reEnabled).toEqual(["gbrain"]);
    expect(keepDisabled).toEqual(["postiz"]);
  });

  test("keeps everything disabled when nothing is needed", () => {
    const { keepDisabled, reEnabled } = reconcileDisabledWithNeeded(["a", "b"], []);
    expect(reEnabled).toEqual([]);
    expect(keepDisabled).toEqual(["a", "b"]);
  });

  test("matches case-insensitively and lowercases output", () => {
    const { keepDisabled, reEnabled } = reconcileDisabledWithNeeded(
      ["GBrain", "Postiz"],
      new Set(["gbrain"]),
    );
    expect(reEnabled).toEqual(["gbrain"]);
    expect(keepDisabled).toEqual(["postiz"]);
  });

  test("empty disabled list yields empty splits", () => {
    const { keepDisabled, reEnabled } = reconcileDisabledWithNeeded([], ["gbrain"]);
    expect(reEnabled).toEqual([]);
    expect(keepDisabled).toEqual([]);
  });
});

describe("autoPrunableMcps", () => {
  test("drops servers that are neither pinned nor needed; lowercases output", () => {
    const all = ["Codegraph", "higgsfield", "gbrain", "headroom"];
    const pinned = new Set(["headroom"]); // already lowercased by caller
    const needed = ["codegraph"]; // skill-referenced
    expect(autoPrunableMcps(all, pinned, needed)).toEqual(["higgsfield", "gbrain"]);
  });

  test("keeps everything when all are pinned or needed", () => {
    const all = ["a", "b"];
    expect(autoPrunableMcps(all, new Set(["a"]), ["b"])).toEqual([]);
  });

  test("needed match is case-insensitive", () => {
    expect(autoPrunableMcps(["GBrain"], new Set(), ["gbrain"])).toEqual([]);
  });

  test("empty profile → nothing to drop", () => {
    expect(autoPrunableMcps([], new Set(), [])).toEqual([]);
  });
});

describe("autoPruneEnabled", () => {
  test("recognizes the opt-in spellings", () => {
    for (const v of ["auto", "unused", "1", "true", "on", "AUTO", " auto "]) {
      expect(autoPruneEnabled(v), v).toBe(true);
    }
  });

  test("off / unset / garbage stays fail-open", () => {
    for (const v of [undefined, "", "0", "off", "false", "no"]) {
      expect(autoPruneEnabled(v), String(v)).toBe(false);
    }
  });
});

describe("mcpPruneMode", () => {
  test("'all'/'global'/'aggressive' → all (prunes globals too)", () => {
    for (const v of ["all", "global", "aggressive", "ALL", " all "]) {
      expect(mcpPruneMode(v), v).toBe("all");
    }
  });

  test("'auto'/'unused'/'profile'/1/true/on → profile (globals protected)", () => {
    for (const v of ["auto", "unused", "profile", "1", "true", "on"]) {
      expect(mcpPruneMode(v), v).toBe("profile");
    }
  });

  test("unset / garbage → off", () => {
    for (const v of [undefined, "", "0", "off", "no"]) {
      expect(mcpPruneMode(v), String(v)).toBe("off");
    }
  });
});

describe("all-mode universe includes globals; profile-mode does not", () => {
  // Invariant: with profile-only mode, a user-global server (not in profile, not
  // needed, not pinned) must NOT be dropped. With all-mode it IS dropped.
  const profileIds = ["dataforseo", "codegraph"];
  const globalIds = ["higgsfield", "colony"]; // user-global, no skill references them
  const pinned = new Set(["codegraph"]);
  const needed = ["dataforseo"]; // skill-referenced profile MCP

  test("profile mode (universe = profile only) protects globals", () => {
    const drop = autoPrunableMcps(profileIds, pinned, needed);
    expect(drop).toEqual([]); // codegraph pinned, dataforseo needed → nothing
    expect(drop).not.toContain("higgsfield");
  });

  test("all mode (universe = profile ∪ globals) drops unused globals", () => {
    const drop = autoPrunableMcps([...profileIds, ...globalIds], pinned, needed);
    expect(drop.sort()).toEqual(["colony", "higgsfield"]);
  });

  test("remembered profile choices still auto-prune unused globals in all mode", () => {
    const disabled = withAutoPrunedGlobals(
      ["unused-profile"],
      profileIds,
      [...profileIds, ...globalIds],
      pinned,
      needed,
    );
    expect(disabled).toEqual(["unused-profile", "higgsfield", "colony"]);
  });
});

describe("readRuntimeMcpServerIds", () => {
  test("reads top-level mcpServers keys", async () => {
    const p = join(dir, "rt.claude.json");
    await writeFileAsync(p, JSON.stringify({ mcpServers: { higgsfield: { url: "x" }, gbrain: { command: "g" } } }));
    expect(readRuntimeMcpServerIds(p).sort()).toEqual(["gbrain", "higgsfield"]);
  });

  test("missing file or no mcpServers → empty", async () => {
    expect(readRuntimeMcpServerIds(join(dir, "nope.json"))).toEqual([]);
    const p = join(dir, "empty.json");
    await writeFileAsync(p, JSON.stringify({ oauthAccount: {} }));
    expect(readRuntimeMcpServerIds(p)).toEqual([]);
  });
})

describe("isRecognizedPruneEnv", () => {
  test("recognizes every valid token (all/profile/off spellings)", () => {
    for (const v of ["off","0","false","no","","auto","unused","profile","1","true","on","all","global","aggressive","  ALL  "]) {
      expect(isRecognizedPruneEnv(v), v).toBe(true);
    }
  });
  test("rejects typos / garbage so the caller can fall through", () => {
    for (const v of ["profil","prof","aggresive","yes","2","none","disable"]) {
      expect(isRecognizedPruneEnv(v), v).toBe(false);
    }
  });
});
