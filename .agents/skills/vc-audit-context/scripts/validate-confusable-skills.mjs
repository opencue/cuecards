#!/usr/bin/env node
import { loadSkillInventory, normalizeSkillName, levenshtein } from "./shared-skill-utils.mjs";

const warnings = [];
const failures = [];

function warn(message) {
  warnings.push(message);
}

const inventory = loadSkillInventory().map((skill) => ({
  folder: skill.folder,
  primary: skill.frontmatter.name || skill.folder,
  normalized: normalizeSkillName(skill.frontmatter.name || skill.folder),
}));

for (let index = 0; index < inventory.length; index += 1) {
  for (let cursor = index + 1; cursor < inventory.length; cursor += 1) {
    const left = inventory[index];
    const right = inventory[cursor];
    if (left.normalized === right.normalized) {
      warn(`skills ${left.folder} and ${right.folder} normalize to the same name (${left.normalized})`);
      continue;
    }
    if (left.normalized.startsWith(right.normalized) || right.normalized.startsWith(left.normalized)) {
      warn(`skills ${left.folder} and ${right.folder} may be confusable by prefix (${left.primary} vs ${right.primary})`);
      continue;
    }
    if (levenshtein(left.normalized, right.normalized) === 1) {
      warn(`skills ${left.folder} and ${right.folder} differ by edit distance 1 (${left.primary} vs ${right.primary})`);
    }
  }
}

console.log(JSON.stringify({
  checkedSkills: inventory.length,
  warnings,
  failures,
}, null, 2));
