/**
 * Tests for `quickDiagnose` exported from `cue status`.
 *
 * `quickDiagnose` is a P2 function: it takes a profile name + shape and
 * performs read-only disk checks against the real repo's skill and MCP
 * registry files. Tests use a fictional profile name ("fake-zzz-test") so
 * the runtime directory check (D5) is always a no-op.
 */

import { describe, expect, test } from "bun:test";
import { quickDiagnose } from "./status";
import type { Warning } from "./status";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_NAME = "fake-zzz-test-profile";

/** Build the minimal profile object quickDiagnose expects. */
function fakeProfile(opts: {
  skills?: Array<string | { id: string }>;
  mcps?: Array<string | { id: string }>;
} = {}) {
  return {
    skills: { local: opts.skills ?? [] },
    mcps: opts.mcps ?? [],
  };
}

// ---------------------------------------------------------------------------
// D1 — missing skill on disk
// ---------------------------------------------------------------------------

describe("quickDiagnose — D1 skill existence", () => {
  test("empty skills list produces no warnings", () => {
    const warnings = quickDiagnose(FAKE_NAME, fakeProfile());
    expect(warnings.filter((w: Warning) => w.code === "D1")).toEqual([]);
  });

  test("non-existent skill ID produces a D1 warning with the ID in the message", () => {
    const profile = fakeProfile({ skills: [{ id: "zzz-ghost-cat/not-a-real-skill" }] });
    const warnings = quickDiagnose(FAKE_NAME, profile);
    const d1 = warnings.filter((w: Warning) => w.code === "D1");
    expect(d1.length).toBe(1);
    expect(d1[0]!.message).toContain("zzz-ghost-cat/not-a-real-skill");
  });

  test("wildcard skill id is skipped (no D1 even though nothing matches)", () => {
    const profile = fakeProfile({ skills: [{ id: "meta/*" }] });
    const warnings = quickDiagnose(FAKE_NAME, profile);
    expect(warnings.filter((w: Warning) => w.code === "D1")).toEqual([]);
  });

  test("real skill (meta/analyze) does not produce a D1 warning", () => {
    const profile = fakeProfile({ skills: [{ id: "meta/analyze" }] });
    const warnings = quickDiagnose(FAKE_NAME, profile);
    expect(warnings.filter((w: Warning) => w.code === "D1")).toEqual([]);
  });

  test("bare-slug skill that exists in a category is found without D1", () => {
    // "analyze" lives under meta/analyze; the fallback category scan should find it.
    const profile = fakeProfile({ skills: [{ id: "analyze" }] });
    const warnings = quickDiagnose(FAKE_NAME, profile);
    expect(warnings.filter((w: Warning) => w.code === "D1")).toEqual([]);
  });

  test("two non-existent skills produce two D1 warnings", () => {
    const profile = fakeProfile({
      skills: [
        { id: "zzz-fake-1/skill-a" },
        { id: "zzz-fake-2/skill-b" },
      ],
    });
    const warnings = quickDiagnose(FAKE_NAME, profile);
    expect(warnings.filter((w: Warning) => w.code === "D1").length).toBe(2);
  });

  test("plain-string skill id (non-object form) is also checked", () => {
    const profile = fakeProfile({ skills: ["zzz-plain-string/missing-skill"] });
    const warnings = quickDiagnose(FAKE_NAME, profile);
    const d1 = warnings.filter((w: Warning) => w.code === "D1");
    expect(d1.length).toBe(1);
    expect(d1[0]!.message).toContain("zzz-plain-string/missing-skill");
  });
});

// ---------------------------------------------------------------------------
// D2 — MCP not in registry
// ---------------------------------------------------------------------------

describe("quickDiagnose — D2 MCP registry", () => {
  test("empty MCP list produces no D2 warnings", () => {
    const warnings = quickDiagnose(FAKE_NAME, fakeProfile());
    expect(warnings.filter((w: Warning) => w.code === "D2")).toEqual([]);
  });

  test("non-registered MCP ID produces a D2 warning", () => {
    const profile = fakeProfile({ mcps: [{ id: "zzz-totally-fake-mcp-xyz" }] });
    const warnings = quickDiagnose(FAKE_NAME, profile);
    const d2 = warnings.filter((w: Warning) => w.code === "D2");
    expect(d2.length).toBe(1);
    expect(d2[0]!.message).toContain("zzz-totally-fake-mcp-xyz");
  });

  test("registered MCP (codegraph) does not produce a D2 warning", () => {
    // codegraph is present in claude_runtime.sanitized.json
    const profile = fakeProfile({ mcps: [{ id: "codegraph" }] });
    const warnings = quickDiagnose(FAKE_NAME, profile);
    expect(warnings.filter((w: Warning) => w.code === "D2")).toEqual([]);
  });

  test("two unregistered MCPs produce two D2 warnings", () => {
    const profile = fakeProfile({
      mcps: [{ id: "zzz-fake-mcp-a" }, { id: "zzz-fake-mcp-b" }],
    });
    const warnings = quickDiagnose(FAKE_NAME, profile);
    expect(warnings.filter((w: Warning) => w.code === "D2").length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Combined
// ---------------------------------------------------------------------------

describe("quickDiagnose — mixed warnings", () => {
  test("bad skill + bad MCP together produce both D1 and D2 warnings", () => {
    const profile = fakeProfile({
      skills: [{ id: "zzz-fake/no-skill-here" }],
      mcps: [{ id: "zzz-no-such-mcp" }],
    });
    const warnings = quickDiagnose(FAKE_NAME, profile);
    expect(warnings.filter((w: Warning) => w.code === "D1").length).toBe(1);
    expect(warnings.filter((w: Warning) => w.code === "D2").length).toBe(1);
  });

  test("clean profile (real skill + real MCP) produces no warnings", () => {
    const profile = fakeProfile({
      skills: [{ id: "meta/analyze" }],
      mcps: [{ id: "codegraph" }],
    });
    const warnings = quickDiagnose(FAKE_NAME, profile);
    // D1 and D2 should both be absent; D4/D5 should not fire on these inputs.
    expect(warnings.filter((w: Warning) => w.code === "D1")).toEqual([]);
    expect(warnings.filter((w: Warning) => w.code === "D2")).toEqual([]);
  });
});
