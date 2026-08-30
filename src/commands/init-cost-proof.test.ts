import { describe, expect, test } from "bun:test";

import { showCostProof } from "./init";

describe("cost proof before the shim ask", () => {
  test("invokes cost --compare for the pinned profile", async () => {
    const calls: string[][] = [];
    await showCostProof("backend", {
      costRun: async (args: string[]) => {
        calls.push(args);
        return 0;
      },
    });
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("--compare");
    expect(calls[0]).toContain("backend");
  });

  test("a failing cost run does not block the install", async () => {
    // The proof is a nice-to-have; the shim install is the point. A thrown
    // error here would abort `cue setup` after the profile was already pinned.
    await expect(
      showCostProof("backend", {
        costRun: async () => {
          throw new Error("boom");
        },
      }),
    ).resolves.toBeUndefined();
  });
});
