import { describe, expect, test } from "bun:test";

import { isRebuildableInPlace } from "./sync";

describe("sync isRebuildableInPlace", () => {
  const sources = new Set(["core", "gstack", "seo"]);

  test("a single known source profile rebuilds in place", () => {
    expect(isRebuildableInPlace("core", sources)).toBe(true);
    expect(isRebuildableInPlace("gstack", sources)).toBe(true);
  });

  test("composite (a+b) keys are deferred to the launcher", () => {
    expect(isRebuildableInPlace("gstack+core", sources)).toBe(false);
    expect(isRebuildableInPlace("core+skill-writer+seo", sources)).toBe(false);
  });

  test("per-account (…@acct) keys are deferred to the launcher", () => {
    expect(isRebuildableInPlace("core@account1", sources)).toBe(false);
    expect(isRebuildableInPlace("gstack+core@account1", sources)).toBe(false);
  });

  test("an unknown single key (no matching source profile) is deferred, not rebuilt", () => {
    expect(isRebuildableInPlace("ghost-profile", sources)).toBe(false);
  });
});
