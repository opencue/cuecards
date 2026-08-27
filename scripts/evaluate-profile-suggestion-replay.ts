#!/usr/bin/env bun

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PROFILE_SUGGESTION_FIXTURES } from "../evals/profile-suggestions/fixtures";
import {
  profileSuggestionEvidenceHash,
  recordProfileChoice,
  replayProfileChoiceFeedback,
} from "../src/lib/profile-choice-feedback";
import {
  detectRepositoryStacks,
  loadSuggestProfiles,
} from "../src/lib/repository-stack-detect";

const SAMPLE_SIZE = 30;
const root = mkdtempSync(join(tmpdir(), "cue-profile-replay-eval-"));
const profiles = await loadSuggestProfiles();
const history: string[] = [];
const materialized = new Map<string, string>();

function materialize(id: string, files: Record<string, string>): string {
  const existing = materialized.get(id);
  if (existing) return existing;
  const cwd = join(root, id);
  mkdirSync(cwd, { recursive: true });
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(cwd, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  materialized.set(id, cwd);
  return cwd;
}

try {
  for (let index = 0; index < SAMPLE_SIZE; index += 1) {
    const fixture = PROFILE_SUGGESTION_FIXTURES[index % PROFILE_SUGGESTION_FIXTURES.length]!;
    const cwd = materialize(fixture.id, fixture.files);
    const report = await detectRepositoryStacks(cwd, {
      profiles,
      deepMatch: false,
      feedback: new Map(),
      limit: 8,
    });
    const choice = fixture.expectedStack ?? [fixture.expected[0]!];
    const selector = choice.join("+");
    if (!report.baseSuggestions.some((candidate) => candidate.parts.join("+") === selector)) {
      throw new Error(`${fixture.id}: labeled choice ${selector} is missing from replay candidates`);
    }
    const recorded = recordProfileChoice({
      cwd,
      choice,
      suggested: report.suggestions.map((candidate) => candidate.parts),
      candidates: report.baseSuggestions,
      evidenceHash: profileSuggestionEvidenceHash(report.repositoryDetected),
      surface: "offline-labeled-fixture",
      now: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
      append: (line) => history.push(line),
    });
    if (!recorded) throw new Error(`${fixture.id}: could not create replay record`);
  }

  const replay = replayProfileChoiceFeedback(history);
  const result = {
    cohort: {
      source: "offline-labeled-fixtures",
      choices: history.length,
      uniqueFixtures: materialized.size,
      persisted: false,
    },
    replay,
  };

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const pct = (value: number | null) =>
      value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
    process.stdout.write("Profile suggestion replay eval (offline labeled fixtures)\n\n");
    process.stdout.write(`choices             ${result.cohort.choices}\n`);
    process.stdout.write(`unique fixtures     ${result.cohort.uniqueFixtures}\n`);
    process.stdout.write(`persisted            no\n`);
    process.stdout.write(
      `sample threshold     ${replay.replayable}/${replay.sampleSizeRequired} (${replay.sampleSizeSufficient ? "ready" : "insufficient"})\n`,
    );
    process.stdout.write(`legacy acceptance   ${pct(replay.legacy.topAcceptanceRate)}\n`);
    process.stdout.write(`current acceptance  ${pct(replay.current.topAcceptanceRate)}\n`);
    process.stdout.write(`acceptance delta    ${pct(replay.topAcceptanceDelta)}\n`);
    process.stdout.write(
      `paired outcomes      current ${replay.paired.currentWins} · legacy ${replay.paired.legacyWins} · ties ${replay.paired.ties}\n`,
    );
  }

  if (
    replay.replayable !== SAMPLE_SIZE ||
    !replay.sampleSizeSufficient ||
    replay.current.topAcceptanceRate === null ||
    replay.legacy.topAcceptanceRate === null ||
    replay.current.topAcceptanceRate < replay.legacy.topAcceptanceRate
  ) {
    process.stderr.write("Profile suggestion replay eval failed its readiness guard.\n");
    process.exitCode = 1;
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
