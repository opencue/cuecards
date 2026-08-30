/**
 * `cue auto-detect` — detect project type and suggest a profile.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectRepositoryStacks } from "../lib/repository-stack-detect";

export async function run(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const apply = args.includes("--apply");
  const force = args.includes("--force");
  const cwd = process.cwd();

  const report = await detectRepositoryStacks(cwd, { limit: 10 });
  const results = report.repositoryDetected.map((signal) => ({
    profile: signal.name,
    confidence: signal.confidence,
    reasons: signal.reasons,
    evidence: signal.evidence ?? [],
  }));
  const stacks = report.suggestions.map((suggestion) => ({
    profiles: suggestion.parts,
    selector: suggestion.parts.join("+"),
    score: suggestion.score,
    reasons: suggestion.reasons,
    origin: suggestion.origin,
  }));
  const project = report.project;

  if (json) {
    process.stdout.write(
      JSON.stringify({ project, suggestions: results, stacks, autoSelection: report.autoSelection }, null, 2) + "\n",
    );
    return 0;
  }

  // Project info
  const detected: string[] = [];
  if (project.languages.length) detected.push(...project.languages);
  if (project.frameworks.length) detected.push(...project.frameworks);
  if (project.tools.length) detected.push(...project.tools);

  process.stdout.write(`Detected: ${detected.length ? detected.join(", ") : "no strong signals"}\n\n`);

  if (stacks.length === 0) {
    process.stdout.write("No profile matches detected. Use `cue init` for interactive setup.\n");
    return 0;
  }

  process.stdout.write("Suggested profile stacks:\n\n");
  for (let i = 0; i < Math.min(stacks.length, 5); i++) {
    const stack = stacks[i]!;
    process.stdout.write(`  ${i + 1}. ${stack.selector}\n`);
    process.stdout.write(`     signals: ${stack.reasons.join(", ")}\n\n`);
  }

  if (report.autoSelection.status === "confident") {
    process.stdout.write(`Auto-selection: ${report.autoSelection.selector} (${report.autoSelection.reason})\n\n`);
  } else {
    process.stdout.write(`Auto-selection: uncertain — ${report.autoSelection.reason}\n\n`);
  }

  if (apply && stacks.length > 0) {
    const selector = force ? stacks[0]!.selector : report.autoSelection.selector;
    if (!selector) {
      process.stdout.write(
        "Top suggestion is uncertain; nothing pinned. Review with `cue init` or re-run with `--apply --force`.\n",
      );
      return 1;
    }
    writeFileSync(join(cwd, ".cue.profile"), selector + "\n");
    process.stdout.write(`✅ Pinned "${selector}" to .cue.profile\n`);
  } else if (!apply && stacks.length > 0) {
    process.stdout.write(`Run with --apply to pin the top match, or use \`cue init\` for interactive selection.\n`);
  }

  return 0;
}
