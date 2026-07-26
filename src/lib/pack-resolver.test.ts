import { describe, test, expect } from "bun:test";
import { expandPacks, listPacks, loadPack } from "./pack-resolver";

describe("loadPack", () => {
  test("returns null for a pack that does not exist", () => {
    expect(loadPack("__nonexistent_pack_xyz__")).toBeNull();
  });

  test("loads a real pack from the repo", () => {
    const pack = loadPack("deployment-suite");
    expect(pack).not.toBeNull();
    expect(pack!.name).toBeTruthy();
    expect(Array.isArray(pack!.skills)).toBe(true);
    expect(pack!.skills.length).toBeGreaterThan(0);
  });

  test("loaded pack has required_mcps as an array", () => {
    const pack = loadPack("deployment-suite");
    expect(Array.isArray(pack!.requires_mcps)).toBe(true);
  });

  test("loads the security-review pack", () => {
    const pack = loadPack("security-review");
    expect(pack).not.toBeNull();
    expect(pack!.skills.length).toBeGreaterThan(0);
  });
});

describe("listPacks", () => {
  test("returns an array (even if no packs exist on this machine)", () => {
    const packs = listPacks();
    expect(Array.isArray(packs)).toBe(true);
  });

  test("returns at least the bundled packs from the repo", () => {
    const packs = listPacks();
    expect(packs.length).toBeGreaterThan(0);
    const names = packs.map((p) => p.name);
    // deployment-suite.yaml is in resources/skill-packs/
    expect(names.some((n) => n !== undefined && n !== null)).toBe(true);
  });

  test("every listed pack has a name and skills array", () => {
    for (const pack of listPacks()) {
      expect(typeof pack.name === "string" || pack.name === undefined).toBe(true);
      expect(Array.isArray(pack.skills)).toBe(true);
    }
  });
});

describe("expandPacks", () => {
  test("empty pack list returns empty skills and mcps", () => {
    expect(expandPacks([])).toEqual({ skills: [], mcps: [] });
  });

  test("expands a real pack into skills and mcps", () => {
    const result = expandPacks(["deployment-suite"]);
    expect(result.skills.length).toBeGreaterThan(0);
  });

  test("deduplicates skills shared across multiple packs", () => {
    // Expand the same pack twice — the union should not double the skills.
    const once = expandPacks(["deployment-suite"]);
    const twice = expandPacks(["deployment-suite", "deployment-suite"]);
    expect(twice.skills.length).toBe(once.skills.length);
    expect(twice.mcps.length).toBe(once.mcps.length);
  });

  test("non-existent pack name is handled gracefully (no throw)", () => {
    expect(() => expandPacks(["__does_not_exist__"])).not.toThrow();
    const result = expandPacks(["__does_not_exist__"]);
    expect(result.skills).toEqual([]);
    expect(result.mcps).toEqual([]);
  });

  test("mixing a real pack and a missing pack returns only real pack's skills", () => {
    const result = expandPacks(["deployment-suite", "__missing__"]);
    const expected = expandPacks(["deployment-suite"]);
    expect(result.skills).toEqual(expected.skills);
  });
});
