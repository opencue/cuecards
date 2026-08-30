#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const strict = process.argv.includes("--strict");
const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  if (strict) failures.push(message);
  else warnings.push(message);
}

const seedsDir = path.join(root, "process/_seeds");

// 1. Check seeds directory exists
if (!fs.existsSync(seedsDir)) {
  fail("process/_seeds/ directory does not exist");
} else {
  // 2. Check expected subdirectory structure
  const expectedDirs = [
    "context",
    "general-plans/active",
    "general-plans/completed",
    "general-plans/backlog",
    "general-plans/reports",
    "general-plans/references",
    "features/_feature-template",
  ];

  for (const dir of expectedDirs) {
    if (!fs.existsSync(path.join(seedsDir, dir))) {
      fail(`Missing seed directory: process/_seeds/${dir}`);
    }
  }

  // 3. Collect all files recursively
  function walkFiles(dir) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkFiles(full));
      } else {
        results.push(full);
      }
    }
    return results;
  }

  const allFiles = walkFiles(seedsDir);
  const textFiles = allFiles.filter((f) =>
    /\.(md|seed|json|yml|yaml|toml|cjs|mjs)$/.test(f)
  );

  // 4. Check for stale path references
  const stalePatterns = [
    { pattern: /\.claude\/CLAUDE\.md/g, label: ".claude/CLAUDE.md (moved to root)" },
    { pattern: /\.claude\/skills\/(?!vc-)/g, label: "old skill path without vc- prefix" },
  ];

  for (const file of textFiles) {
    const content = fs.readFileSync(file, "utf8");
    const rel = path.relative(root, file);

    for (const { pattern, label } of stalePatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        fail(`${rel}: stale reference to ${label}`);
      }
    }
  }

  // 5. Check .seed files have {{project_name}} placeholder
  const seedFiles = allFiles.filter((f) => f.endsWith(".seed"));
  for (const file of seedFiles) {
    const content = fs.readFileSync(file, "utf8");
    const rel = path.relative(root, file);
    if (!content.includes("{{project_name}}")) {
      warn(`${rel}: missing {{project_name}} placeholder`);
    }
  }

  // 6. Check seed _GUIDE.md files exist for key directories
  const guideDirs = ["", "general-plans/active", "general-plans/completed", "features"];
  for (const dir of guideDirs) {
    const guidePath = path.join(seedsDir, dir, "_GUIDE.md");
    if (!fs.existsSync(guidePath)) {
      const seedGuidePath = path.join(seedsDir, dir, "_GUIDE.md.seed");
      if (!fs.existsSync(seedGuidePath)) {
        warn(`Missing _GUIDE.md or _GUIDE.md.seed in process/_seeds/${dir || "(root)"}`);
      }
    }
  }
}

const result = {
  checkedSeedDir: fs.existsSync(seedsDir),
  warnings,
  failures,
  strict,
};

console.log(JSON.stringify(result, null, 2));

if (failures.length > 0) {
  process.exitCode = 1;
}
