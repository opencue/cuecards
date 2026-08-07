import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Drift guard for the integrity protocol's ~N% ladder.
 *
 * The ladder (yellow [INFERRED]/[ASSUMED] → ~50/60/70/80%, orange
 * [GUESSED]/[STALE] → ~20/30/40%) is defined in two places that CANNOT import
 * from each other:
 *
 *   - resources/hooks/liedetector-tag-density.sh — the Stop hook, lives in the
 *     cue repo.
 *   - resources/skills/skills/meta/liedetector/scripts/run-evals.sh — the eval
 *     grader, lives in the resources/skills SUBMODULE and ships standalone via
 *     `npx agent-liedetector-skill` to agents that have no cue tree at all.
 *
 * Duplication is therefore the correct design, but silent divergence is not:
 * the whole point of the ladder is that one rule governs every surface. This
 * test reads both definitions and asserts they agree. It also asserts the
 * prose sources still state the same values, so a doc edit can't drift from
 * the code either.
 */

const REPO = join(import.meta.dir, "../..");
const HOOK = join(REPO, "resources/hooks/liedetector-tag-density.sh");
const GRADER = join(
  REPO,
  "resources/skills/skills/meta/liedetector/scripts/run-evals.sh",
);

type Ladder = Record<string, string[]>;

/** Parse the `LADDER = { "INFERRED": {"50", ...}, ... }` python literal. */
function parseLadder(source: string, file: string): Ladder {
  const block = source.match(/LADDER\s*=\s*\{([\s\S]*?)\n\}/);
  if (!block) throw new Error(`no LADDER definition found in ${file}`);

  const ladder: Ladder = {};
  const entry = /"(\w+)"\s*:\s*\{([^}]*)\}/g;
  for (const m of block[1].matchAll(entry)) {
    const values = [...m[2].matchAll(/"(\d+)"/g)].map((v) => v[1]);
    ladder[m[1]] = values.sort();
  }
  if (Object.keys(ladder).length === 0) {
    throw new Error(`LADDER in ${file} parsed to zero entries`);
  }
  return ladder;
}

/**
 * The one true ladder: a 5-point raster, yellow ~50-85%, orange ~20-45%.
 * Changing it here means changing it in both scripts and all four prose files.
 */
const YELLOW = ["50", "55", "60", "65", "70", "75", "80", "85"];
const ORANGE = ["20", "25", "30", "35", "40", "45"];
const EXPECTED: Ladder = {
  INFERRED: YELLOW,
  ASSUMED: YELLOW,
  GUESSED: ORANGE,
  STALE: ORANGE,
};

describe("integrity protocol ~N% ladder", () => {
  test("the hook and the eval grader define the same ladder", async () => {
    const hook = parseLadder(await readFile(HOOK, "utf8"), HOOK);
    const grader = parseLadder(await readFile(GRADER, "utf8"), GRADER);
    expect(hook).toEqual(grader);
  });

  test("both match the canonical ladder", async () => {
    expect(parseLadder(await readFile(HOOK, "utf8"), HOOK)).toEqual(EXPECTED);
    expect(parseLadder(await readFile(GRADER, "utf8"), GRADER)).toEqual(EXPECTED);
  });

  test("tiers do not overlap each other or green", () => {
    const yellow = EXPECTED.INFERRED.map(Number);
    const orange = EXPECTED.GUESSED.map(Number);
    // Yellow spans ~50-85%, orange ~20-45%, green starts at 90%.
    expect(Math.max(...orange)).toBeLessThan(Math.min(...yellow));
    expect(Math.max(...yellow)).toBeLessThan(90);
    expect(EXPECTED.ASSUMED).toEqual(EXPECTED.INFERRED);
    expect(EXPECTED.STALE).toEqual(EXPECTED.GUESSED);
  });

  // The prose sources are what the model actually reads. If a doc says ~90% is
  // legal on yellow while the hook flags it, the model gets nudged for obeying
  // its own instructions — the exact failure this ladder was introduced to fix.
  const PROSE = [
    "resources/personas/integrity-protocol.md",
    "resources/personas/integrity-protocol-compact.md",
    "resources/skills/skills/meta/liedetector/SKILL.md",
    "resources/skills/skills/meta/integrity-tags/SKILL.md",
  ];

  // The compact persona states the raster as a range ("~50% to ~85% in 5-point
  // steps") to stay short; the long-form docs also spell every step out. So
  // assert the RULE — both tier boundaries plus the step size, which together
  // pin all 14 values — rather than demanding 14 literals in every file.
  test.each(PROSE)("%s states the 5-point raster, no stale values", async (rel) => {
    const text = await readFile(join(REPO, rel), "utf8");

    for (const v of ["50", "85"]) expect(text).toContain(`~${v}%`); // yellow bounds
    for (const v of ["20", "45"]) expect(text).toContain(`~${v}%`); // orange bounds
    expect(text).toMatch(/5-point/); // the step size fills in between

    // Both retired ladders are gone: the original decile list, and the 4-value
    // yellow ladder that briefly replaced it.
    expect(text).not.toContain("20 / 30 / 40 / 60 / 80 / 90");
    expect(text).not.toMatch(/~50%`?[,\s]*`?~60%`?[,\s]*`?~70%`?[,\s]*`?~80%/);
  });

  test("calibration is stated as required, not optional", async () => {
    for (const rel of PROSE) {
      const text = await readFile(join(REPO, rel), "utf8");
      expect(text).not.toMatch(/Optional\s+(decile\s+|percentage\s+)?calibration/i);
      expect(text).not.toMatch(/##\s*Optional\s+`?~N%`?/i);
    }
  });
});
