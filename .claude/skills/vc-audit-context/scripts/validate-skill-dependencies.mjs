#!/usr/bin/env node
import { loadSkillInventory, extractSkillMentions } from "./shared-skill-utils.mjs";

const warnings = [];
const failures = [];

function warn(message) {
  warnings.push(message);
}

const inventory = loadSkillInventory();
const aliasesBySkill = new Map(inventory.map((skill) => [skill.folder, new Set(skill.aliases)]));
const graph = new Map();

for (const skill of inventory) {
  const mentions = extractSkillMentions(skill.text, aliasesBySkill).filter((name) => name !== skill.folder);
  graph.set(skill.folder, mentions);
}

const visiting = new Set();
const visited = new Set();

function walk(node, stack) {
  if (visiting.has(node)) {
    const cycleStart = stack.indexOf(node);
    const cycle = [...stack.slice(cycleStart), node];
    warn(`skill dependency cycle detected: ${cycle.join(" -> ")}`);
    return;
  }
  if (visited.has(node)) return;

  visiting.add(node);
  for (const next of graph.get(node) || []) {
    walk(next, [...stack, node]);
  }
  visiting.delete(node);
  visited.add(node);
}

for (const skill of graph.keys()) {
  walk(skill, []);
}

console.log(JSON.stringify({
  checkedSkills: inventory.length,
  warnings,
  failures,
}, null, 2));
