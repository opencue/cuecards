import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectRepositoryStacks } from "./repository-stack-detect";
import type { SuggestProfile, SuggestSignal } from "./stack-suggest";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "cue-repository-stack-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("detectRepositoryStacks", () => {
  test("builds an exact stack from independent repository evidence", async () => {
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ dependencies: { next: "15", stripe: "18" } }),
    );
    const profiles: SuggestProfile[] = [
      { value: "nextjs", conflicts: ["vite"] },
      { value: "stripe" },
      { value: "vite", conflicts: ["nextjs"] },
    ];

    const report = await detectRepositoryStacks(cwd, {
      profiles,
      deepMatch: false,
      feedback: new Map(),
      limit: 3,
    });

    expect(report.repositoryDetected.map((signal) => signal.name)).toEqual([
      "nextjs",
      "stripe",
    ]);
    expect(report.suggestions[0]?.parts).toEqual(["nextjs", "stripe"]);
    expect(report.autoSelection).toMatchObject({
      status: "confident",
      selector: "nextjs+stripe",
    });
  });

  test("does not combine mutually-recommended alternative profiles", async () => {
    const profiles: SuggestProfile[] = [
      { value: "medusa-next", recommends: ["nextjs"] },
      { value: "nextjs", recommends: ["medusa-next"] },
    ];
    const signals: SuggestSignal[] = [
      { name: "medusa-next", confidence: 0.95, reasons: ["medusa sdk"] },
      { name: "nextjs", confidence: 0.9, reasons: ["next config"] },
    ];

    const report = await detectRepositoryStacks(cwd, {
      profiles,
      detected: signals,
      repositoryDetected: signals,
      deepMatch: false,
      feedback: new Map(),
    });

    expect(report.suggestions.every((suggestion) => suggestion.parts.length === 1)).toBe(true);
  });

  test("does not combine different labels derived from the same evidence family", async () => {
    const profiles: SuggestProfile[] = [
      { value: "google-ads" },
      { value: "claude-ads" },
    ];
    const signals: SuggestSignal[] = [
      {
        name: "google-ads",
        confidence: 0.86,
        reasons: ["repository name looks like an ad platform"],
        evidence: [{
          id: "repository-name:ads",
          family: "repository-name:ads",
          source: "repository-name",
        }],
      },
      {
        name: "claude-ads",
        confidence: 0.78,
        reasons: ["directory naming matches advertising automation"],
        evidence: [{
          id: "repository-name:ads",
          family: "repository-name:ads",
          source: "repository-name",
        }],
      },
    ];

    const report = await detectRepositoryStacks(cwd, {
      profiles,
      detected: signals,
      repositoryDetected: signals,
      deepMatch: false,
      feedback: new Map(),
    });

    expect(report.suggestions.every((suggestion) => suggestion.parts.length === 1)).toBe(true);
    expect(report.autoSelection).toMatchObject({
      status: "uncertain",
      selector: null,
      candidate: "google-ads",
    });
  });

  test("does not auto-select a weak repository-only match", async () => {
    const profiles: SuggestProfile[] = [{ value: "backend" }];
    const signals: SuggestSignal[] = [
      { name: "backend", confidence: 0.6, reasons: ["package.json without framework"] },
    ];

    const report = await detectRepositoryStacks(cwd, {
      profiles,
      detected: signals,
      repositoryDetected: signals,
      deepMatch: false,
      feedback: new Map(),
    });

    expect(report.suggestions[0]?.parts).toEqual(["backend"]);
    expect(report.autoSelection).toMatchObject({
      status: "uncertain",
      selector: null,
      candidate: "backend",
    });
  });

  test("keeps pre-feedback candidates separate for unbiased replay", async () => {
    const profiles: SuggestProfile[] = [{ value: "nextjs" }, { value: "rust" }];
    const signals: SuggestSignal[] = [
      { name: "nextjs", confidence: 0.9, reasons: ["next.config.ts"] },
      { name: "rust", confidence: 0.8, reasons: ["Cargo.toml"] },
    ];

    const report = await detectRepositoryStacks(cwd, {
      profiles,
      detected: signals,
      repositoryDetected: signals,
      deepMatch: false,
      feedback: new Map([
        ["rust", { selector: "rust", chosen: 3, rejected: 0 }],
      ]),
    });

    expect(report.baseSuggestions[0]?.parts).toEqual(["nextjs", "rust"]);
    expect(report.baseSuggestions[0]?.origin).toBe("detected");
    expect(report.suggestions[0]?.origin).toBe("feedback");
  });
});
