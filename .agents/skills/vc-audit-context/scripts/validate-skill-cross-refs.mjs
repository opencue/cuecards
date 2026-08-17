#!/usr/bin/env node
import path from "node:path";
import { loadSkillInventory, extractRelativeReferences, abs, exists } from "./shared-skill-utils.mjs";

const warnings = [];
const failures = [];

function fail(message) {
  failures.push(message);
}

const inventory = loadSkillInventory();

for (const skill of inventory) {
  const baseDir = path.dirname(abs(skill.path));
  const references = extractRelativeReferences(skill.text);
  for (const relRef of references) {
    const candidate = path.join(baseDir, relRef);
    if (!exists(path.relative(process.cwd(), candidate))) {
      fail(`${skill.path} references missing local asset ${relRef}`);
    }
  }
}

console.log(JSON.stringify({
  checkedSkills: inventory.length,
  warnings,
  failures,
}, null, 2));

if (failures.length > 0) {
  process.exitCode = 1;
}
