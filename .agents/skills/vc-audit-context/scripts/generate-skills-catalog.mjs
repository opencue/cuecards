#!/usr/bin/env node
import fs from "node:fs";
import { loadSkillInventory, normalizeSkillName, extractRelativeReferences, extractSkillMentions, loadRoutingPolicy, writeJsonFile, abs } from "./shared-skill-utils.mjs";

const outputPath = "process/context/generated-skills-catalog.json";
const args = new Set(process.argv.slice(2));
const shouldWrite = args.has("--write");
const shouldCheck = args.has("--check");

const inventory = loadSkillInventory();
const aliasesBySkill = new Map(inventory.map((skill) => [skill.folder, new Set(skill.aliases)]));
const policy = loadRoutingPolicy();

const catalog = {
  owner: "audit-context",
  generatedFrom: {
    skillsRoot: ".claude/skills",
    routingPolicy: policy.path,
    canonicalRoutingSurfaces: policy.canonicalRoutingSurfaces,
  },
  skillCount: inventory.length,
  skills: inventory.map((skill) => ({
    folder: skill.folder,
    name: skill.frontmatter.name || skill.folder,
    description: skill.frontmatter.description || "",
    aliases: skill.aliases,
    normalizedName: normalizeSkillName(skill.frontmatter.name || skill.folder),
    routedFrom: skill.routedFrom,
    allowlisted: skill.allowlisted,
    allowlistReason: skill.allowlistReason,
    relativeReferences: extractRelativeReferences(skill.text),
    mentionedSkills: extractSkillMentions(skill.text, aliasesBySkill).filter((name) => name !== skill.folder),
  })),
};

if (shouldWrite) {
  writeJsonFile(outputPath, catalog);
}

if (shouldCheck) {
  const target = abs(outputPath);
  if (!fs.existsSync(target)) {
    console.error(`${outputPath} missing; run generate-skills-catalog.mjs --write first`);
    process.exit(1);
  }
  const existing = fs.readFileSync(target, "utf8");
  const next = `${JSON.stringify(catalog, null, 2)}\n`;
  if (existing !== next) {
    console.error(`${outputPath} is stale; regenerate with generate-skills-catalog.mjs --write`);
    process.exit(1);
  }
}

console.log(JSON.stringify({
  outputPath,
  skillCount: catalog.skillCount,
  wrote: shouldWrite,
  checked: shouldCheck,
}, null, 2));
