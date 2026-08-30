import fs from "node:fs";
import path from "node:path";

export const root = process.cwd();

export function abs(relPath) {
  return path.join(root, relPath);
}

export function exists(relPath) {
  return fs.existsSync(abs(relPath));
}

export function read(relPath) {
  return fs.readFileSync(abs(relPath), "utf8");
}

export function parseFrontmatterText(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fields = {};
  const keys = [];
  const lines = match[1].split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const item = lines[index].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!item) continue;
    const [, key, rawValue] = item;
    keys.push(key);

    if (rawValue === ">-" || rawValue === "|" || rawValue === ">") {
      const blockLines = [];
      let cursor = index + 1;
      while (cursor < lines.length && /^  /.test(lines[cursor])) {
        blockLines.push(lines[cursor].replace(/^  /, ""));
        cursor += 1;
      }
      fields[key] = blockLines.join(" ").trim();
      index = cursor - 1;
      continue;
    }

    fields[key] = rawValue.replace(/^["']|["']$/g, "");
  }
  return { fields, keys };
}

export function parseFrontmatter(file) {
  return parseFrontmatterText(read(file));
}

export function loadRoutingPolicy() {
  const policyPath = ".claude/skills/vc-audit-context/references/skill-routing-policy.json";
  if (!exists(policyPath)) {
    return {
      path: policyPath,
      canonicalRoutingSurfaces: [],
      allowlistedSkills: {},
    };
  }
  const parsed = JSON.parse(read(policyPath));
  return {
    path: policyPath,
    canonicalRoutingSurfaces: Array.isArray(parsed.canonicalRoutingSurfaces)
      ? parsed.canonicalRoutingSurfaces
      : [],
    allowlistedSkills: parsed.allowlistedSkills && typeof parsed.allowlistedSkills === "object"
      ? parsed.allowlistedSkills
      : {},
  };
}

export function listSkillDirs() {
  const skillsDir = abs(".claude/skills");
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function loadSkillInventory() {
  const policy = loadRoutingPolicy();
  const surfaceTexts = new Map();
  for (const relPath of policy.canonicalRoutingSurfaces) {
    if (exists(relPath)) surfaceTexts.set(relPath, read(relPath));
  }

  return listSkillDirs().map((skill) => {
    const skillPath = `.claude/skills/${skill}/SKILL.md`;
    const text = exists(skillPath) ? read(skillPath) : "";
    const parsed = exists(skillPath) ? parseFrontmatter(skillPath) : null;
    const fields = parsed?.fields || {};
    const aliases = new Set([skill]);
    if (fields.name) aliases.add(fields.name);
    if (fields.name?.startsWith("ck:")) aliases.add(fields.name.slice(3));

    const routedFrom = [];
    for (const [surface, content] of surfaceTexts.entries()) {
      if ([...aliases].some((alias) => content.includes(`\`${alias}\``) || content.includes(alias))) {
        routedFrom.push(surface);
      }
    }

    return {
      folder: skill,
      path: skillPath,
      text,
      frontmatter: fields,
      frontmatterKeys: parsed?.keys || [],
      aliases: [...aliases],
      allowlisted: Object.prototype.hasOwnProperty.call(policy.allowlistedSkills, skill),
      allowlistReason: policy.allowlistedSkills[skill] || null,
      routedFrom,
    };
  });
}

export function normalizeSkillName(name) {
  return name
    .toLowerCase()
    .replace(/^ck:/, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let row = 0; row <= a.length; row += 1) matrix[row][0] = row;
  for (let col = 0; col <= b.length; col += 1) matrix[0][col] = col;
  for (let row = 1; row <= a.length; row += 1) {
    for (let col = 1; col <= b.length; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

export function extractRelativeReferences(text) {
  const patterns = [
    /`((?:references|scripts|templates|assets)\/[^`\s)]+)`/g,
    /\((?:\.\/)?((?:references|scripts|templates|assets)\/[^)\s]+)\)/g,
  ];
  const found = new Set();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      found.add(match[1]);
    }
  }
  return [...found].sort();
}

export function extractSkillMentions(text, aliasesBySkill) {
  const mentioned = new Set();
  for (const [skill, aliases] of aliasesBySkill.entries()) {
    if ([...aliases].some((alias) => text.includes(`\`${alias}\``))) {
      mentioned.add(skill);
    }
  }
  return [...mentioned].sort();
}

export function writeJsonFile(relPath, data) {
  const target = abs(relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`);
}
