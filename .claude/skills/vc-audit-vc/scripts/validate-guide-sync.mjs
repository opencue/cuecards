#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, listSkillDirs, exists, abs } from "../../vc-audit-context/scripts/shared-skill-utils.mjs";

const root = process.cwd();
const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

// --- Agent sync ---

function listAgentNames(dir, extension) {
  const dirAbs = path.join(root, dir);
  if (!fs.existsSync(dirAbs)) return [];
  return fs
    .readdirSync(dirAbs, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => entry.name.slice(0, -extension.length))
    .sort();
}

function extractTableAgents(text) {
  // Match backtick-wrapped agent names in markdown table rows like: | `agent-name` | ... |
  const agents = new Set();
  for (const match of text.matchAll(/\|\s*`([a-z0-9:-]+)`\s*\|/g)) {
    agents.add(match[1]);
  }
  return agents;
}

const guidePath = "README.md";
if (!exists(guidePath)) {
  fail("README.md does not exist");
} else {
  const guideText = read(guidePath);

  // Extract agents from README.md tables (Core + Specialists sections)
  const agentsSectionMatch = guideText.match(/#{2,3} Agents\b[\s\S]*?(?=\n#{2,3} [^#]|\n---)/);
  const agentsSection = agentsSectionMatch ? agentsSectionMatch[0] : "";
  const guideAgents = extractTableAgents(agentsSection);

  // Get disk agents
  const diskAgents = new Set(listAgentNames(".claude/agents", ".md"));

  // Check: every disk agent should be in README.md
  for (const agent of diskAgents) {
    if (!guideAgents.has(agent)) {
      fail(`Agent ${agent} exists on disk but missing from README.md agent tables`);
    }
  }

  // Check: every GUIDE.md agent should exist on disk
  for (const agent of guideAgents) {
    if (!diskAgents.has(agent)) {
      warn(`Agent ${agent} listed in README.md but not found on disk at .claude/agents/${agent}.md`);
    }
  }

  // --- Skill sync ---

  // Extract skills from all README.md skill catalog tables
  const skillsSectionMatch = guideText.match(/#{2,3} Skills Catalog\b[\s\S]*?(?=\n#{2,3} [^#]|\n---\n\n#{2,3} )/);
  const skillsSection = skillsSectionMatch ? skillsSectionMatch[0] : "";
  const guideSkills = extractTableAgents(skillsSection);

  // Get disk skills that have a SKILL.md
  const diskSkillDirs = listSkillDirs();
  const diskSkills = new Set();
  for (const skill of diskSkillDirs) {
    const skillFile = `.claude/skills/${skill}/SKILL.md`;
    if (exists(skillFile)) {
      const parsed = parseFrontmatter(skillFile);
      if (parsed && parsed.fields.name) {
        diskSkills.add(parsed.fields.name);
      }
      // Also add folder name as alias
      diskSkills.add(skill);
    }
  }

  // Build a set of skill folder names for matching
  const diskSkillFolders = new Set(diskSkillDirs.filter((skill) => exists(`.claude/skills/${skill}/SKILL.md`)));

  // Check: every disk skill with a SKILL.md should be in README.md
  for (const folder of diskSkillFolders) {
    const skillFile = `.claude/skills/${folder}/SKILL.md`;
    const parsed = parseFrontmatter(skillFile);
    const name = parsed?.fields?.name || folder;
    // Strip vc: prefix for matching (README.md uses folder names, not vc:-prefixed names)
    const nameWithoutPrefix = name.startsWith("vc:") ? name.slice(3) : name;
    // Check if the skill folder name, frontmatter name, or stripped name appears in README.md
    if (!guideSkills.has(folder) && !guideSkills.has(name) && !guideSkills.has(nameWithoutPrefix)) {
      fail(`Skill ${folder} (name: ${name}) exists on disk but missing from README.md skill catalog`);
    }
  }

  // Check: every GUIDE.md skill should exist on disk
  for (const skill of guideSkills) {
    // Also check vc:-prefixed variant (README.md may list "code-reviewer" which is an agent, not a skill folder)
    if (!diskSkillFolders.has(skill) && !diskSkills.has(skill) && !diskSkills.has(`vc:${skill}`)) {
      warn(`Skill ${skill} listed in README.md but not found on disk`);
    }
  }
}

const result = {
  checkedAgents: true,
  checkedSkills: true,
  warnings,
  failures,
};

console.log(JSON.stringify(result, null, 2));

if (failures.length > 0) {
  process.exitCode = 1;
}
