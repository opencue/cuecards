import { describe, expect, test } from "bun:test";

import { renderProfileList, type PickerOption } from "./picker";

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
