import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeProfileSuggestionQuality,
  aggregateProfileChoiceFeedback,
  applyProfileChoiceFeedback,
  PROFILE_CHOICE_DECAY_HALF_LIFE_DAYS,
  PROFILE_CHOICE_FEEDBACK_THRESHOLD,
  PROFILE_CHOICE_RANKER_VERSION,
  PROFILE_CHOICE_RECORD_VERSION,
  profileSuggestionEvidenceHash,
  readProfileChoiceFeedback,
  recordProfileChoice,
  replayProfileChoiceFeedback,
} from "./profile-choice-feedback";
import type { StackSuggestion } from "./stack-suggest";

const row = (cwd: string, choice: string, suggested: string[], ts = "2026-08-17T10:00:00Z") =>
  JSON.stringify({ cwd, choice, suggested, ts });

describe("profile choice feedback", () => {
  test("reports top-suggestion acceptance and overrides by selector", () => {
    const quality = analyzeProfileSuggestionQuality(
      [
        row("/repo", "python", ["python", "core"]),
        row("/repo", "python", ["python", "core"]),
        row("/repo", "python", ["vite", "python"]),
        row("/repo", "core", []),
        row("/other", "rust", ["rust"]),
      ],
      { cwd: "/repo" },
    );

    expect(quality).toMatchObject({
      choices: 4,
      compared: 3,
      topAccepted: 2,
      topOverridden: 1,
      topAcceptanceRate: 2 / 3,
    });
    expect(quality.selectors).toEqual([
      {
        selector: "python",
        shownFirst: 2,
        accepted: 2,
        overridden: 0,
        acceptanceRate: 1,
      },
      {
        selector: "vite",
        shownFirst: 1,
        accepted: 0,
        overridden: 1,
        acceptanceRate: 0,
      },
    ]);
  });

  test("records a normalized, bounded suggestion row", () => {
    let written = "";
    expect(
      recordProfileChoice({
        cwd: "/repo",
        choice: ["nextjs", "nextjs", "gstack"],
        suggested: [["rust"], ["rust"], ["nextjs", "gstack"], ["core"]],
        candidates: [
          { parts: ["rust"], score: 90, reasons: ["detected"], origin: "detected" },
          { parts: ["nextjs", "gstack"], score: 85, reasons: ["detected"], origin: "detected" },
          { parts: ["core"], score: 5, reasons: ["default"], origin: "default" },
        ],
        evidenceHash: "evidence-123",
        surface: "picker-v2",
        now: "2026-08-17T10:00:00Z",
        append: (line) => {
          written = line;
        },
      }),
    ).toBe(true);
    expect(JSON.parse(written)).toEqual({
      schemaVersion: PROFILE_CHOICE_RECORD_VERSION,
      rankerVersion: PROFILE_CHOICE_RANKER_VERSION,
      ts: "2026-08-17T10:00:00Z",
      cwd: "/repo",
      choice: "nextjs+gstack",
      suggested: ["rust", "nextjs+gstack", "core"],
      chosenRank: 2,
      evidenceHash: "evidence-123",
      surface: "picker-v2",
      candidates: [
        { selector: "rust", rank: 1, score: 90, origin: "detected" },
        { selector: "nextjs+gstack", rank: 2, score: 85, origin: "detected" },
        { selector: "core", rank: 3, score: 5, origin: "default" },
      ],
    });
  });

  test("evidence fingerprints ignore display reasons and remain deterministic", () => {
    const evidence = [{ id: "dependency:stripe", family: "dependency:stripe", source: "package.json" }];
    const first = profileSuggestionEvidenceHash([
      { name: "stripe", confidence: 0.65, reasons: ["old wording"], evidence },
    ]);
    const second = profileSuggestionEvidenceHash([
      { name: "stripe", confidence: 0.65, reasons: ["new wording"], evidence },
    ]);

    expect(first).toBe(second);
    expect(first).toHaveLength(16);
  });

  test("time decay keeps raw counts but prevents stale choices from promoting", () => {
    const now = new Date("2026-08-17T10:00:00Z");
    const old = new Date(now.getTime() - PROFILE_CHOICE_DECAY_HALF_LIFE_DAYS * 2 * 86_400_000)
      .toISOString();
    const lines = Array.from({ length: PROFILE_CHOICE_FEEDBACK_THRESHOLD }, () =>
      row("/repo", "rust", ["nextjs", "rust"], old),
    );
    const feedback = aggregateProfileChoiceFeedback(
      lines,
      { cwd: "/repo" },
      { now },
    );

    expect(feedback.get("rust")?.chosen).toBe(3);
    expect(feedback.get("rust")?.weightedChosen).toBeCloseTo(0.75, 5);
    expect(
      applyProfileChoiceFeedback(
        [{ parts: ["nextjs"], score: 100, reasons: ["detected"], origin: "detected" }],
        feedback,
        new Set(["nextjs", "rust"]),
        3,
      ),
    ).toEqual([
      { parts: ["nextjs"], score: 100, reasons: ["detected"], origin: "detected" },
    ]);
  });

  test("legacy rows without schema metadata remain readable", () => {
    const feedback = aggregateProfileChoiceFeedback(
      [JSON.stringify({ cwd: "/repo", choice: "rust", suggested: ["nextjs"] })],
      { cwd: "/repo" },
      { now: new Date("2026-08-17T10:00:00Z") },
    );

    expect(feedback.get("rust")).toMatchObject({ chosen: 1, weightedChosen: 1 });
    expect(feedback.get("nextjs")).toMatchObject({ rejected: 1, weightedRejected: 1 });
  });

  test("offline replay compares legacy counts with the decayed ranker", () => {
    const candidates = [
      { selector: "nextjs", rank: 1, score: 100, origin: "detected" },
      { selector: "rust", rank: 2, score: 90, origin: "detected" },
    ];
    const versionedRow = (ts: string, choice: string) => JSON.stringify({
      schemaVersion: PROFILE_CHOICE_RECORD_VERSION,
      rankerVersion: PROFILE_CHOICE_RANKER_VERSION,
      ts,
      cwd: "/repo",
      choice,
      suggested: ["nextjs", "rust"],
      chosenRank: choice === "nextjs" ? 1 : 2,
      evidenceHash: "same-repo-shape",
      surface: "picker-v2",
      candidates,
    });
    const lines = [
      versionedRow("2026-02-15T10:00:00Z", "rust"),
      versionedRow("2026-02-16T10:00:00Z", "rust"),
      versionedRow("2026-02-17T10:00:00Z", "rust"),
      versionedRow("2026-08-17T10:00:00Z", "nextjs"),
    ];

    const replay = replayProfileChoiceFeedback(lines, { cwd: "/repo" });

    expect(replay).toMatchObject({
      records: 4,
      replayable: 4,
      skippedLegacy: 0,
      legacy: { evaluated: 4, topAccepted: 0, topAcceptanceRate: 0 },
      current: { evaluated: 4, topAccepted: 1, topAcceptanceRate: 0.25 },
      topAcceptanceDelta: 0.25,
    });
  });

  test("counts choices and declined top-1 only inside this repository", () => {
    const lines = [
      row("/repo", "medusa-next", ["nextjs", "medusa-next"]),
      row("/repo/app", "medusa-next", ["nextjs", "medusa-next"]),
      row("/repo", "medusa-next", ["nextjs", "medusa-next"]),
      row("/other", "rust", ["nextjs"]),
    ];
    const feedback = aggregateProfileChoiceFeedback(lines, { cwd: "/repo" });
    expect(feedback.get("medusa-next")?.chosen).toBe(3);
    expect(feedback.get("nextjs")?.rejected).toBe(3);
    expect(feedback.has("rust")).toBe(false);
  });

  test("promotes repeated choices and only demotes never-chosen top-1s", () => {
    const suggestions: StackSuggestion[] = [
      { parts: ["nextjs"], score: 100, reasons: ["detected"], origin: "detected" },
      { parts: ["rust"], score: 90, reasons: ["detected"], origin: "detected" },
    ];
    const feedback = aggregateProfileChoiceFeedback(
      Array.from({ length: PROFILE_CHOICE_FEEDBACK_THRESHOLD }, () =>
        row("/repo", "medusa-next", ["nextjs", "rust"]),
      ),
      { cwd: "/repo" },
      { now: new Date("2026-08-17T10:00:00Z") },
    );
    const ranked = applyProfileChoiceFeedback(
      suggestions,
      feedback,
      new Set(["nextjs", "rust", "medusa-next"]),
      3,
    );
    expect(ranked[0]?.parts).toEqual(["medusa-next"]);
    expect(ranked[0]?.origin).toBe("feedback");
    expect(ranked[0]?.reasons[0]).toContain("3× here");
    expect(ranked.find((item) => item.parts[0] === "nextjs")?.score).toBe(88);
  });

  test("does not change ranking below the repeat threshold", () => {
    const suggestions: StackSuggestion[] = [
      { parts: ["nextjs"], score: 100, reasons: ["detected"], origin: "detected" },
    ];
    const feedback = aggregateProfileChoiceFeedback(
      [row("/repo", "rust", ["nextjs"]), row("/repo", "rust", ["nextjs"])],
      { cwd: "/repo" },
    );
    expect(
      applyProfileChoiceFeedback(suggestions, feedback, new Set(["nextjs", "rust"]), 3),
    ).toEqual(suggestions);
  });

  test("does not promote a repeatedly chosen stack that current repository evidence rejects", () => {
    const suggestions = [
      { parts: ["python"], score: 85, reasons: ["12 .py files"], origin: "detected" as const },
    ];
    const feedback = new Map([
      [
        "python+vite+stripe",
        { selector: "python+vite+stripe", chosen: 9, rejected: 0 },
      ],
    ]);

    const out = applyProfileChoiceFeedback(
      suggestions,
      feedback,
      new Set(["python", "vite", "stripe"]),
      8,
      new Set(["python"]),
    );

    expect(out).toEqual(suggestions);
  });

  test("ranks the pinned composite above repeated partial history", () => {
    const repo = mkdtempSync(join(tmpdir(), "cue-pinned-profile-"));
    try {
      const historyPath = join(repo, "history.jsonl");
      writeFileSync(
        historyPath,
        `${Array.from({ length: 24 }, () =>
          row(repo, "medusa-vite+resend", ["medusa-vite+resend"]),
        ).join("\n")}\n`,
      );
      writeFileSync(
        join(repo, ".cue.profile"),
        "medusa-vite+resend+hostinger+coolify\n",
      );

      const feedback = readProfileChoiceFeedback(historyPath, { cwd: repo });
      const ranked = applyProfileChoiceFeedback(
        [
          {
            parts: ["medusa-vite", "resend"],
            score: 10_000,
            reasons: ["detected"],
            origin: "detected",
          },
        ],
        feedback,
        new Set(["medusa-vite", "resend", "hostinger", "coolify"]),
        4,
        new Set(["medusa-vite", "resend"]),
      );

      expect(ranked[0]).toMatchObject({
        parts: ["medusa-vite", "resend", "hostinger", "coolify"],
        score: 140,
        origin: "feedback",
      });
      expect(ranked[0]?.reasons[0]).toBe("pinned in .cue.profile");
      expect(ranked[1]?.parts).toEqual(["medusa-vite", "resend"]);
      expect(ranked[1]?.score).toBe(10_000);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("does not promote a pin containing an unknown profile", () => {
    const repo = mkdtempSync(join(tmpdir(), "cue-unknown-pin-"));
    try {
      const historyPath = join(repo, "history.jsonl");
      writeFileSync(historyPath, "");
      writeFileSync(join(repo, ".cue.profile"), "medusa-vite+unknown-provider\n");

      const ranked = applyProfileChoiceFeedback(
        [{ parts: ["medusa-vite"], score: 90, reasons: ["detected"], origin: "detected" }],
        readProfileChoiceFeedback(historyPath, { cwd: repo }),
        new Set(["medusa-vite"]),
        4,
      );

      expect(ranked).toEqual([
        { parts: ["medusa-vite"], score: 90, reasons: ["detected"], origin: "detected" },
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
