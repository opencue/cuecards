#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, listSkillDirs, exists, abs } from "../../vc-audit-context/scripts/shared-skill-utils.mjs";

const root = process.cwd();
const failures = [];
const warnings = [];
const blockingKeys = new Set(["name", "description", "license", "allowed-tools", "metadata", "argument-hint", "languages"]);
const advisoryKeys = new Set(["user-invocable", "when_to_use", "category", "keywords"]);
const intentionallyIgnored = new Set(["sync-from-riper5", "sync-to-riper5"]);
const staleOwnershipPatterns = [
  "default workflow owner",
  "workflow owner",
  "vc:plan",
  "vc:cook",
  "vc:fix",
  "vc:research",
  "vc:code-review",
];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

const skillsDir = path.join(root, ".claude/skills");
if (!fs.existsSync(skillsDir)) {
  fail(".claude/skills missing");
}

const agentsSkills = path.join(root, ".agents/skills");
if (!fs.existsSync(agentsSkills)) {
  fail(".agents/skills missing");
} else if (fs.existsSync(skillsDir)) {
  const source = fs.realpathSync(skillsDir);
  const discovered = fs.realpathSync(agentsSkills);
  if (source !== discovered) {
    fail(".agents/skills does not resolve to .claude/skills");
  }
}

const skillNames = listSkillDirs();

let checkedSkills = 0;
for (const skill of skillNames) {
  const file = `.claude/skills/${skill}/SKILL.md`;
  const codexPath = `.agents/skills/${skill}/SKILL.md`;
  if (!exists(file)) {
    fail(`${file} missing`);
    continue;
  }
  if (!exists(codexPath)) {
    fail(`${codexPath} missing`);
  }

  checkedSkills += 1;
  const parsed = parseFrontmatter(file);
  if (!parsed) {
    const message = `${file} missing YAML frontmatter`;
    if (intentionallyIgnored.has(skill)) warn(`${message} but intentionally ignored`);
    else fail(message);
    continue;
  }

  const { fields, keys } = parsed;
  if (!fields.name || !fields.description) {
    const message = `${file} missing name/description frontmatter`;
    if (intentionallyIgnored.has(skill)) warn(`${message} but intentionally ignored`);
    else fail(message);
  }
  if (fields.name && fields.name !== skill && !fields.name.startsWith("vc:")) {
    warn(`${file} frontmatter name ${fields.name} differs from folder ${skill}`);
  }
  if (fields.name && !/^[a-z0-9:-]+$/.test(fields.name)) {
    fail(`${file} frontmatter name is not lowercase/hyphen/colon safe`);
  }
  if (fields.description && fields.description.length > 1024) {
    fail(`${file} description is longer than 1024 characters`);
  }
  if (fields.description && fields.description.length < 24) {
    warn(`${file} description is very short; expand the trigger/use-case wording`);
  }
  if (fields.description && fields.description.length > 220) {
    warn(`${file} description is long for listing/routing surfaces; consider keeping it under 220 characters`);
  }
  if (fields.description && !/\b(use|when|for)\b/i.test(fields.description)) {
    warn(`${file} description may be low-signal; include trigger language such as "Use when..."`);
  }
  if (fields.description && staleOwnershipPatterns.some((pattern) => fields.description.includes(pattern))) {
    fail(`${file} description contains stale workflow-owner language`);
  }
  if (fields.description && /\b(maintainers?|internal only|for maintainers)\b/i.test(fields.description)) {
    warn(`${file} description sounds maintainer-facing; prefer user/invocation trigger language`);
  }

  const unexpected = keys.filter((key) => !blockingKeys.has(key) && !advisoryKeys.has(key));
  if (unexpected.length > 0) warn(`${file} has non-system frontmatter keys: ${unexpected.join(", ")}`);

  for (const key of keys.filter((item) => advisoryKeys.has(item))) {
    warn(`${file} uses richer advisory frontmatter key ${key}; keep Codex compatibility in mind if this expands`);
  }
}

const result = {
  checkedSkills,
  warnings,
  failures,
};

console.log(JSON.stringify(result, null, 2));

if (failures.length > 0) {
  process.exitCode = 1;
}
