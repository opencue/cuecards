import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSchedule, fixtures, grade, report, sha256, verifyFixtureBytes, type Result } from "./experiment.ts";

const options = { comparison: "guidance" as const, model: "explicit-test-model", revision: "a".repeat(40), runnerSha256: "b".repeat(64) };
function results(): Result[] {
  return createSchedule(options).map((run) => {
    const fixture = fixtures.find((item) => item.id === run.task)!;
    return { ...run, kind: "real", status: "completed", observedModel: run.model,
      evidenceSha256: sha256(`external-observation:${run.task}:${run.arm}:${run.repetition}`),
      observation: { nextAction: fixture.expected.nextAction, repoBoundary: true, ownershipBoundary: true,
        staleProofRejected: fixture.expected.staleProofRejected, taskTestsPassed: true, duplicateReads: null },
      tokens: null, seconds: null };
  });
}

describe("collaboration experiment contracts (synthetic tests, never effectiveness evidence)", () => {
  test("eight frozen cases, three repeats and balanced arm order", () => {
    const schedule = createSchedule(options);
    expect(fixtures).toHaveLength(8);
    expect(schedule).toHaveLength(48);
    expect(new Set(schedule.map((run) => `${run.task}/${run.arm}/${run.repetition}`)).size).toBe(48);
    expect(schedule.slice(0, 4).map((run) => run.arm)).toEqual(["before", "after", "after", "before"]);
    expect(() => verifyFixtureBytes("modified fixture")).toThrow("checksum");
  });

  test("only guidance or capability varies within its own comparison", () => {
    for (const comparison of ["guidance", "capability"] as const) {
      const [before, after] = createSchedule({ ...options, comparison });
      for (const key of ["model", "revision", "runnerSha256", "taskSha256", "toolsSha256", "permissionsSha256"] as const) {
        expect(before[key]).toBe(after[key]);
      }
      expect(before.guidanceSha256 === after.guidanceSha256).toBe(comparison === "capability");
      expect(before.capabilitySha256 === after.capabilitySha256).toBe(comparison === "guidance");
    }
  });

  test("grade next step and boundaries independently of self-claimed success", () => {
    const run = results()[0];
    expect(grade(run)).toMatchObject({ correct: true, safe: true });
    expect(grade({ ...run, observation: { ...run.observation!, nextAction: "trust prior passed assertion" } }).correct).toBe(false);
    expect(grade({ ...run, observation: { ...run.observation!, ownershipBoundary: false } }).safe).toBe(false);
    expect(grade({ ...run, status: "timeout", observation: null }).correct).toBe(false);
    const stale = results().find((item) => item.task === "dirty-content-changed")!;
    expect(grade({ ...stale, observation: { ...stale.observation!, staleProofRejected: null } }).safe).toBe(null);
  });

  test("preserve missing values, failures, timeouts, raw counts and dispersion", () => {
    const runs = results();
    runs[0].status = "timeout";
    runs[0].observation = null;
    runs[2].status = "failed";
    runs[2].observation = null;
    runs[1].seconds = 4;
    runs[1].tokens = { input: 12, output: 3 };
    const summary = report(runs);
    expect(summary.before.runs).toBe(24);
    expect(summary.before.timeouts).toBe(1);
    expect(summary.after.failures).toBe(1);
    expect(summary.before.seconds).toEqual({ measured: 0, missing: 24, mean: null, standardDeviation: null });
    expect(summary.after.seconds).toEqual({ measured: 1, missing: 23, mean: 4, standardDeviation: 0 });
    expect(summary.after.tokens.mean).toBe(15);
    expect(summary.tasks).toHaveLength(8);
    expect(summary.conclusion).toBe("inconclusive");
  });

  test("refuse empty, incomplete, duplicate, mixed and smoke-only imports", () => {
    expect(() => report([])).toThrow();
    expect(() => report(results().slice(1))).toThrow();
    for (const mutate of [
      (runs: Result[]) => { runs[0] = runs[1]; },
      (runs: Result[]) => { runs[0].kind = "smoke"; },
      (runs: Result[]) => { runs[0].kind = "synthetic"; },
      (runs: Result[]) => { runs[0].model = "other"; },
      (runs: Result[]) => { runs[0].observedModel = "other"; },
      (runs: Result[]) => { runs[0].comparison = "capability"; },
      (runs: Result[]) => { runs[0].taskSha256 = "c".repeat(64); },
      (runs: Result[]) => { runs[0].guidanceSha256 = "c".repeat(64); },
      (runs: Result[]) => { runs[0].runnerSha256 = "c".repeat(64); },
      (runs: Result[]) => { runs[0].graderSha256 = "c".repeat(64); },
      (runs: Result[]) => { runs[0].permissionsSha256 = "c".repeat(64); },
      (runs: Result[]) => { runs[0].capabilitySha256 = "c".repeat(64); },
      (runs: Result[]) => { runs[0].revision = "c".repeat(40); },
    ]) {
      const runs = results(); mutate(runs);
      expect(() => report(runs)).toThrow();
    }
  });

  test("reject malformed boundary data and nonfinite or negative measurements", () => {
    for (const value of [null, {}, "oops", [{ status: "completed" }]]) expect(() => report(value)).toThrow();
    for (const mutate of [
      (runs: Result[]) => { runs[0].seconds = -1; },
      (runs: Result[]) => { runs[0].seconds = Number.NaN; },
      (runs: Result[]) => { runs[0].tokens = { input: -1, output: 2 }; },
      (runs: Result[]) => { runs[0].evidenceSha256 = ""; },
      (runs: Result[]) => { runs[0].observation = null; },
    ]) {
      const runs = results(); mutate(runs);
      expect(() => report(runs)).toThrow();
    }
    expect(() => createSchedule({ ...options, model: "" })).toThrow();
    expect(() => createSchedule({ ...options, repetitions: 1 })).toThrow();
  });

  test("dry CLI validates both separate comparisons without invoking any model", () => {
    for (const comparison of ["guidance", "capability"]) {
      const child = spawnSync(process.execPath, [new URL("./cli.ts", import.meta.url).pathname,
        "--dry", comparison, options.model, options.revision, options.runnerSha256], { encoding: "utf8" });
      expect(child.status).toBe(0);
      const output = JSON.parse(child.stdout);
      expect(output.modelCalls).toBe(0);
      expect(output.totalRuns).toBe(48);
      expect(output.comparison).toBe(comparison);
      expect(output.realRunnerImplemented).toBe(false);
    }
    const child = spawnSync(process.execPath, [new URL("./cli.ts", import.meta.url).pathname, "--full"], { encoding: "utf8" });
    expect(child.status).toBe(1);
    expect(child.stderr).toContain("Usage");
  });

  test("report CLI rejects invalid/oversized imports and never promotes imports to measured gains", () => {
    const dir = mkdtempSync(join(tmpdir(), "cue-collaboration-contract-"));
    const file = join(dir, "results.json");
    const run = () => spawnSync(process.execPath, [new URL("./cli.ts", import.meta.url).pathname,
      "--report", file], { encoding: "utf8" });
    try {
      writeFileSync(file, JSON.stringify(results()));
      const valid = run();
      expect(valid.status).toBe(0);
      expect(JSON.parse(valid.stdout)).toMatchObject({ conclusion: "inconclusive", evidence: "unverified-external-import" });
      for (const content of ["{not-json", "[]", " ".repeat(2_000_001),
        JSON.stringify(results().map((result) => ({ ...result, kind: "smoke" })))]) {
        writeFileSync(file, content);
        expect(run().status).toBe(1);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
