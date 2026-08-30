import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { filterConditionalSkills } from "./conditional-skills";
import { loadProfile } from "./profile-loader";

const GITGUARDEX_SKILLS = ["github/gitguardex", "github/gx-agents"];

describe("core GitGuardex collaboration skills", () => {
  test("activates both skills only when cwd contains .omx", async () => {
    const profile = await loadProfile("core");
    const refs = profile.skills.local.filter((ref) =>
      GITGUARDEX_SKILLS.includes(ref.id),
    );

    expect(refs).toEqual(
      GITGUARDEX_SKILLS.map((id) => ({ id, when: { has_dir: ".omx" } })),
    );

    const conditional = refs.map((ref) => {
      if (!ref.when) throw new Error(`${ref.id} must remain conditional`);
      return { id: ref.id, when: ref.when };
    });
    const cwd = await mkdtemp(join(tmpdir(), "cue-core-gx-"));

    try {
      expect(filterConditionalSkills(conditional, cwd)).toEqual([]);
      await mkdir(join(cwd, ".omx"));
      expect(filterConditionalSkills(conditional, cwd)).toEqual(
        GITGUARDEX_SKILLS,
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
