import { afterEach, describe, expect, test } from "bun:test";

import { __test, isAlwaysPickEnabled } from "./launch";

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
