import { describe, expect, test } from "bun:test";

import {
  buildCompanionOptions,
  filterOptions,
  renderProfileList,
  resolveConflicts,
  buildConflictMap,
  combineCategoryOf,
  groupByCategory,
  windowOptions,
  SKIP_COMBINE,
  SHOW_ALL,
  UNIVERSAL_COMPANIONS,
  FEATURED_HINT,
  FREQUENT_HINT,
  UNIVERSAL_HINT,
  HISTORY_HINT,
  formatTallyDelta,
  unionTallyCounts,
  formatCombinedPreview,
  asciiIconsEnabled,
  stripIconIfAscii,
  renderCombineFrame,
  compressCombo,
  displayWidth,
  dedupeSelectorParts,
  applyShowAllExpansion,
  formatOverheadBadge,
  MAX_FREQUENT_AUTOCHECK,
  OVERHEAD_WARN_TOKENS,
  type PickerOption,
  type ProfileTally,
  type AsciiMSOption,
} from "./picker";
import type { CompanionSignal } from "./companion-detect";
import type { UniversalSuggestion } from "./pair-suggestions";

describe("renderProfileList", () => {
  test("formats option label and description", () => {
    const opts: PickerOption[] = [
      { value: "frontend", label: "frontend", hint: "Frontend UI work" },
      { value: "backend", label: "backend", hint: "API/server work" },
    ];
    const rendered = renderProfileList(opts, { cwd: "/tmp/proj" });
    expect(rendered).toContain("cue · pick a profile");
    expect(rendered).toContain("/tmp/proj");
    expect(rendered).toContain("frontend");
    expect(rendered).toContain("Frontend UI work");
    expect(rendered).toContain("backend");
  });

  test("includes special entries for new profile and details", () => {
    const opts: PickerOption[] = [
      { value: "frontend", label: "frontend", hint: "Frontend UI work" },
    ];
    const rendered = renderProfileList(opts, { cwd: "/tmp/proj", includeFooter: true });
    expect(rendered).toMatch(/new profile from this cwd/);
    expect(rendered).toMatch(/details \(d\)/);
    expect(rendered).toMatch(/pick once, no pin \(n\)/);
  });
});

describe("filterOptions", () => {
  const opts: PickerOption[] = [
    { value: "default", label: "★ Default", hint: "core", top: true },
    { value: "__divider_featured", label: "— Featured —", hint: "", divider: true },
    { value: "studio", label: "🎨 studio", hint: "" },
    { value: "secops", label: "🔒 secops", hint: "" },
    { value: "slack", label: "💬 slack", hint: "" },
    { value: "stripe", label: "💳 stripe", hint: "" },
    { value: "growth", label: "🦜 growth", hint: "" },
    { value: "webshop-google", label: "📊 webshop-google", hint: "" },
  ];

  test("empty query returns everything; dividers stay but are not selectable", () => {
    const { display, selectable } = filterOptions(opts, "");
    expect(display).toEqual(opts);
    expect(selectable.some((o) => o.divider)).toBe(false);
    expect(selectable).toHaveLength(7);
  });

  test("query filters to value-prefix matches and drops dividers", () => {
    const { display, selectable } = filterOptions(opts, "s");
    expect(display.map((o) => o.value)).toEqual(["studio", "secops", "slack", "stripe"]);
    expect(display.some((o) => o.divider)).toBe(false);
    expect(selectable).toEqual(display);
  });

  test("query is case-insensitive and trimmed", () => {
    expect(filterOptions(opts, "  ST ").display.map((o) => o.value)).toEqual([
      "studio",
      "stripe",
    ]);
  });

  test("falls back to substring match when nothing starts with the query", () => {
    // No value starts with "google", but webshop-google contains it.
    expect(filterOptions(opts, "google").display.map((o) => o.value)).toEqual([
      "webshop-google",
    ]);
  });

  test("no match returns an empty list", () => {
    expect(filterOptions(opts, "zzz").display).toHaveLength(0);
    expect(filterOptions(opts, "zzz").selectable).toHaveLength(0);
  });
});

describe("windowOptions", () => {
  const nums = Array.from({ length: 20 }, (_, i) => i);

  test("returns everything with no hidden when the list fits", () => {
    const w = windowOptions(nums.slice(0, 5), 2, 10);
    expect(w.items).toEqual([0, 1, 2, 3, 4]);
    expect(w.hiddenAbove).toBe(0);
    expect(w.hiddenBelow).toBe(0);
  });

  test("centers the active row in the middle of the window", () => {
    const w = windowOptions(nums, 10, 7);
    // window of 7 centered on index 10 → start = 10 - 3 = 7, items 7..13
    expect(w.start).toBe(7);
    expect(w.items).toEqual([7, 8, 9, 10, 11, 12, 13]);
    expect(w.hiddenAbove).toBe(7);
    expect(w.hiddenBelow).toBe(6);
  });

  test("pins to the top when the active row is near the start", () => {
    const w = windowOptions(nums, 1, 7);
    expect(w.start).toBe(0);
    expect(w.hiddenAbove).toBe(0);
    expect(w.items[0]).toBe(0);
  });

  test("pins to the bottom so the last rows stay reachable", () => {
    const w = windowOptions(nums, 19, 7);
    expect(w.start).toBe(13); // 20 - 7
    expect(w.items[w.items.length - 1]).toBe(19);
    expect(w.hiddenBelow).toBe(0);
    expect(w.hiddenAbove).toBe(13);
  });

  test("max <= 0 degrades to the full list", () => {
    const w = windowOptions(nums, 5, 0);
    expect(w.items).toEqual(nums);
    expect(w.hiddenAbove).toBe(0);
    expect(w.hiddenBelow).toBe(0);
  });
});

