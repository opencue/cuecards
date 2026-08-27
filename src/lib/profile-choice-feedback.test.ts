import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeProfileSuggestionQuality,
  aggregateProfileChoiceFeedback,
  applyProfileChoiceFeedback,
  PROFILE_CHOICE_FEEDBACK_THRESHOLD,
  readProfileChoiceFeedback,
  recordProfileChoice,
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
        now: "2026-08-17T10:00:00Z",
        append: (line) => {
          written = line;
        },
      }),
    ).toBe(true);
    expect(JSON.parse(written)).toEqual({
      ts: "2026-08-17T10:00:00Z",
      cwd: "/repo",
      choice: "nextjs+gstack",
      suggested: ["rust", "nextjs+gstack", "core"],
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
            score: 100,
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
