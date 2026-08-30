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

function walk(dir, predicate, out = []) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, predicate, out);
    else if (!predicate || predicate(rel)) out.push(rel);
  }
  return out;
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function hasDateStamp(name) {
  return /(\d{2}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})/.test(name);
}

for (const dir of ["process/general-plans/active", "process/general-plans/completed", "process/features"]) {
  if (!fs.existsSync(path.join(root, dir))) fail(`${dir} missing`);
}

const allPlans = [
  ...walk("process/general-plans", (rel) => rel.endsWith(".md")),
  ...walk("process/features", (rel) => rel.endsWith(".md")),
].sort();

const activePlans = allPlans.filter((file) => file.includes("/active/"));
const completedPlans = allPlans.filter((file) => file.includes("/completed/"));
const duplicateNames = new Map();

const samples = {
  nameNotDateStamped: [],
  noPlanInName: [],
  missingPhaseRules: [],
  missingVerification: [],
  likelyReferenceInActive: [],
};

for (const file of activePlans) {
  const name = path.basename(file);
  duplicateNames.set(name, (duplicateNames.get(name) || 0) + 1);
  const text = read(file);

  if (!hasDateStamp(name)) samples.nameNotDateStamped.push(file);
  if (!/_PLAN_|PLAN\.md$|PLAN_/.test(name)) samples.noPlanInName.push(file);
  if (!/Phase Completion Rules|phase is NOT complete|Phase is NOT complete/i.test(text)) {
    samples.missingPhaseRules.push(file);
  }
  if (!/Verification|Test Procedure|Manual test|Post-Phase Testing|Acceptance Criteria/i.test(text)) {
    samples.missingVerification.push(file);
  }
  if (/handoff|README|execution-sequence/i.test(name) && !/_PLAN_|PLAN/i.test(name)) {
    samples.likelyReferenceInActive.push(file);
  }
}

const duplicateBasenameGroups = [...duplicateNames.entries()]
  .filter(([, count]) => count > 1)
  .map(([name, count]) => ({ name, count }));

if (activePlans.length > 10) warn(`active plan count is high: ${activePlans.length}`);
for (const [key, files] of Object.entries(samples)) {
  if (files.length > 0) warn(`${key}: ${files.length} active files`);
}
if (duplicateBasenameGroups.length > 0) {
  warn(`duplicate active plan basenames: ${duplicateBasenameGroups.length} groups`);
}

const result = {
  activePlans: activePlans.length,
  completedPlans: completedPlans.length,
  warnings,
  failures,
  samples: Object.fromEntries(
    Object.entries(samples).map(([key, files]) => [key, files.slice(0, 20)]),
  ),
  duplicateBasenameGroups: duplicateBasenameGroups.slice(0, 20),
  strict,
};

console.log(JSON.stringify(result, null, 2));

if (failures.length > 0) {
  process.exitCode = 1;
}