describe("resolveConflicts", () => {
  const map = (pairs: ReadonlyArray<readonly [string, readonly string[]]>): Map<string, Set<string>> => {
    const m = new Map<string, Set<string>>();
    for (const [k, vs] of pairs) m.set(k, new Set(vs));
    return m;
  };

  test("first-in-list wins when two conflicting values both appear", () => {
    const conflicts = map([
      ["medusa-vite", ["medusa-next"]],
      ["medusa-next", ["medusa-vite"]],
    ]);
    expect(resolveConflicts(["medusa-vite", "medusa-next"], conflicts)).toEqual(["medusa-vite"]);
    expect(resolveConflicts(["medusa-next", "medusa-vite"], conflicts)).toEqual(["medusa-next"]);
  });

  test("non-conflicting values pass through untouched", () => {
    const conflicts = map([["medusa-vite", ["medusa-next"]]]);
    expect(resolveConflicts(["medusa-vite", "backend", "frontend"], conflicts)).toEqual([
      "medusa-vite",
      "backend",
      "frontend",
    ]);
  });

  test("conflicts are evaluated against already-kept items only, not against dropped ones", () => {
    // a conflicts with b. b conflicts with a and c. c conflicts with b.
    // Iterating [a, b, c]: a is kept; b conflicts with kept a → dropped;
    // c is checked against the kept set {a}, which doesn't conflict with c,
    // so c is kept. The c-conflicts-with-b relation is moot because b never
    // made it into the kept set.
    const conflicts = map([
      ["a", ["b"]],
      ["b", ["a", "c"]],
      ["c", ["b"]],
    ]);
    expect(resolveConflicts(["a", "c"], conflicts)).toEqual(["a", "c"]);
    expect(resolveConflicts(["a", "b", "c"], conflicts)).toEqual(["a", "c"]);
  });

  test("empty input and empty map are safe", () => {
    expect(resolveConflicts([], new Map())).toEqual([]);
    expect(resolveConflicts(["a", "b"], new Map())).toEqual(["a", "b"]);
  });
});

