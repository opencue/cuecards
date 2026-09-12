/**
 * Tests for `quickDiagnose` exported from `cue status`.
 *
 * `quickDiagnose` is a P2 function: it takes a profile name + shape and
 * performs read-only disk checks against the real repo's skill and MCP
 * registry files. Tests use a fictional profile name ("fake-zzz-test") so
 * the runtime directory check (D5) is always a no-op.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  plugins?: Array<string | { id: string }>;
} = {}) {
  return {
    skills: { local: opts.skills ?? [] },
    mcps: opts.mcps ?? [],
    plugins: opts.plugins ?? [],
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
// D12 — declared plugin not installed
// ---------------------------------------------------------------------------

describe("quickDiagnose — D12 plugin install state", () => {
  let pluginsRoot: string;
  let priorRoot: string | undefined;

  /** Seed a plugins root with the two registries Claude Code keeps there. */
  function seed(installed: string[], marketplaces: string[]): void {
    writeFileSync(
      join(pluginsRoot, "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: Object.fromEntries(installed.map((r) => [r, []])) }),
    );
    writeFileSync(
      join(pluginsRoot, "known_marketplaces.json"),
      JSON.stringify(Object.fromEntries(marketplaces.map((m) => [m, {}]))),
    );
  }

  beforeEach(() => {
    priorRoot = process.env.SOUL_PLUGINS_ROOT;
    pluginsRoot = mkdtempSync(join(tmpdir(), "cue-status-plugins-"));
    process.env.SOUL_PLUGINS_ROOT = pluginsRoot;
  });

  afterEach(() => {
    if (priorRoot === undefined) delete process.env.SOUL_PLUGINS_ROOT;
    else process.env.SOUL_PLUGINS_ROOT = priorRoot;
    rmSync(pluginsRoot, { recursive: true, force: true });
  });

  test("an installed plugin produces no warning", () => {
    seed(["ponytail@ponytail"], ["ponytail"]);
    const profile = fakeProfile({ plugins: [{ id: "ponytail@ponytail" }] });
    expect(quickDiagnose(FAKE_NAME, profile).filter((w: Warning) => w.code === "D12")).toEqual([]);
  });

  test("a missing plugin whose marketplace IS registered says to install it", () => {
    seed([], ["ponytail"]);
    const profile = fakeProfile({ plugins: [{ id: "ponytail@ponytail" }] });
    const [warning, ...rest] = quickDiagnose(FAKE_NAME, profile)
      .filter((w: Warning) => w.code === "D12");
    expect(rest).toEqual([]);
    expect(warning?.message).toContain("claude plugin install ponytail@ponytail");
    expect(warning?.message).not.toContain("not registered");
  });

  test("a missing plugin whose marketplace is NOT registered names that step first", () => {
    // The two are separate actions. Telling someone to install from a
    // marketplace they never added sends them straight into an error.
    seed([], []);
    const profile = fakeProfile({ plugins: [{ id: "ponytail@ponytail" }] });
    const [warning] = quickDiagnose(FAKE_NAME, profile).filter((w: Warning) => w.code === "D12");
    expect(warning?.message).toContain('marketplace "ponytail" is not registered');
  });

  test("an absent plugins root warns rather than throwing", () => {
    process.env.SOUL_PLUGINS_ROOT = join(pluginsRoot, "does", "not", "exist");
    const profile = fakeProfile({ plugins: [{ id: "ponytail@ponytail" }] });
    expect(() => quickDiagnose(FAKE_NAME, profile)).not.toThrow();
    expect(quickDiagnose(FAKE_NAME, profile).filter((w: Warning) => w.code === "D12")).toHaveLength(1);
  });

  test("skipped entirely for codex, which cannot load a Claude Code plugin", () => {
    // claude-mem@thedotmack lives in `core`, which every profile inherits, so
    // warning on codex would put a permanent, un-actionable line and a "!"
    // health badge on every codex launch there is.
    seed([], []);
    const profile = fakeProfile({ plugins: [{ id: "ponytail@ponytail" }] });
    expect(quickDiagnose(FAKE_NAME, profile, "codex").filter((w: Warning) => w.code === "D12"))
      .toEqual([]);
    // Same profile, Claude Code: still warns.
    expect(quickDiagnose(FAKE_NAME, profile, "claude-code").filter((w: Warning) => w.code === "D12"))
      .toHaveLength(1);
    // Agent-agnostic callers (cue status, the dashboard) keep the check.
    expect(quickDiagnose(FAKE_NAME, profile).filter((w: Warning) => w.code === "D12"))
      .toHaveLength(1);
  });

  test("a bare plugin ref with no marketplace is skipped, not guessed at", () => {
    seed([], []);
    const profile = fakeProfile({ plugins: [{ id: "no-marketplace-here" }, "" as never] });
    expect(quickDiagnose(FAKE_NAME, profile).filter((w: Warning) => w.code === "D12")).toEqual([]);
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
