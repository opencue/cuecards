#!/usr/bin/env bun

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { PROFILE_SUGGESTION_FIXTURES } from "../evals/profile-suggestions/fixtures";
import { detectProfileV2 } from "../src/lib/auto-detect";
import { profilesRoot, resolveMatchContext } from "../src/lib/profile-match";
import {
  type ProfileSuggestionPrediction,
  scoreProfileSuggestions,
} from "../src/lib/profile-suggestion-eval";
import {
  mergeSignals,
  pathSignals,
  repositorySupportedProfiles,
  suggestStacks,
} from "../src/lib/stack-suggest";

const root = mkdtempSync(join(tmpdir(), "cue-profile-eval-"));
const knownProfiles = readdirSync(profilesRoot()).filter(
  (name) => !name.startsWith("_") && !name.startsWith("."),
);
const profiles = knownProfiles.map((value) => ({ value }));

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

function measure(id: string, run: () => string[][]): ProfileSuggestionPrediction {
  const start = performance.now();
  const suggestions = run();
  return { id, suggestions, latencyMs: performance.now() - start };
}

const baseline: ProfileSuggestionPrediction[] = [];
const structured: ProfileSuggestionPrediction[] = [];

try {
  for (const fixture of PROFILE_SUGGESTION_FIXTURES) {
    const cwd = materialize(fixture.id, fixture.files);
    baseline.push(
      measure(fixture.id, () => detectProfileV2(cwd).map((item) => [item.profile])),
    );
    structured.push(
      measure(fixture.id, () => {
        const detected = mergeSignals(
          detectProfileV2(cwd).map((item) => ({
            name: item.profile,
            confidence: item.confidence,
            reasons: item.reasons,
          })),
          pathSignals(cwd),
        );
        const matched = (resolveMatchContext(cwd)?.matches ?? []).map((item) => ({
          name: item.name,
          strength: item.strength,
          reason: item.reason,
          matchedTerms: item.matchedTerms,
        }));
        const supportedProfiles = repositorySupportedProfiles(detected, matched);
        return suggestStacks({
          profiles,
          detected,
          matched,
          supportedProfiles,
          limit: 3,
        }).map(
          (item) => item.parts,
        );
      }),
    );
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

const labels = PROFILE_SUGGESTION_FIXTURES.map(({ id, expected, forbiddenTop }) => ({
  id,
  expected,
  forbiddenTop,
}));
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
process.stdout.write(`p95 latency                ${baselineMetrics.p95LatencyMs.toFixed(1).padEnd(15)}${structuredMetrics.p95LatencyMs.toFixed(1)} ms\n`);

const failed =
  structuredMetrics.top1Rate < baselineMetrics.top1Rate ||
  structuredMetrics.top2Rate < baselineMetrics.top2Rate ||
  structuredMetrics.forbiddenTopRate > baselineMetrics.forbiddenTopRate ||
  structuredMetrics.p95LatencyMs > 1_000;
if (failed) {
  process.stderr.write("\nEval regression: structured suggestions failed a baseline or latency guard.\n");
  process.exitCode = 1;
}
