import { describe, expect, test } from "bun:test";

describe("profile suggestion replay fixture eval", () => {
  test("builds a separate 30-choice v2 cohort and reaches replay readiness", () => {
    const proc = Bun.spawnSync(
      [process.execPath, "scripts/evaluate-profile-suggestion-replay.ts", "--json"],
      {
        cwd: process.cwd(),
        env: { ...process.env, NO_COLOR: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    expect(proc.exitCode).toBe(0);
    expect(proc.stderr.toString()).toBe("");

    const output = JSON.parse(proc.stdout.toString()) as {
      cohort: {
        source: string;
        choices: number;
        uniqueFixtures: number;
        persisted: boolean;
      };
      replay: {
        records: number;
        replayable: number;
        skippedLegacy: number;
        sampleSizeSufficient: boolean;
        rankerVersions: Record<string, number>;
      };
    };

    expect(output.cohort).toEqual({
      source: "offline-labeled-fixtures",
      choices: 30,
      uniqueFixtures: 27,
      persisted: false,
    });
    expect(output.replay.records).toBe(30);
    expect(output.replay.replayable).toBe(30);
    expect(output.replay.skippedLegacy).toBe(0);
    expect(output.replay.sampleSizeSufficient).toBe(true);
    expect(output.replay.rankerVersions).toEqual({
      "profile-feedback-v2-decay90": 30,
    });
  }, 30_000);
});
