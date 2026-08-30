#!/usr/bin/env bun

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { PROFILE_SUGGESTION_FIXTURES } from "../evals/profile-suggestions/fixtures";
import { detectProfileV2 } from "../src/lib/auto-detect";
import {
  detectRepositoryStacks,
  loadSuggestProfiles,
} from "../src/lib/repository-stack-detect";
import {
  type ProfileSuggestionPrediction,
  scoreProfileSuggestions,
} from "../src/lib/profile-suggestion-eval";

const root = mkdtempSync(join(tmpdir(), "cue-profile-eval-"));
const profiles = await loadSuggestProfiles();

function materialize(id: string, files: Record<string, string>): string {
  const cwd = join(root, id);
  mkdirSync(cwd, { recursive: true });
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(cwd, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  return cwd;
}

async function measure(
  id: string,
  run: () =>
    | Pick<ProfileSuggestionPrediction, "suggestions" | "autoSelection">
    | Promise<Pick<ProfileSuggestionPrediction, "suggestions" | "autoSelection">>,
): Promise<ProfileSuggestionPrediction> {
  const start = performance.now();
  const result = await run();
  return { id, ...result, latencyMs: performance.now() - start };
}

const baseline: ProfileSuggestionPrediction[] = [];
const structured: ProfileSuggestionPrediction[] = [];

try {
  for (const fixture of PROFILE_SUGGESTION_FIXTURES) {
    const cwd = materialize(fixture.id, fixture.files);
    baseline.push(
      await measure(fixture.id, () => {
        const detected = detectProfileV2(cwd);
        return {
          suggestions: detected.map((item) => [item.profile]),
          autoSelection: detected[0]?.profile ?? null,
        };
      }),
    );
    structured.push(
      await measure(fixture.id, async () => {
        const report = await detectRepositoryStacks(cwd, {
          profiles,
          deepMatch: false,
          feedback: new Map(),
          limit: 3,
        });
        return {
          suggestions: report.suggestions.map((item) => item.parts),
          autoSelection: report.autoSelection.selector,
        };
      }),
    );
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

const labels = PROFILE_SUGGESTION_FIXTURES.map(
  ({ id, expected, forbiddenTop, expectedStack, expectAutoSelect }) => ({
    id,
    expected,
    forbiddenTop,
    expectedStack,
    expectAutoSelect,
  }),
);
const baselineMetrics = scoreProfileSuggestions(labels, baseline);
const structuredMetrics = scoreProfileSuggestions(labels, structured);
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const top = (prediction: ProfileSuggestionPrediction) =>
  prediction.suggestions[0]?.join("+") ?? "—";

process.stdout.write("Profile suggestion eval (offline labeled fixtures)\n\n");
process.stdout.write("fixture                    expected            baseline            structured\n");
for (const fixture of PROFILE_SUGGESTION_FIXTURES) {
  const before = baseline.find((item) => item.id === fixture.id)!;
  const after = structured.find((item) => item.id === fixture.id)!;
  process.stdout.write(
    `${fixture.id.padEnd(27)}${fixture.expected.join("|").padEnd(20)}${top(before).padEnd(20)}${top(after)}\n`,
  );
}
process.stdout.write("\nmetric                     baseline       structured\n");
process.stdout.write(`top-1 hit rate             ${pct(baselineMetrics.top1Rate).padEnd(15)}${pct(structuredMetrics.top1Rate)}\n`);
process.stdout.write(`top-2 hit rate             ${pct(baselineMetrics.top2Rate).padEnd(15)}${pct(structuredMetrics.top2Rate)}\n`);
process.stdout.write(`forbidden top-1 rate       ${pct(baselineMetrics.forbiddenTopRate).padEnd(15)}${pct(structuredMetrics.forbiddenTopRate)}\n`);
process.stdout.write(`exact stack rate           ${pct(baselineMetrics.exactStackRate).padEnd(15)}${pct(structuredMetrics.exactStackRate)}\n`);
process.stdout.write(`companion recall           ${pct(baselineMetrics.companionRecallRate).padEnd(15)}${pct(structuredMetrics.companionRecallRate)}\n`);
process.stdout.write(`companion precision        ${pct(baselineMetrics.companionPrecision).padEnd(15)}${pct(structuredMetrics.companionPrecision)}\n`);
process.stdout.write(`overfill rate              ${pct(baselineMetrics.overfillRate).padEnd(15)}${pct(structuredMetrics.overfillRate)}\n`);
process.stdout.write(`simulated acceptance       ${pct(baselineMetrics.simulatedAcceptanceRate).padEnd(15)}${pct(structuredMetrics.simulatedAcceptanceRate)}\n`);
process.stdout.write(`auto decision accuracy     ${pct(baselineMetrics.autoDecisionAccuracy).padEnd(15)}${pct(structuredMetrics.autoDecisionAccuracy)}\n`);
process.stdout.write(`auto selection precision   ${pct(baselineMetrics.autoSelectionPrecision).padEnd(15)}${pct(structuredMetrics.autoSelectionPrecision)}\n`);
process.stdout.write(`auto selection coverage    ${pct(baselineMetrics.autoSelectionCoverage).padEnd(15)}${pct(structuredMetrics.autoSelectionCoverage)}\n`);
process.stdout.write(`wrong auto selections      ${String(baselineMetrics.wrongAutoSelections).padEnd(15)}${structuredMetrics.wrongAutoSelections}\n`);
process.stdout.write(`p95 latency                ${baselineMetrics.p95LatencyMs.toFixed(1).padEnd(15)}${structuredMetrics.p95LatencyMs.toFixed(1)} ms\n`);

const failed =
  structuredMetrics.top1Rate < baselineMetrics.top1Rate ||
  structuredMetrics.top2Rate < baselineMetrics.top2Rate ||
  structuredMetrics.forbiddenTopRate > baselineMetrics.forbiddenTopRate ||
  structuredMetrics.exactStackRate < 1 ||
  structuredMetrics.companionRecallRate < 1 ||
  structuredMetrics.companionPrecision < 1 ||
  structuredMetrics.overfillRate > 0 ||
  structuredMetrics.simulatedAcceptanceRate < 1 ||
  structuredMetrics.autoDecisionAccuracy < 1 ||
  structuredMetrics.autoSelectionPrecision < 1 ||
  structuredMetrics.wrongAutoSelections > 0 ||
  structuredMetrics.p95LatencyMs > 1_000;
if (failed) {
  process.stderr.write("\nEval regression: structured suggestions failed a baseline or latency guard.\n");
  process.exitCode = 1;
}
