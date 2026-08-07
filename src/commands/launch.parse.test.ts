import { afterEach, describe, expect, test } from "bun:test";

import {
  __test,
  isAlwaysPickEnabled,
  shouldForcePicker,
  shouldInheritSessionProfile,
} from "./launch";

const { parse } = __test;

// Regression lock for the `--` separator: it must be consumed by cue, never
// forwarded to the agent. `claude -- --version` treats "--version" as a PROMPT
// and opens an interactive session, which hangs forever on a non-TTY stdin.
describe("parse: `--` separator", () => {
  test("drops the separator and forwards the rest verbatim", () => {
    const p = parse(["claude", "--cue-profile", "core", "--", "--version"]);
    expect(p.agent).toBe("claude");
    expect(p.override).toBe("core");
    expect(p.passthrough).toEqual(["--version"]);
  });

  test("stops interpreting cue flags after the separator", () => {
    const p = parse(["claude", "--", "--cue-profile", "other", "--dry-run"]);
    expect(p.override).toBeNull();
    expect(p.dryRun).toBe(false);
    expect(p.passthrough).toEqual(["--cue-profile", "other", "--dry-run"]);
  });

  test("bare trailing separator forwards nothing", () => {
    const p = parse(["claude", "--cue-profile", "core", "--"]);
    expect(p.passthrough).toEqual([]);
  });

  test("no separator keeps existing passthrough behavior", () => {
    const p = parse(["claude", "-p", "hi"]);
    expect(p.passthrough).toEqual(["-p", "hi"]);
  });
});

// Regression lock for item C: a valid remembered MCP override keeps the toggle
// CLOSED. Picking a profile interactively must NOT re-force the dialog; only
// --cue-pick-mcps or a missing/invalid override opens it.
describe("shouldOpenMcpPicker", () => {
  const { shouldOpenMcpPicker } = __test;

  test("closed when a valid override exists and not forced", () => {
    expect(shouldOpenMcpPicker({ interactive: true, forcePickMcps: false, overrideValid: true })).toBe(false);
  });

  test("open on --cue-pick-mcps even with a valid override", () => {
    expect(shouldOpenMcpPicker({ interactive: true, forcePickMcps: true, overrideValid: true })).toBe(true);
  });

  test("open when there's no valid remembered choice", () => {
    expect(shouldOpenMcpPicker({ interactive: true, forcePickMcps: false, overrideValid: false })).toBe(true);
  });

  test("never opens on a non-TTY launch", () => {
    expect(shouldOpenMcpPicker({ interactive: false, forcePickMcps: true, overrideValid: false })).toBe(false);
  });
});

// Item B: subsetExplicit distinguishes a deliberate `--subset` (fresh, no cache)
// from the CUE_SMART_SUBSET env fold of a `-p` prompt (cached across launches).
describe("parse: subset origin", () => {
  const prev = process.env.CUE_SMART_SUBSET;
  afterEach(() => {
    if (prev === undefined) delete process.env.CUE_SMART_SUBSET;
    else process.env.CUE_SMART_SUBSET = prev;
  });

  test("explicit --subset sets subsetExplicit", () => {
    const p = parse(["claude", "--subset", "fix the parser"]);
    expect(p.subset).toBe("fix the parser");
    expect(p.subsetExplicit).toBe(true);
  });

  test("env-folded -p prompt sets subset but NOT subsetExplicit", () => {
    process.env.CUE_SMART_SUBSET = "1";
    const p = parse(["claude", "-p", "fix the parser"]);
    expect(p.subset).toBe("-p fix the parser");
    expect(p.subsetExplicit).toBe(false);
  });

  test("bare launch with env set stays unclassified (no passthrough prompt)", () => {
    process.env.CUE_SMART_SUBSET = "1";
    const p = parse(["claude"]);
    expect(p.subset).toBeNull();
    expect(p.subsetExplicit).toBe(false);
  });
});