describe("buildCompanionOptions", () => {
  const OPTS: PickerOption[] = [
    { value: "postizz", label: "postizz", hint: "social", recommends: ["blog-writer", "trendradar"] },
    { value: "blog-writer", label: "blog-writer", hint: "long-form" },
    { value: "trendradar", label: "trendradar", hint: "trends" },
    { value: "higgsfield", label: "higgsfield", hint: "image gen" },
    { value: "creative-media", label: "creative-media", hint: "creative" },
    { value: "__divider_x", label: "—", hint: "", divider: true },
    { value: "medusa-next", label: "medusa-next", hint: "next", conflicts: ["medusa-vite"] },
    { value: "medusa-vite", label: "medusa-vite", hint: "vite", conflicts: ["medusa-next"] },
  ];
  const sig = (profile: string, confidence: number, reason = "r"): CompanionSignal => ({
    profile,
    confidence,
    reason,
  });
  const build = (args: Partial<Parameters<typeof buildCompanionOptions>[0]>) =>
    buildCompanionOptions({
      primary: "postizz",
      primaryLabel: "postizz",
      options: OPTS,
      recommends: [],
      pairSuggested: [],
      companions: [],
      autoCheckThreshold: 0.7,
      ...args,
    });

  test("recommends become rows; a high-confidence detected companion is added and auto-checked", () => {
    const { companionOptions, initialValues } = build({
      recommends: ["blog-writer", "trendradar"],
      companions: [sig("higgsfield", 0.85, "12 image assets")],
    });
    const values = companionOptions.map((o) => o.value);
    expect(values).toContain("higgsfield");
    expect(values).toContain("blog-writer");
    // detected row shows the reason as its hint, not the profile description
    expect(companionOptions.find((o) => o.value === "higgsfield")!.hint).toBe("12 image assets");
    expect(initialValues).toContain("higgsfield");
  });

  test("a recommends-origin row carries recommended:true; a detected row does not", () => {
    const { companionOptions } = build({
      recommends: ["blog-writer"],
      companions: [sig("higgsfield", 0.85, "12 image assets")],
    });
    expect(companionOptions.find((o) => o.value === "blog-writer")!.recommended).toBe(true);
    expect(companionOptions.find((o) => o.value === "higgsfield")!.recommended).toBeFalsy();
  });

  test("autoSelect companions start checked with no detection signal", () => {
    const { companionOptions, initialValues } = build({
      autoSelect: ["blog-writer", "trendradar"],
      companions: [], // crucially: no cwd detection
    });
    const values = companionOptions.map((o) => o.value);
    expect(values).toContain("blog-writer");
    expect(values).toContain("trendradar");
    // The whole point: checked even though nothing was detected in the cwd.
    expect(initialValues).toContain("blog-writer");
    expect(initialValues).toContain("trendradar");
    // An autoSelect row is also tagged recommended (it gets the → marker).
    expect(companionOptions.find((o) => o.value === "blog-writer")!.recommended).toBe(true);
  });

  test("autoSelect overrides recommends origin without duplicating the row", () => {
    const { companionOptions, initialValues } = build({
      autoSelect: ["blog-writer"],
      recommends: ["blog-writer"],
    });
    expect(companionOptions.filter((o) => o.value === "blog-writer")).toHaveLength(1);
    expect(initialValues).toContain("blog-writer"); // autoSelect wins → checked
  });

  test("an autoSelect companion that conflicts with the primary is still dropped", () => {
    const { companionOptions, initialValues } = buildCompanionOptions({
      primary: "medusa-next",
      primaryLabel: "medusa-next",
      options: OPTS,
      recommends: [],
      autoSelect: ["medusa-vite"], // declared, but conflicts with medusa-next
      pairSuggested: [],
      companions: [],
      autoCheckThreshold: 0.7,
    });
    expect(companionOptions.map((o) => o.value)).not.toContain("medusa-vite");
    expect(initialValues).not.toContain("medusa-vite");
  });

  test("confirm-time conflict map (curated + overflow) drops two mutually-exclusive overflow profiles", () => {
    // postizz conflicts with neither medusa profile, so both land in overflow.
    const { companionOptions, overflowOptions } = build({ recommends: [] });
    const ov = overflowOptions.map((o) => o.value);
    expect(ov).toContain("medusa-next");
    expect(ov).toContain("medusa-vite");
    // The fix: asciiMultiselect builds the confirm-time map from curated + overflow,
    // so a conflict declared only between two revealed profiles is still enforced.
    const full = buildConflictMap([...companionOptions, ...overflowOptions]);
    expect(resolveConflicts(["medusa-next", "medusa-vite"], full)).toEqual(["medusa-next"]);
    // Regression guard: the old curated-only map (the CRITICAL bug) let BOTH survive
    // into the written .cue.profile while the live UI showed the conflict blocked.
    const stale = buildConflictMap(companionOptions);
    expect(resolveConflicts(["medusa-next", "medusa-vite"], stale)).toEqual([
      "medusa-next",
      "medusa-vite",
    ]);
  });

  test("a detected companion already in recommends is not duplicated", () => {
    const { companionOptions } = build({
      recommends: ["higgsfield"],
      companions: [sig("higgsfield", 0.85)],
    });
    expect(companionOptions.filter((o) => o.value === "higgsfield")).toHaveLength(1);
  });

  test("a below-threshold companion surfaces but does not start checked", () => {
    const { companionOptions, initialValues } = build({
      companions: [sig("blog-writer", 0.6, "markdown drafts")],
    });
    expect(companionOptions.map((o) => o.value)).toContain("blog-writer");
    expect(initialValues).not.toContain("blog-writer");
  });

  test("the primary itself is never offered as a companion", () => {
    const { companionOptions } = build({
      recommends: ["postizz", "blog-writer"],
      companions: [sig("postizz", 0.9)],
    });
    expect(companionOptions.map((o) => o.value)).not.toContain("postizz");
  });

  test("a companion that conflicts with the primary is dropped (either declaration side)", () => {
    const viaPrimary = buildCompanionOptions({
      primary: "medusa-next",
      primaryLabel: "medusa-next",
      options: OPTS,
      recommends: [],
      pairSuggested: [],
      companions: [sig("medusa-vite", 0.9)],
      autoCheckThreshold: 0.7,
    });
    expect(viaPrimary.companionOptions.map((o) => o.value)).not.toContain("medusa-vite");
  });

  test("dividers and unknown names are skipped (curated rows lead, expand row trails)", () => {
    const { companionOptions } = build({
      recommends: ["__divider_x", "does-not-exist", "blog-writer"],
    });
    // Only blog-writer is a real curated row; the rest of OPTS becomes overflow,
    // so a trailing SHOW_ALL expand row is appended after the curated companions.
    const curated = companionOptions.filter((o) => o.kind !== "expand");
    expect(curated.map((o) => o.value)).toEqual([SKIP_COMBINE, "blog-writer"]);
    expect(companionOptions.at(-1)!.value).toBe(SHOW_ALL);
    expect(companionOptions.at(-1)!.kind).toBe("expand");
  });

  test("historical pairings are offered unchecked with the 'paired before' hint", () => {
    const { companionOptions, initialValues } = build({
      recommends: ["blog-writer"],
      pairSuggested: ["trendradar"],
    });
    // A remembered combo is a recommendation, never an auto-pin.
    expect(companionOptions.map((o) => o.value)).toContain("trendradar");
    expect(initialValues).not.toContain("trendradar");
    expect(companionOptions.find((o) => o.value === "trendradar")!.hint).toBe(HISTORY_HINT);
  });

  test("the SKIP_COMBINE action row leads the list only when there's anything to combine", () => {
    const withRows = build({ companions: [sig("higgsfield", 0.85)] });
    expect(withRows.companionOptions[0]!.value).toBe(SKIP_COMBINE);
    expect(withRows.companionOptions[0]!.kind).toBe("action");

    // Genuinely empty: a primary that is the only selectable profile → no
    // curated companions AND no overflow → no multiselect at all.
    const solo = buildCompanionOptions({
      primary: "only",
      primaryLabel: "only",
      options: [{ value: "only", label: "only", hint: "" }],
      recommends: [],
      pairSuggested: [],
      companions: [],
      autoCheckThreshold: 0.7,
    });
    expect(solo.companionOptions).toEqual([]);
    expect(solo.initialValues).toEqual([]);
    expect(solo.overflowOptions).toEqual([]);
  });

  // Pinned companions, when configured, flow through the same
  // universalSuggestions path as featured/frequent rows. Production defaults
  // to no pinned companions so heavy profiles such as gstack are not offered
  // under every primary.
  const WITH_PINNED: PickerOption[] = [
    ...OPTS,
    { value: "lightweight-helper", label: "helper", hint: "small helper", conflicts: ["vite"] },
    { value: "vite", label: "vite", hint: "spa" },
  ];
  const PINNED: UniversalSuggestion[] = [{ name: "lightweight-helper", origin: "pinned" }];

  test("gstack is not pinned as a universal companion by default", () => {
    expect(UNIVERSAL_COMPANIONS).not.toContain("gstack");
  });

  test("a configured pinned companion is offered (unchecked) under a primary that never names it", () => {
    const { companionOptions, initialValues } = buildCompanionOptions({
      primary: "postizz",
      primaryLabel: "postizz",
      options: WITH_PINNED,
      recommends: [],
      pairSuggested: [],
      companions: [],
      universalSuggestions: PINNED,
      autoCheckThreshold: 0.7,
    });
    expect(companionOptions.map((o) => o.value)).toContain("lightweight-helper");
    expect(initialValues).not.toContain("lightweight-helper"); // offered, never forced
    // Pinned-origin rows get the UNIVERSAL_HINT tag, not the verbose profile
    // description — consistent with featured/frequent rows.
    expect(companionOptions.find((o) => o.value === "lightweight-helper")!.hint).toBe(UNIVERSAL_HINT);
  });

  test("the pinned companion is dropped when it is the primary or conflicts with it", () => {
    const asPrimary = buildCompanionOptions({
      primary: "lightweight-helper",
      primaryLabel: "lightweight-helper",
      options: WITH_PINNED,
      recommends: [],
      pairSuggested: [],
      companions: [],
      universalSuggestions: PINNED,
      autoCheckThreshold: 0.7,
    });
    expect(asPrimary.companionOptions.map((o) => o.value)).not.toContain("lightweight-helper");

    const conflicting = buildCompanionOptions({
      primary: "vite",
      primaryLabel: "vite",
      options: WITH_PINNED,
      recommends: [],
      pairSuggested: [],
      companions: [],
      universalSuggestions: PINNED,
      autoCheckThreshold: 0.7,
    });
    expect(conflicting.companionOptions.map((o) => o.value)).not.toContain("lightweight-helper");
  });

  test("an explicit recommend for a pinned companion is not duplicated", () => {
    const { companionOptions } = buildCompanionOptions({
      primary: "postizz",
      primaryLabel: "postizz",
      options: WITH_PINNED,
      recommends: ["lightweight-helper"],
      pairSuggested: [],
      companions: [],
      universalSuggestions: PINNED,
      autoCheckThreshold: 0.7,
    });
    expect(companionOptions.filter((o) => o.value === "lightweight-helper")).toHaveLength(1);
  });

  // Featured + frequently-used cross-profile suggestions (buildUniversalSuggestions).
  test("a featured universal suggestion is offered unchecked with the featured hint", () => {
    const { companionOptions, initialValues } = build({
      universalSuggestions: [{ name: "creative-media", origin: "featured" }],
    });
    const row = companionOptions.find((o) => o.value === "creative-media");
    expect(row).toBeDefined();
    expect(row!.hint).toBe(FEATURED_HINT);
    expect(initialValues).not.toContain("creative-media"); // offered, never forced
  });

  test("a frequently-used universal suggestion shows the frequency hint", () => {
    const { companionOptions } = build({
      universalSuggestions: [{ name: "creative-media", origin: "frequent" }],
    });
    expect(companionOptions.find((o) => o.value === "creative-media")!.hint).toBe(FREQUENT_HINT);
  });

  test("a universal suggestion already in recommends keeps its description, not the tag", () => {
    const { companionOptions } = build({
      recommends: ["blog-writer"],
      universalSuggestions: [{ name: "blog-writer", origin: "featured" }],
    });
    const rows = companionOptions.filter((o) => o.value === "blog-writer");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hint).toBe("long-form");
  });

  test("a universal suggestion equal to or conflicting with the primary is dropped", () => {
    const asPrimary = build({ universalSuggestions: [{ name: "postizz", origin: "featured" }] });
    expect(asPrimary.companionOptions.map((o) => o.value)).not.toContain("postizz");

    const conflicting = buildCompanionOptions({
      primary: "medusa-next",
      primaryLabel: "medusa-next",
      options: OPTS,
      recommends: [],
      pairSuggested: [],
      companions: [],
      universalSuggestions: [{ name: "medusa-vite", origin: "frequent" }],
      autoCheckThreshold: 0.7,
    });
    expect(conflicting.companionOptions.map((o) => o.value)).not.toContain("medusa-vite");
  });
});

