import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { scoreSkillQuality, formatScoreCard } from "./skill-quality";

const TEST_ROOT = join(import.meta.dir, "..", "..", "__test_skill_quality__");

beforeAll(() => {
  const skillsRoot = join(TEST_ROOT, "resources", "skills", "skills");
  const profilesDir = join(TEST_ROOT, "profiles");

  // Override repo root via env
  process.env.CUE_REPO_ROOT = TEST_ROOT;

  // Full-featured skill
  mkdirSync(join(skillsRoot, "review", "full-skill", "scripts"), { recursive: true });
  writeFileSync(join(skillsRoot, "review", "full-skill", "SKILL.md"), `---
name: full-skill
description: "A comprehensive code review skill with many features and capabilities"
tags: [review, quality]
companions: [meta/doctor]
depends: [meta/rtk]
allowed-tools: [Read, Write]
---
# Full Skill
`);
  writeFileSync(join(skillsRoot, "review", "full-skill", "scripts", "run.sh"), "#!/bin/bash\n");
  writeFileSync(join(skillsRoot, "review", "full-skill", "full-skill.test.ts"), "test('x', () => {});\n");
  writeFileSync(join(skillsRoot, "review", "full-skill", ".source"), "opencue/cuecards::resources/skills/skills/review/full-skill\n");

  // Minimal skill
  mkdirSync(join(skillsRoot, "meta", "minimal"), { recursive: true });
  writeFileSync(join(skillsRoot, "meta", "minimal", "SKILL.md"), `---
name: minimal
---
# Minimal
`);

  // Profile referencing full-skill
  mkdirSync(join(profilesDir, "test-profile"), { recursive: true });
  writeFileSync(join(profilesDir, "test-profile", "profile.yaml"), `name: test-profile
description: test
skills:
  local:
    - review/full-skill
`);
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  delete process.env.CUE_REPO_ROOT;
});

describe("scoreSkillQuality", () => {
  test("scores a full-featured skill highly", () => {
    const result = scoreSkillQuality("review/full-skill");
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.breakdown.length).toBe(11);
  });

  test("scores a minimal skill low", () => {
    const result = scoreSkillQuality("meta/minimal");
    expect(result.score).toBeLessThan(30);
  });

  test("returns 0 for nonexistent skill", () => {
    const result = scoreSkillQuality("nonexistent/skill");
    expect(result.score).toBe(0);
  });

  test("breakdown has correct max totals", () => {
    const result = scoreSkillQuality("review/full-skill");
    const totalMax = result.breakdown.reduce((s, b) => s + b.max, 0);
    expect(totalMax).toBe(100);
  });

  test("detects description > 20 chars", () => {
    const result = scoreSkillQuality("review/full-skill");
    const descCrit = result.breakdown.find(b => b.criterion === "Description > 20 chars");
    expect(descCrit?.points).toBe(5);
  });
});

describe("formatScoreCard", () => {
  test("produces readable output with bar chart", () => {
    const result = scoreSkillQuality("review/full-skill");
    const card = formatScoreCard(result);
    expect(card).toContain("Score:");
    expect(card).toContain("/100");
    expect(card).toContain("█");
  });

  test("shows grade letter", () => {
    const card = formatScoreCard({ score: 85, breakdown: [{ criterion: "test", points: 85, max: 100 }] });
    expect(card).toContain("(A)");
  });
});