describe("isAlwaysPickEnabled", () => {
  test("accepts the documented enabling values", () => {
    for (const v of ["1", "true", "on", "TRUE", " On "]) {
      expect(isAlwaysPickEnabled(v)).toBe(true);
    }
  });

  test("rejects unset, empty, and negative values", () => {
    for (const v of [undefined, "", "0", "false", "off", "no"]) {
      expect(isAlwaysPickEnabled(v)).toBe(false);
    }
  });
});

// Regression lock for nested non-interactive launches. cue points
// CLAUDE_CONFIG_DIR at the per-profile runtime dir when it launches an agent,
// so every child spawned inside a cue session looks like an account alias. When
// that forced the picker unconditionally, a nested `claude -p …` — gitguardex's
// AI review gate, a hook, any script — died on "no profile resolved and stdin is
// not a TTY", and callers had to strip the env var by hand to get through.
describe("shouldForcePicker", () => {
  const base = {
    forcePick: false,
    alwaysPickEnv: undefined as string | undefined,
    hasOverride: false,
    isAccountAlias: false,
    isTTY: true,
  };

  test("an account alias opens the picker on a TTY", () => {
    expect(shouldForcePicker({ ...base, isAccountAlias: true })).toBe(true);
  });

  test("an account alias does NOT force the picker off a TTY", () => {
    expect(shouldForcePicker({ ...base, isAccountAlias: true, isTTY: false })).toBe(false);
  });

  test("CUE_ALWAYS_PICK does NOT force the picker off a TTY", () => {
    expect(shouldForcePicker({ ...base, alwaysPickEnv: "1", isTTY: false })).toBe(false);
  });

  test("--cue-profile opts out of both TTY triggers", () => {
    expect(shouldForcePicker({
      ...base, hasOverride: true, isAccountAlias: true, alwaysPickEnv: "1",
    })).toBe(false);
  });

  test("--cue-pick wins everywhere, TTY or not", () => {
    expect(shouldForcePicker({ ...base, forcePick: true, isTTY: false })).toBe(true);
    expect(shouldForcePicker({ ...base, forcePick: true, hasOverride: true })).toBe(true);
  });
});

describe("shouldInheritSessionProfile", () => {
  test("inherits when nothing resolved and there is no TTY to pick with", () => {
    expect(shouldInheritSessionProfile({
      resolvedNone: true, forcePick: false, isTTY: false,
    })).toBe(true);
  });

  test("never inherits when the cwd resolved a profile", () => {
    expect(shouldInheritSessionProfile({
      resolvedNone: false, forcePick: false, isTTY: false,
    })).toBe(false);
  });

  test("never inherits on a TTY — the picker is reachable", () => {
    expect(shouldInheritSessionProfile({
      resolvedNone: true, forcePick: false, isTTY: true,
    })).toBe(false);
  });

  test("--cue-pick off a TTY stays a hard error rather than inheriting", () => {
    expect(shouldInheritSessionProfile({
      resolvedNone: true, forcePick: true, isTTY: false,
    })).toBe(false);
  });
});

// The `full` row used to shout three times over: a yellow `⚠ NEVER USE THIS`
// suffix welded onto the label, the red danger tag the picker adds, and a hint
// that closed with "do not pick interactively". One warning, in red, is the
// contract — the label carries the name, the hint carries the reason.
describe("picker row for the `full` profile", () => {
  test("states the warning once and leaves the label clean", async () => {
    const { options } = await __test.listProfileOptions();
    const full = options.find((o: { value: string }) => o.value === "full");
    expect(full).toBeDefined();

    expect(full!.label).not.toContain("NEVER USE THIS");
    expect(full!.label.toLowerCase()).not.toContain("never use this");

    // The hint explains WHY, without restating the prohibition.
    expect(full!.hint).toContain("loads every skill");
    expect(full!.hint!.toLowerCase()).not.toContain("never use this");
    expect(full!.hint!.toLowerCase()).not.toContain("do not pick");
  });
});
