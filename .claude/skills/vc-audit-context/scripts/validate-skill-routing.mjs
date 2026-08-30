#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function abs(relPath) {
  return path.join(root, relPath);
}

function exists(relPath) {
  return fs.existsSync(abs(relPath));
}

function read(relPath) {
  return fs.readFileSync(abs(relPath), "utf8");
}

function parseFrontmatter(file) {
  const text = read(file);
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  return Object.fromEntries(
    match[1]
      .split("\n")
      .map((line) => line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/))
      .filter(Boolean)
      .map((item) => [item[1], item[2].replace(/^["']|["']$/g, "")]),
  );
}

const policyPath = ".claude/skills/vc-audit-context/references/skill-routing-policy.json";
if (!exists(policyPath)) {
  fail(`${policyPath} missing`);
}

const policy = exists(policyPath)
  ? JSON.parse(read(policyPath))
  : { canonicalRoutingSurfaces: [], allowlistedSkills: {} };

const routingSurfaces = Array.isArray(policy.canonicalRoutingSurfaces)
  ? policy.canonicalRoutingSurfaces
  : [];
const allowlistedSkills = policy.allowlistedSkills && typeof policy.allowlistedSkills === "object"
  ? policy.allowlistedSkills
  : {};

const surfaceTexts = new Map();
for (const relPath of routingSurfaces) {
  if (!exists(relPath)) {
    fail(`${relPath} missing (declared in skill routing policy)`);
    continue;
  }
  surfaceTexts.set(relPath, read(relPath));
}

const skillsDir = abs(".claude/skills");
const skillDirs = fs.existsSync(skillsDir)
  ? fs.readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  : [];

for (const skill of skillDirs) {
  const file = `.claude/skills/${skill}/SKILL.md`;
  if (!exists(file)) {
    fail(`${file} missing`);
    continue;
  }

  const frontmatter = parseFrontmatter(file);
  const aliases = new Set([skill]);
  if (frontmatter.name) aliases.add(frontmatter.name);
  if (frontmatter.name?.startsWith("ck:")) aliases.add(frontmatter.name.slice(3));

  if (Object.prototype.hasOwnProperty.call(allowlistedSkills, skill)) {
    const reason = allowlistedSkills[skill];
    if (typeof reason !== "string" || reason.trim().length < 12) {
      fail(`${policyPath} allowlist entry for ${skill} needs a real reason`);
    }
    continue;
  }

  const matchedSurfaces = [];
  for (const [surface, text] of surfaceTexts.entries()) {
    if ([...aliases].some((alias) => text.includes(`\`${alias}\``) || text.includes(alias))) {
      matchedSurfaces.push(surface);
    }
  }

  if (matchedSurfaces.length === 0) {
    fail(`${skill} is not routed from any canonical surface and is not allowlisted in ${policyPath}`);
  }
}

for (const [skill, reason] of Object.entries(allowlistedSkills)) {
  if (!skillDirs.includes(skill)) {
    warn(`${policyPath} allowlists ${skill}, but the skill folder no longer exists`);
  }
  if (typeof reason !== "string" || reason.trim().length < 12) {
    fail(`${policyPath} allowlist entry for ${skill} must explain why the skill is intentionally not routed`);
  }
}

console.log(JSON.stringify({
  routingSurfaces,
  checkedSkills: skillDirs.length,
  allowlistedCount: Object.keys(allowlistedSkills).length,
  warnings,
  failures,
}, null, 2));

if (failures.length > 0) {
  process.exitCode = 1;
}
