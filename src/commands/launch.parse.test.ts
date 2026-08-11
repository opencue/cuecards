import { afterEach, describe, expect, test } from "bun:test";

import {
  __test,
  isAlwaysPickEnabled,
  isBypassEnabled,
  passthroughPrompt,
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
  const prevBypass = process.env.CUE_BYPASS;
  afterEach(() => {
    if (prev === undefined) delete process.env.CUE_SMART_SUBSET;
    else process.env.CUE_SMART_SUBSET = prev;
    if (prevBypass === undefined) delete process.env.CUE_BYPASS;
    else process.env.CUE_BYPASS = prevBypass;
  });

  test("explicit --subset sets subsetExplicit", () => {
    const p = parse(["claude", "--subset", "fix the parser"]);
    expect(p.subset).toBe("fix the parser");
    expect(p.subsetExplicit).toBe(true);
  });

  // Only the prose folds — `-p` itself is dropped, so the classifier reads the
  // prompt rather than the switch that introduced it.
  test("env-folded -p prompt sets subset but NOT subsetExplicit", () => {
    process.env.CUE_SMART_SUBSET = "1";
    const p = parse(["claude", "-p", "fix the parser"]);
    expect(p.subset).toBe("fix the parser");
    expect(p.subsetExplicit).toBe(false);
  });

  // Regression: a flag-only launch used to fold the flag in as the prompt, and
  // the classifier answered it — `codex --madmax` trimmed a 21-skill profile to
  // 4 on the reasoning that "--madmax" named a cue profile.
  test("flag-only passthrough leaves subset unset, so the full profile loads", () => {
    process.env.CUE_SMART_SUBSET = "1";
    expect(parse(["codex", "--madmax"]).subset).toBeNull();
    expect(parse(["claude", "--resume"]).subset).toBeNull();
  });

  test("bare launch with env set stays unclassified (no passthrough prompt)", () => {
    process.env.CUE_SMART_SUBSET = "1";
    const p = parse(["claude"]);
    expect(p.subset).toBeNull();
    expect(p.subsetExplicit).toBe(false);
  });

  // Recursion guard. The classifier spawns `claude` by name, which on a machine
  // with cue's shims first on PATH re-enters `cue launch`. With CUE_SMART_SUBSET
  // exported globally, the fold below would turn that child's own argv into the
  // next classification prompt and spawn another classifier — each level a full
  // ~400MB claude process carrying the previous level's argv. Observed in the
  // wild: 10 nested levels, a 67KB command line, ~3GB resident.
  test("CUE_BYPASS suppresses the env fold so classifier spawns cannot recurse", () => {
    process.env.CUE_SMART_SUBSET = "1";
    process.env.CUE_BYPASS = "1";
    const p = parse(["claude", "--print", "--model", "haiku", "-p", "which skills?"]);
    expect(p.subset).toBeNull();
    expect(p.subsetExplicit).toBe(false);
  });

  test("CUE_BYPASS does not block an explicit --subset", () => {
    process.env.CUE_BYPASS = "1";
    const p = parse(["claude", "--subset", "fix the parser"]);
    expect(p.subset).toBe("fix the parser");
    expect(p.subsetExplicit).toBe(true);
  });
});

// The flag is documented as `CUE_BYPASS=1` in docs/launch.md and
// docs/shell-install.md, and every internal caller sets exactly that. Widening
// it to the 1/true/on set `isAlwaysPickEnabled` accepts would silently change
// which environments skip the whole pipeline.
describe("isBypassEnabled", () => {
  test("accepts only the documented value", () => {
    expect(isBypassEnabled("1")).toBe(true);
  });

  test("rejects anything else, including truthy-looking values", () => {
    for (const v of ["0", "true", "on", "yes", "", " 1 ", undefined]) {
      expect(isBypassEnabled(v)).toBe(false);
    }
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

describe("passthroughPrompt", () => {
  test("keeps a real prompt, so smart-subset still classifies `-p` launches", () => {
    expect(passthroughPrompt(["-p", "fix the auth bug"])).toBe("fix the auth bug");
  });

  test("keeps a bare prompt with no flag at all", () => {
    expect(passthroughPrompt(["explain this repo"])).toBe("explain this repo");
  });

  // Regression: `codex --madmax` folded the flag in as a prompt and the
  // classifier answered it — 21 skills trimmed to 4 on a freshly picked profile.
  test("drops a lone flag, leaving no subset to classify", () => {
    expect(passthroughPrompt(["--madmax"])).toBe("");
    expect(passthroughPrompt(["--resume"])).toBe("");
  });

  test("drops short flags too", () => {
    expect(passthroughPrompt(["-c"])).toBe("");
  });

  test("keeps prose that sits alongside flags", () => {
    expect(passthroughPrompt(["--madmax", "-p", "ship the release"])).toBe("ship the release");
  });

  test("empty argv yields no prompt", () => {
    expect(passthroughPrompt([])).toBe("");
  });
});