describe("buildCompanionOptions · show-all overflow", () => {
  const OPTS: PickerOption[] = [
    { value: "postizz", label: "postizz", hint: "social", recommends: ["blog-writer"] },
    { value: "blog-writer", label: "blog-writer", hint: "long-form" },
    { value: "trendradar", label: "trendradar", hint: "trends" },
    { value: "higgsfield", label: "higgsfield", hint: "image gen" },
    { value: "__divider_x", label: "—", hint: "", divider: true },
    { value: "core+postizz", label: "composite", hint: "" },
    { value: "⭐ default", label: "Default", hint: "", top: true },
    { value: "medusa-next", label: "medusa-next", hint: "next", conflicts: ["medusa-vite"] },
    { value: "medusa-vite", label: "medusa-vite", hint: "vite", conflicts: ["medusa-next"] },
  ];
  const build = (args: Partial<Parameters<typeof buildCompanionOptions>[0]>) =>
    buildCompanionOptions({
      primary: "postizz",
      primaryLabel: "postizz",
      options: OPTS,
      recommends: [],
      pairSuggested: [],
      companions: [],
      autoCheckThreshold: 0.7,
      ...args,
    });

  test("overflow = every other selectable profile, minus curated/divider/composite/default", () => {
    const { overflowOptions, companionOptions } = build({ recommends: ["blog-writer"] });
    const values = overflowOptions.map((o) => o.value);
    // blog-writer is curated → not in overflow; the rest of the real profiles are.
    expect(values).not.toContain("blog-writer");
    expect(values).toEqual(expect.arrayContaining(["trendradar", "higgsfield", "medusa-next"]));
    // dividers, composites, the Default entry and the primary itself never leak in.
    expect(values).not.toContain("__divider_x");
    expect(values).not.toContain("core+postizz");
    expect(values).not.toContain("⭐ default");
    expect(values).not.toContain("postizz");
    // The expand row is appended last, carrying the overflow count.
    const expand = companionOptions.find((o) => o.kind === "expand")!;
    expect(expand.value).toBe(SHOW_ALL);
    expect(expand.expandCount).toBe(overflowOptions.length);
  });

  test("overflow respects conflicts with the primary", () => {
    const { overflowOptions } = buildCompanionOptions({
      primary: "medusa-next",
      primaryLabel: "medusa-next",
      options: OPTS,
      recommends: [],
      pairSuggested: [],
      companions: [],
      autoCheckThreshold: 0.7,
    });
    expect(overflowOptions.map((o) => o.value)).not.toContain("medusa-vite");
  });

  test("expand row + SKIP appear even when nothing is curated, so combine stays reachable", () => {
    const { companionOptions, overflowOptions } = build({});
    expect(companionOptions[0]!.value).toBe(SKIP_COMBINE);
    expect(companionOptions.some((o) => o.kind === "expand")).toBe(true);
    expect(overflowOptions.length).toBeGreaterThan(0);
  });

  test("no expand row when there is no overflow", () => {
    const opts: PickerOption[] = [
      { value: "postizz", label: "postizz", hint: "" },
      { value: "blog-writer", label: "blog-writer", hint: "" },
    ];
    const { companionOptions } = buildCompanionOptions({
      primary: "postizz",
      primaryLabel: "postizz",
      options: opts,
      recommends: ["blog-writer"],
      pairSuggested: [],
      companions: [],
      autoCheckThreshold: 0.7,
    });
    expect(companionOptions.some((o) => o.kind === "expand")).toBe(false);
  });
});

describe("applyShowAllExpansion", () => {
  const base: AsciiMSOption[] = [
    { value: SKIP_COMBINE, label: "use postizz alone", hint: "", kind: "action", primaryLabel: "postizz" },
    { value: "blog-writer", label: "blog-writer", hint: "long-form" },
    { value: SHOW_ALL, label: "", hint: "", kind: "expand", expandCount: 2 },
  ];
  const overflow: AsciiMSOption[] = [
    { value: "trendradar", label: "trendradar", hint: "trends" },
    { value: "higgsfield", label: "higgsfield", hint: "image gen" },
  ];

  test("no-op when the SHOW_ALL sentinel isn't selected", () => {
    const out = applyShowAllExpansion({ options: base, value: ["blog-writer"], cursor: 1, overflow });
    expect(out.expanded).toBe(false);
    expect(out.options).toBe(base); // unchanged reference
    expect(out.value).toEqual(["blog-writer"]);
  });

  test("reveals overflow: drops the expand row, appends overflow, lands cursor on first revealed", () => {
    // cursor was on the expand row (index 2); the toggle added SHOW_ALL to value.
    const out = applyShowAllExpansion({
      options: base,
      value: ["blog-writer", SHOW_ALL],
      cursor: 2,
      overflow,
    });
    expect(out.expanded).toBe(true);
    // SHOW_ALL row gone; overflow appended after the curated rows.
    expect(out.options.map((o) => o.value)).toEqual([
      SKIP_COMBINE,
      "blog-writer",
      "trendradar",
      "higgsfield",
    ]);
    // sentinel stripped from the selection so it never counts as a profile.
    expect(out.value).toEqual(["blog-writer"]);
    // cursor lands where the expand row used to sit = first revealed profile.
    expect(out.options[out.cursor]!.value).toBe("trendradar");
  });

  test("does not mutate the input arrays", () => {
    const opts = [...base];
    const val = ["blog-writer", SHOW_ALL];
    applyShowAllExpansion({ options: opts, value: val, cursor: 2, overflow });
    expect(opts).toEqual(base); // original option list untouched
    expect(val).toEqual(["blog-writer", SHOW_ALL]); // original value untouched
  });
});

