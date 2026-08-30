import { describe, expect, test } from "bun:test";

import { countProfileSkills, profileSkillIds } from "./profile-capabilities";

describe("profile capability counts", () => {
  const profile = {
    skills: {
      local: [{ id: "meta/analyze" }, { id: "review/security" }],
      npx: [
        { repo: "example/one", skills: ["alpha", "beta"] },
        { repo: "example/two", skills: ["gamma"] },
      ],
    },
  };

  test("counts individual npx skills instead of repository entries", () => {
    expect(countProfileSkills(profile)).toBe(5);
  });

  test("returns stable source-qualified identifiers for exact union previews", () => {
    expect(profileSkillIds(profile)).toEqual([
      "local:meta/analyze",
      "local:review/security",
      "npx:example/one:alpha",
      "npx:example/one:beta",
      "npx:example/two:gamma",
    ]);
  });
});
