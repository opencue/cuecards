/**
 * `cue skills test <id>` — run skill unit tests.
 *
 * Test files live in: resources/skills/skills/<category>/<slug>/test/*.md
 * Format:
 *   ---
 *   input: "user message"
 *   expect_contains: ["keyword1", "keyword2"]
 *   expect_not_contains: ["bad_keyword"]
 *   ---
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { listAllSkillIds } from "../lib/resolver-local";

const REPO_ROOT = process.env.CUE_REPO_ROOT ?? process.env.SOUL_REPO_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_ROOT = join(REPO_ROOT, "resources", "skills", "skills");

interface TestCase {
  file: string;
  input: string;
  expect_contains: string[];
  expect_not_contains: string[];
}

interface TestResult {
  file: string;
  passed: boolean;
  failures: string[];
}

function loadTestCases(skillId: string): TestCase[] {
  const testDir = join(SKILLS_ROOT, skillId, "test");
  if (!existsSync(testDir)) return [];

  const cases: TestCase[] = [];
  for (const file of readdirSync(testDir)) {
    if (!file.endsWith(".md")) continue;
    const content = readFileSync(join(testDir, file), "utf8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;

    const fm = fmMatch[1]!;
    const inputMatch = fm.match(/^input:\s*["'](.+?)["']\s*$/m);
    const containsMatch = fm.match(/^expect_contains:\s*\[([^\]]*)\]/m);
    const notContainsMatch = fm.match(/^expect_not_contains:\s*\[([^\]]*)\]/m);

    cases.push({
      file,
      input: inputMatch?.[1] ?? "",
      expect_contains: containsMatch
        ? containsMatch[1]!.split(",").map(s => s.trim().replace(/['"]/g, "")).filter(Boolean)
        : [],
      expect_not_contains: notContainsMatch
        ? notContainsMatch[1]!.split(",").map(s => s.trim().replace(/['"]/g, "")).filter(Boolean)
        : [],
    });
  }
  return cases;
}

function runTest(skillId: string, testCase: TestCase): TestResult {
  const skillPath = join(SKILLS_ROOT, skillId, "SKILL.md");
  const skillContent = existsSync(skillPath) ? readFileSync(skillPath, "utf8").toLowerCase() : "";
  const failures: string[] = [];

  // Check: does the skill description match the input context?
  // Simple heuristic: skill should contain keywords from expect_contains
  for (const kw of testCase.expect_contains) {
    if (!skillContent.includes(kw.toLowerCase())) {
      failures.push(`Expected skill to contain "${kw}" but it doesn't`);
    }
  }

  for (const kw of testCase.expect_not_contains) {
    if (skillContent.includes(kw.toLowerCase())) {
      failures.push(`Expected skill NOT to contain "${kw}" but it does`);
    }
  }

  return { file: testCase.file, passed: failures.length === 0, failures };
}

export async function run(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const all = args.includes("--all");
  const skillId = args.find(a => !a.startsWith("-"));

  let ids: string[];
  if (all) {
    ids = await listAllSkillIds();
  } else if (skillId) {
    ids = [skillId];
  } else {
    process.stderr.write("Usage: cue skills test <skill-id> | --all\n");
    return 1;
  }

  let totalTests = 0;
  let totalPassed = 0;
  const allResults: { skill: string; results: TestResult[] }[] = [];

  for (const id of ids) {
    // Run markdown-based test cases
    const cases = loadTestCases(id);
    if (cases.length > 0) {
      const results = cases.map(c => runTest(id, c));
      totalTests += results.length;
      totalPassed += results.filter(r => r.passed).length;
      allResults.push({ skill: id, results });
    }

    // Run script-based tests (scripts/*_test.py, scripts/*.test.ts)
    const scriptsDir = join(SKILLS_ROOT, id, "scripts");
    if (existsSync(scriptsDir)) {
      const files = readdirSync(scriptsDir);
      const testFiles = files.filter(f => f.endsWith("_test.py") || f.endsWith(".test.ts"));
      if (testFiles.length > 0) {
        const scriptResults: TestResult[] = [];
        for (const tf of testFiles) {
          const cmd = tf.endsWith(".py") ? "python3" : "bun";
          const cmdArgs = tf.endsWith(".py") ? [tf] : ["test", tf];
          const { spawnSync } = await import("node:child_process");
          const proc = spawnSync(cmd, cmdArgs, {
            cwd: scriptsDir,
            encoding: "utf8",
            timeout: 30000,
          });
          const passed = proc.status === 0;
          scriptResults.push({
            file: tf,
            passed,
            failures: passed ? [] : [(proc.stderr || proc.stdout || "exit code " + proc.status).slice(0, 200)],
          });
        }
        totalTests += scriptResults.length;
        totalPassed += scriptResults.filter(r => r.passed).length;
        const existing = allResults.find(r => r.skill === id);
        if (existing) existing.results.push(...scriptResults);
        else allResults.push({ skill: id, results: scriptResults });
      }
    }
  }

  if (json) {
    process.stdout.write(JSON.stringify(allResults, null, 2) + "\n");
    return totalPassed === totalTests ? 0 : 1;
  }

  if (allResults.length === 0) {
    process.stdout.write("No test cases found. Add test/*.md files or scripts/*_test.py to skill directories.\n");
    return 0;
  }

  for (const { skill, results } of allResults) {
    const passed = results.filter(r => r.passed).length;
    const failed = results.length - passed;
    const icon = failed === 0 ? "✅" : "❌";
    process.stdout.write(`${icon} ${skill}: ${results.length} tests, ${passed} passed, ${failed} failed\n`);
    for (const r of results.filter(r => !r.passed)) {
      for (const f of r.failures) {
        process.stdout.write(`     ${r.file}: ${f}\n`);
      }
    }
  }

  process.stdout.write(`\n${totalPassed}/${totalTests} tests passed.\n`);
  return totalPassed === totalTests ? 0 : 1;
}