describe("renderCombineFrame · show-all expand row", () => {
  const strip = (s: string) => s.replace(/\[[0-9;]*m/g, "");
  const options: AsciiMSOption[] = [
    { value: SKIP_COMBINE, label: "use postizz alone", hint: "", kind: "action", primaryLabel: "postizz" },
    { value: "blog-writer", label: "blog-writer", hint: "long-form" },
    { value: SHOW_ALL, label: "", hint: "", kind: "expand", expandCount: 12 },
  ];

  test("renders the 'show all N profiles' row from expandCount", () => {
    const out = strip(renderCombineFrame({ message: "Combine postizz with…", options, cursor: 1, selected: [], ascii: false }));
    expect(out).toContain("show all 12 profiles");
  });

  test("expand row signals SPACE (▾ + '(space)'), not the ↩ enter glyph that would confirm", () => {
    const out = strip(renderCombineFrame({ message: "m", options, cursor: 2, selected: [], ascii: false }));
    expect(out).toContain("show all 12 profiles  (space)");
    const expandLine = out.split("\n").find((l) => l.includes("show all 12 profiles"));
    expect(expandLine).toContain("▾");
    // The ↩ glyph means "enter"; the expand row must not reuse it, or users press
    // enter (which confirms the prompt) instead of space (which reveals).
    expect(expandLine).not.toContain("↩");
  });

  test("the expand sentinel never counts toward the staged selection", () => {
    const out = strip(
      renderCombineFrame({ message: "m", options, cursor: 2, selected: ["blog-writer", SHOW_ALL], ascii: false }),
    );
    // one real profile staged, not two — SHOW_ALL is a control row.
    expect(out).toContain("1 selected");
  });
});

describe("combine-preview tallies", () => {
  const tally = (over: Partial<ProfileTally> = {}): ProfileTally => ({
    skills: [],
    mcps: [],
    plugins: [],
    commands: [],
    ...over,
  });

  describe("formatTallyDelta", () => {
    test("renders only non-empty categories, with singular/plural", () => {
      expect(
        formatTallyDelta(tally({ skills: ["a", "b"], mcps: ["m"] })),
      ).toBe("+2 skills · +1 mcp");
    });

    test("one of each reads singular", () => {
      expect(
        formatTallyDelta(tally({ skills: ["a"], mcps: ["m"], plugins: ["p"], commands: ["c"] })),
      ).toBe("+1 skill · +1 mcp · +1 plugin · +1 cmd");
    });

    test("a profile that adds nothing is the empty string", () => {
      expect(formatTallyDelta(tally())).toBe("");
    });
  });

  describe("unionTallyCounts", () => {
    test("de-dupes shared identifiers across profiles", () => {
      const a = tally({ skills: ["x", "y"], mcps: ["m1"] });
      const b = tally({ skills: ["y", "z"], plugins: ["pl"] });
      expect(unionTallyCounts([a, b])).toEqual({ skills: 3, mcps: 1, plugins: 1, commands: 0 });
    });

    test("empty input yields all-zero counts", () => {
      expect(unionTallyCounts([])).toEqual({ skills: 0, mcps: 0, plugins: 0, commands: 0 });
    });
  });

  describe("formatCombinedPreview", () => {
    test("shows base→combined only where the count changed", () => {
      const base = { skills: 31, mcps: 1, plugins: 1, commands: 12 };
      const combined = { skills: 48, mcps: 2, plugins: 2, commands: 12 };
      expect(formatCombinedPreview(base, combined)).toEqual([
        "skills 31→48  ·  mcps 1→2  ·  plugins 1→2  ·  cmds 12",
      ]);
    });

    test("drops zero-count categories", () => {
      const base = { skills: 5, mcps: 0, plugins: 0, commands: 0 };
      expect(formatCombinedPreview(base, base)).toEqual(["skills 5"]);
    });

    test("nothing to show → empty array", () => {
      const zero = { skills: 0, mcps: 0, plugins: 0, commands: 0 };
      expect(formatCombinedPreview(zero, zero)).toEqual([]);
    });
  });
});

describe("ASCII icon fallback", () => {
  describe("asciiIconsEnabled", () => {
    test("explicit CUE_ASCII_ICONS opt-in wins", () => {
      expect(asciiIconsEnabled({ CUE_ASCII_ICONS: "1" })).toBe(true);
      expect(asciiIconsEnabled({ CUE_ASCII_ICONS: "true", LANG: "en_US.UTF-8" })).toBe(true);
    });

    test("a UTF-8 locale stays off (icons shown)", () => {
      expect(asciiIconsEnabled({ LANG: "en_US.UTF-8" })).toBe(false);
      expect(asciiIconsEnabled({ LC_ALL: "C.UTF-8" })).toBe(false);
    });

    test("a non-UTF-8 locale flips it on; an empty env stays off", () => {
      expect(asciiIconsEnabled({ LANG: "C" })).toBe(true);
      expect(asciiIconsEnabled({ LC_CTYPE: "POSIX" })).toBe(true);
      expect(asciiIconsEnabled({})).toBe(false);
    });
  });

  describe("stripIconIfAscii", () => {
    test("off → label untouched", () => {
      expect(stripIconIfAscii("🔺 vercel", false)).toBe("🔺 vercel");
    });

    test("on → leading emoji cluster (and its space) removed", () => {
      expect(stripIconIfAscii("🔺 vercel", true)).toBe("vercel");
      expect(stripIconIfAscii("✍️ blog-writer", true)).toBe("blog-writer");
      expect(stripIconIfAscii("🏭 gstack", true)).toBe("gstack");
    });

    test("pure-ASCII labels pass through; all-glyph labels are preserved", () => {
      expect(stripIconIfAscii("vite", true)).toBe("vite");
      expect(stripIconIfAscii("日本語", true)).toBe("日本語");
    });
  });
});

describe("renderCombineFrame", () => {
  const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  // gstack 31 skills / 1 mcp / 1 plugin / 2 cmds; vercel adds 17 disjoint
  // skills, 1 mcp, 1 plugin, 0 cmds → union 48 / 2 / 2 / 2.
  const tallies = new Map<string, ProfileTally>([
    ["gstack", { skills: ids("g", 31), mcps: ["m-core"], plugins: ["pl-mem"], commands: ["a.md", "b.md"] }],
    ["vercel", { skills: ids("v", 17), mcps: ["m-vercel"], plugins: ["pl-vercel"], commands: [] }],
  ]);
  const preview = { primary: "gstack", tallies };
  const options: AsciiMSOption[] = [
    { value: "vercel", label: "🔺 vercel", hint: "deploy" },
    { value: SKIP_COMBINE, label: "use 🏭 gstack alone", hint: "", kind: "action", primaryLabel: "🏭 gstack" },
  ];
  // styleText may emit ANSI (color is on under `bun test` here); strip it so
  // assertions match the visible text, not the escape codes between segments.
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const frame = (over: Partial<Parameters<typeof renderCombineFrame>[0]>) =>
    strip(
      renderCombineFrame({
        message: "Combine gstack with…",
        options,
        cursor: 1,
        selected: [],
        preview,
        ascii: false,
        ...over,
      }),
    );

  test("a checked companion shows its always-on contribution delta", () => {
    const out = frame({ selected: ["vercel"], cursor: 0 });
    expect(out).toContain("[x] 🔺 vercel");
    expect(out).toContain("+17 skills · +1 mcp · +1 plugin");
  });

  test("staged combo: action row mirrors the combination + points at enter", () => {
    const out = frame({ selected: ["vercel"], cursor: 1 });
    expect(out).toContain("use 🏭 gstack + 🔺 vercel");
    expect(out).toContain("↵ enter to confirm");
    expect(out).not.toContain("← will skip combining");
  });

  test("live preview shows base→combined only where the count changed", () => {
    const out = frame({ selected: ["vercel"] });
    expect(out).toContain("→ skills 31→48  ·  mcps 1→2  ·  plugins 1→2  ·  cmds 2");
  });

  test("footer reports the staged count", () => {
    expect(frame({ selected: ["vercel"] })).toContain("enter to continue with 1 selected");
  });

  test("a recommended companion (not cursored) shows the → gutter marker + tag", () => {
    const recOpts: AsciiMSOption[] = [
      { value: "vercel", label: "🔺 vercel", hint: "deploy", recommended: true },
      { value: SKIP_COMBINE, label: "use 🏭 gstack alone", hint: "", kind: "action", primaryLabel: "🏭 gstack" },
    ];
    // cursor on the action row (idx 1) → the recommended companion at idx 0 is
    // unfocused, so its gutter shows → and the row is tagged "recommended".
    const out = frame({ options: recOpts, cursor: 1 });
    expect(out).toContain("→ [ ] 🔺 vercel");
    expect(out).toContain("recommended");
  });

  test("cursor on a recommended row shows › (not →) but keeps the tag", () => {
    const recOpts: AsciiMSOption[] = [
      { value: "vercel", label: "🔺 vercel", hint: "deploy", recommended: true },
      { value: SKIP_COMBINE, label: "use 🏭 gstack alone", hint: "", kind: "action", primaryLabel: "🏭 gstack" },
    ];
    const out = frame({ options: recOpts, cursor: 0 });
    expect(out).toContain("› [ ] 🔺 vercel");
    expect(out).not.toContain("→ [ ] 🔺 vercel");
    expect(out).toContain("recommended");
  });

  test("nothing staged: 'alone' label, no enter hint, no count, baseline preview", () => {
    const out = frame({ selected: [], cursor: 1 });
    expect(out).toContain("use 🏭 gstack alone");
    expect(out).not.toContain("↵ enter to confirm");
    expect(out).toContain("→ skills 31  ·  mcps 1  ·  plugins 1  ·  cmds 2");
    // nothing staged → the footer's enter affordance carries no count
    expect(out).toContain("⏎ enter to continue ·");
    expect(out).not.toContain("enter to continue with");
  });

  test("skip row on overrides the ticks: alone label, collapsed preview, zero count", () => {
    const out = frame({ selected: ["vercel", SKIP_COMBINE], cursor: 1 });
    expect(out).toContain("use 🏭 gstack alone");
    expect(out).toContain("← will skip combining");
    expect(out).toContain("→ skills 31  ·  mcps 1  ·  plugins 1  ·  cmds 2");
    expect(out).not.toContain("selected ·"); // ticks don't count while skipping
  });

  test("ASCII mode strips icons from rows and the action label", () => {
    const out = frame({ selected: ["vercel"], cursor: 1, ascii: true });
    expect(out).toContain("[x] vercel");
    expect(out).toContain("use gstack + vercel");
    expect(out).not.toContain("🔺");
    expect(out).not.toContain("🏭");
  });

  test("a conflict-blocked row renders disabled with the blocker named", () => {
    const conflictOpts: AsciiMSOption[] = [
      { value: "medusa-next", label: "medusa-next", hint: "", conflicts: ["medusa-vite"] },
      { value: "medusa-vite", label: "medusa-vite", hint: "", conflicts: ["medusa-next"] },
      { value: SKIP_COMBINE, label: "use medusa alone", hint: "", kind: "action", primaryLabel: "medusa" },
    ];
    const out = strip(
      renderCombineFrame({
        message: "Combine medusa with…",
        options: conflictOpts,
        cursor: 0,
        selected: ["medusa-next"],
        ascii: false,
      }),
    );
    expect(out).toContain("[x] medusa-next");
    expect(out).toContain("[—] medusa-vite (conflicts with medusa-next)");
  });
});

describe("displayWidth", () => {
  test("ascii text counts one cell per char", () => {
    expect(displayWidth("blog-writer")).toBe(11);
  });

  test("a leading emoji icon counts as two cells", () => {
    // 📝(2) + space(1) + blog-writer(11) = 14
    expect(displayWidth("📝 blog-writer")).toBe(14);
    expect(displayWidth("🌱 growth")).toBe(9);
  });

  test("variation selectors and ZWJ add no width", () => {
    // ⚡ + VS16 still measures as the base symbol's two cells, not three
    expect(displayWidth("⚡️ vite")).toBe(displayWidth("⚡ vite"));
  });
});

describe("compressCombo", () => {
  test("≤ max parts render in full", () => {
    expect(compressCombo(["a"])).toBe("a");
    expect(compressCombo(["a", "b", "c"])).toBe("a + b + c");
  });

  test("> max parts collapse to 'first +N more'", () => {
    expect(compressCombo(["a", "b", "c", "d"])).toBe("a +3 more");
    expect(compressCombo(["gstack", "backend", "improver", "commerce", "core"])).toBe(
      "gstack +4 more",
    );
  });

  test("custom max threshold", () => {
    expect(compressCombo(["a", "b", "c"], 2)).toBe("a +2 more");
  });
});

describe("renderCombineFrame · density + compression", () => {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const tallies = new Map<string, ProfileTally>([
    ["gstack", { skills: Array.from({ length: 31 }, (_, i) => `g${i}`), mcps: ["m"], plugins: ["p"], commands: ["c"] }],
    ["commerce", { skills: Array.from({ length: 96 }, (_, i) => `c${i}`), mcps: ["mc1", "mc2"], plugins: ["pc"], commands: ["cc"] }],
  ]);
  const preview = { primary: "gstack", tallies };

  test("an unfocused row shows only the '+N skills' headline (no wrap)", () => {
    const options: AsciiMSOption[] = [
      { value: "commerce", label: "🛒 commerce", hint: "shop" },
      { value: SKIP_COMBINE, label: "use gstack alone", hint: "", kind: "action", primaryLabel: "🏭 gstack" },
    ];
    // cursor on the action row (idx 1), so the commerce row is unfocused.
    const out = strip(renderCombineFrame({ message: "m", options, cursor: 1, selected: ["commerce"], preview, ascii: false }));
    expect(out).toContain("+96 skills");
    expect(out).not.toContain("+2 mcps"); // breakdown hidden when unfocused
  });

  test("the focused row expands to the full breakdown", () => {
    const options: AsciiMSOption[] = [
      { value: "commerce", label: "🛒 commerce", hint: "shop" },
      { value: SKIP_COMBINE, label: "use gstack alone", hint: "", kind: "action", primaryLabel: "🏭 gstack" },
    ];
    const out = strip(renderCombineFrame({ message: "m", options, cursor: 0, selected: ["commerce"], preview, ascii: false }));
    expect(out).toContain("+96 skills · +2 mcps · +1 plugin · +1 cmd");
  });

  test("a long combo collapses the confirm row to 'first +N more'", () => {
    const names = ["backend", "improver", "commerce", "skill-writer", "core", "vite"];
    const options: AsciiMSOption[] = [
      ...names.map((n) => ({ value: n, label: n, hint: "" })),
      { value: SKIP_COMBINE, label: "use gstack alone", hint: "", kind: "action", primaryLabel: "🏭 gstack" },
    ];
    const out = strip(
      renderCombineFrame({ message: "m", options, cursor: names.length, selected: names, ascii: false }),
    );
    expect(out).toContain("use 🏭 gstack +6 more");
    expect(out).not.toContain("skill-writer +"); // not the wrapped full list
  });

  test("a composite primary is split so its parts count toward the fold", () => {
    const options: AsciiMSOption[] = [
      { value: "vite", label: "vite", hint: "" },
      { value: SKIP_COMBINE, label: "use combo alone", hint: "", kind: "action", primaryLabel: "gstack + backend + core" },
    ];
    // primary = 3 parts + 1 companion = 4 > 3 → folds.
    const out = strip(
      renderCombineFrame({ message: "m", options, cursor: 1, selected: ["vite"], ascii: false }),
    );
    expect(out).toContain("use gstack +3 more");
  });
});

describe("buildCompanionOptions · recents default-checked", () => {
  const OPTS: PickerOption[] = [
    { value: "postizz", label: "postizz", hint: "social" },
    { value: "growth", label: "🦜 growth", hint: "growth work" },
    { value: "improver", label: "🖊 improver", hint: "polish" },
  ];

  test("frequent ('you use often') starts checked; featured stays a suggestion", () => {
    const { companionOptions, initialValues } = buildCompanionOptions({
      primary: "postizz",
      primaryLabel: "postizz",
      options: OPTS,
      recommends: [],
      pairSuggested: [],
      companions: [],
      universalSuggestions: [
        { name: "growth", origin: "frequent" },
        { name: "improver", origin: "featured" },
      ],
      autoCheckThreshold: 0.7,
    });
    // both offered…
    expect(companionOptions.map((o) => o.value)).toEqual(expect.arrayContaining(["growth", "improver"]));
    // …but only the frequent one starts checked.
    expect(initialValues).toContain("growth");
    expect(initialValues).not.toContain("improver");
  });

  test("a profile already inside a composite primary is not offered (no duplication)", () => {
    const opts: PickerOption[] = [
      { value: "gstack", label: "🏭 gstack", hint: "" },
      { value: "higgsfield", label: "🌌 higgsfield", hint: "" },
      { value: "growth", label: "🦜 growth", hint: "" },
    ];
    const { companionOptions } = buildCompanionOptions({
      primary: "gstack+higgsfield", // composite primary
      primaryLabel: "🏭 gstack + 🌌 higgsfield",
      options: opts,
      recommends: ["higgsfield", "growth"], // higgsfield already in primary
      pairSuggested: ["gstack"], // gstack already in primary
      companions: [],
      autoCheckThreshold: 0.7,
    });
    const values = companionOptions.map((o) => o.value);
    expect(values).not.toContain("gstack"); // already in primary
    expect(values).not.toContain("higgsfield"); // already in primary
    expect(values).toContain("growth"); // genuinely new → still offered
  });
});

describe("dedupeSelectorParts", () => {
  test("flattens composite picks and drops duplicates, first-seen order kept", () => {
    expect(dedupeSelectorParts(["gstack+higgsfield+postizz", "higgsfield", "postizz", "growth", "gstack"])).toEqual([
      "gstack",
      "higgsfield",
      "postizz",
      "growth",
    ]);
  });

  test("a single profile passes through; empty parts are ignored", () => {
    expect(dedupeSelectorParts(["gstack"])).toEqual(["gstack"]);
    expect(dedupeSelectorParts(["a+", "+b", "a"])).toEqual(["a", "b"]);
  });

  test("control sentinels never survive into the persisted selector (write-boundary backstop)", () => {
    expect(dedupeSelectorParts(["postizz", SHOW_ALL, "blog-writer"])).toEqual(["postizz", "blog-writer"]);
    expect(dedupeSelectorParts(["postizz", SKIP_COMBINE, "blog-writer"])).toEqual(["postizz", "blog-writer"]);
    expect(dedupeSelectorParts([`postizz+${SHOW_ALL}`, "blog-writer"])).toEqual(["postizz", "blog-writer"]);
  });
});

describe("recents auto-check is capped (MAX_FREQUENT_AUTOCHECK)", () => {
  test("only the top N frequent rows start checked; the tail is offered unchecked", () => {
    const freq = ["f1", "f2", "f3", "f4", "f5"];
    const opts: PickerOption[] = [
      { value: "primary", label: "primary", hint: "" },
      ...freq.map((f) => ({ value: f, label: f, hint: "" })),
    ];
    const { companionOptions, initialValues } = buildCompanionOptions({
      primary: "primary",
      primaryLabel: "primary",
      options: opts,
      recommends: [],
      pairSuggested: [],
      companions: [],
      universalSuggestions: freq.map((name) => ({ name, origin: "frequent" as const })),
      autoCheckThreshold: 0.7,
    });
    // all five are offered…
    expect(companionOptions.filter((o) => freq.includes(o.value))).toHaveLength(5);
    // …but only the first MAX_FREQUENT_AUTOCHECK start checked.
    expect(initialValues).toEqual(freq.slice(0, MAX_FREQUENT_AUTOCHECK));
    expect(MAX_FREQUENT_AUTOCHECK).toBe(3);
  });
});

describe("formatOverheadBadge", () => {
  test("stays empty below the warn threshold (light combos uncluttered)", () => {
    expect(formatOverheadBadge(0)).toBe("");
    expect(formatOverheadBadge(OVERHEAD_WARN_TOKENS)).toBe("");
  });

  test("warns above the threshold with a rounded ~k figure and a band emoji", () => {
    const badge = formatOverheadBadge(32_000);
    expect(badge).toContain("⚠ heavy");
    expect(badge).toContain("~32k always-on");
    expect(badge).toContain("🔴"); // > 15k band
  });
});

describe("renderCombineFrame · overhead warning + windowing", () => {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const heavy = (n: number): ProfileTally => ({ skills: [], mcps: [], plugins: [], commands: [], alwaysOn: n });

  test("the overhead warn line appears only when the combined cost is heavy", () => {
    const tallies = new Map<string, ProfileTally>([
      ["base", heavy(4000)],
      ["big", heavy(9000)],
    ]);
    const options: AsciiMSOption[] = [
      { value: "big", label: "big", hint: "" },
      { value: SKIP_COMBINE, label: "use base alone", hint: "", kind: "action", primaryLabel: "base" },
    ];
    const preview = { primary: "base", tallies };
    // base alone = 4000 → no warn.
    expect(strip(renderCombineFrame({ message: "m", options, cursor: 1, selected: [], preview, ascii: false }))).not.toContain("⚠ heavy");
    // base + big = 13000 → over the 10k threshold → warn.
    const out = strip(renderCombineFrame({ message: "m", options, cursor: 0, selected: ["big"], preview, ascii: false }));
    expect(out).toContain("⚠ heavy: ~13k always-on");
  });

  test("a long companion list windows around the cursor, action row stays pinned", () => {
    const names = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const options: AsciiMSOption[] = [
      { value: SKIP_COMBINE, label: "use base alone", hint: "", kind: "action", primaryLabel: "base" },
      ...names.map((n) => ({ value: n, label: n, hint: "" })),
    ];
    // cursor on c6 (option index 7); window of 4 companion rows.
    const out = strip(renderCombineFrame({ message: "m", options, cursor: 7, selected: [], ascii: false, maxRows: 4 }));
    expect(out).toContain("use base alone"); // action row always rendered
    expect(out).toContain("↑"); // hidden-above marker
    expect(out).toContain("more");
    expect(out).toContain("c6"); // the focused row is in-window
    expect(out).not.toContain("c0"); // scrolled off the top
    // only ~4 companion rows render (+ markers), not all 12
    const companionLines = out.split("\n").filter((l) => /\bc\d+\b/.test(l));
    expect(companionLines.length).toBeLessThanOrEqual(4);
  });

  test("no window when maxRows is unset (every companion shows)", () => {
    const names = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const options: AsciiMSOption[] = [
      { value: SKIP_COMBINE, label: "use base alone", hint: "", kind: "action", primaryLabel: "base" },
      ...names.map((n) => ({ value: n, label: n, hint: "" })),
    ];
    const out = strip(renderCombineFrame({ message: "m", options, cursor: 1, selected: [], ascii: false }));
    expect(out).toContain("c0");
    expect(out).toContain("c11");
    expect(out).not.toContain("more");
  });
});

describe("combine category grouping (cue-combine design)", () => {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

  test("combineCategoryOf buckets known profiles; unknown -> other", () => {
    expect(combineCategoryOf("growth")).toBe("orchestrators");
    expect(combineCategoryOf("vercel")).toBe("backend & infra");
    expect(combineCategoryOf("stripe")).toBe("commerce");
    expect(combineCategoryOf("slack")).toBe("integrations");
    expect(combineCategoryOf("totally-unknown-xyz")).toBe("other");
  });

  test("groupByCategory sorts profiles by category; action leads, expand trails", () => {
    const opts: AsciiMSOption[] = [
      { value: SKIP_COMBINE, label: "alone", kind: "action" },
      { value: "stripe", label: "stripe" },   // commerce
      { value: "growth", label: "growth" },    // orchestrators
      { value: "vercel", label: "vercel" },    // backend & infra
      { value: SHOW_ALL, label: "", kind: "expand", expandCount: 1 },
    ];
    const out = groupByCategory(opts);
    expect(out[0]!.value).toBe(SKIP_COMBINE);
    expect(out[out.length - 1]!.value).toBe(SHOW_ALL);
    const profiles = out.filter((o) => !o.kind).map((o) => o.value);
    expect(profiles).toEqual(["growth", "vercel", "stripe"]); // orchestrators < backend < commerce
    expect(out.find((o) => o.value === "growth")!.category).toBe("orchestrators");
  });

  test("renderCombineFrame prints a category header with the group count", () => {
    const opts = groupByCategory([
      { value: "growth", label: "growth" },
      { value: "builder", label: "builder" },
      { value: "vercel", label: "vercel" },
    ]);
    const out = strip(renderCombineFrame({ message: "m", options: opts, cursor: 0, selected: [], ascii: false }));
    expect(out).toContain("orchestrators");
    expect(out).toContain("backend & infra");
    // group count: 2 orchestrators (growth, builder), 1 backend (vercel)
    expect(out).toMatch(/orchestrators ─+ 2/);
  });

  test("a danger profile renders its red tag (full · never use this)", () => {
    const opts = groupByCategory([{ value: "full", label: "🦄 full", danger: "never use this" }]);
    const out = strip(renderCombineFrame({ message: "m", options: opts, cursor: 0, selected: [], ascii: false }));
    expect(out).toContain("never use this");
  });
});
