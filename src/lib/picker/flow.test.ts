import { describe, expect, test } from "bun:test";

import { flattenProfileRows, pickerV2Enabled } from "./flow";
import { DIVIDER_PREFIX } from "./selector";
import type { PickerOption } from "./types";

describe("pickerV2Enabled", () => {
  test("is on by default", () => {
    expect(pickerV2Enabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(pickerV2Enabled({ CUE_PICKER: "" } as NodeJS.ProcessEnv)).toBe(true);
  });

  test("CUE_PICKER=classic (and its aliases) restores the old flow", () => {
    for (const v of ["classic", "CLASSIC", " v1 ", "legacy"]) {
      expect(pickerV2Enabled({ CUE_PICKER: v } as NodeJS.ProcessEnv)).toBe(false);
    }
  });

  test("an unrecognized value stays on v2 rather than failing closed", () => {
    expect(pickerV2Enabled({ CUE_PICKER: "shiny" } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("flattenProfileRows", () => {
  const options: PickerOption[] = [
    { value: `${DIVIDER_PREFIX}suggested`, label: "── Suggested ──", hint: "", divider: true },
    { value: "rust", label: "🦀 rust", hint: "suggested copy" },
    { value: "core+ecc", label: "⭐ Default → core + ecc", hint: "", top: true },
    { value: `${DIVIDER_PREFIX}all`, label: "── All ──", hint: "", divider: true },
    { value: "rust", label: "🦀 rust", hint: "catalogue copy" },
    { value: "secops", label: "🔒 secops", hint: "security" },
  ];

  test("keeps real profiles only, once each, first occurrence winning", () => {
    const out = flattenProfileRows(options);
    expect(out.map((o) => o.value)).toEqual(["rust", "secops"]);
    expect(out[0]?.hint).toBe("suggested copy");
  });

  test("drops dividers and composite rows", () => {
    const out = flattenProfileRows(options);
    expect(out.some((o) => o.divider === true)).toBe(false);
    expect(out.some((o) => o.value.includes("+"))).toBe(false);
  });

  test("an empty list stays empty", () => {
    expect(flattenProfileRows([])).toEqual([]);
  });
});
