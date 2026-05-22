import { describe, expect, test } from "bun:test";
import { sortProfileOptions } from "./launch";
import type { PickerOption } from "../lib/picker";

const make = (value: string): PickerOption => ({ value, label: value, hint: "" });

describe("sortProfileOptions", () => {
  test("pinned profile is first", () => {
    const input = [make("backend"), make("frontend"), make("full"), make("marketing")];
    const out = sortProfileOptions(input, "marketing");
    expect(out.map((o) => o.value)).toEqual(["marketing", "full", "backend", "frontend"]);
  });

  test("full is second when pinned profile is set", () => {
    const input = [make("backend"), make("frontend"), make("full")];
    const out = sortProfileOptions(input, "frontend");
    expect(out[0]!.value).toBe("frontend");
    expect(out[1]!.value).toBe("full");
  });

  test("full is first when no pinned profile", () => {
    const input = [make("backend"), make("research"), make("full"), make("marketing")];
    const out = sortProfileOptions(input);
    expect(out[0]!.value).toBe("full");
    // Rest are alphabetical
    expect(out.slice(1).map((o) => o.value)).toEqual(["backend", "marketing", "research"]);
  });

  test("works when pinned profile equals 'full'", () => {
    const input = [make("backend"), make("frontend"), make("full")];
    const out = sortProfileOptions(input, "full");
    expect(out[0]!.value).toBe("full");
  });

  test("does not mutate the input array", () => {
    const input = [make("backend"), make("full"), make("frontend")];
    const before = input.map((o) => o.value);
    sortProfileOptions(input, "frontend");
    expect(input.map((o) => o.value)).toEqual(before);
  });

  test("alphabetical tie-break for non-special profiles", () => {
    const input = [make("zebra"), make("apple"), make("mango")];
    const out = sortProfileOptions(input);
    expect(out.map((o) => o.value)).toEqual(["apple", "mango", "zebra"]);
  });
});
