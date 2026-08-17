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

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function listAgentNames(dir, extension) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => entry.name.slice(0, -extension.length))
    .sort();
}

function parseClaudeAgent(file) {
  const text = read(file);
  const frontmatter = {};
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (match) {
    for (const line of match[1].split("\n")) {
      const item = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (item) frontmatter[item[1]] = item[2].replace(/^["']|["']$/g, "");
    }
  }
  return {
    description: frontmatter.description || "",
    body: text.replace(/^---\n[\s\S]*?\n---\n?/, "").trim(),
  };
}

function parseCodexAgent(file) {
  const text = read(file);
  const description =
    text.match(/^description\s*=\s*'''([\s\S]*?)'''/m)?.[1] ||
    text.match(/^description\s*=\s*"""([\s\S]*?)"""/m)?.[1] ||
    text.match(/^description\s*=\s*"([^"]*)"/m)?.[1] ||
    text.match(/^description\s*=\s*'([^']*)'/m)?.[1] ||
    "";
  const body =
    text.match(/developer_instructions\s*=\s*'''([\s\S]*?)'''/m)?.[1] ||
    text.match(/developer_instructions\s*=\s*"""([\s\S]*?)"""/m)?.[1] ||
    "";
  return { description, body: body.trim() };
}

function modeOf(text) {
  return text.match(/\[MODE:\s*([A-Z -]+)\]/)?.[1] || "";
}

function normalizeDescription(text) {
  return text.replace(/''/g, "'").replace(/\s+/g, " ").trim();
}

function normalize(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\.claude\/CLAUDE\.md|CLAUDE\.md|AGENTS\.md/g, "{TOP_LEVEL_INSTRUCTIONS}")
    .replace(/\.claude\/skills\/|\.agents\/skills\//g, "{SKILLS}/")
    .replace(/\.claude\/agents\/|\.codex\/agents\//g, "{AGENTS}/")
    .replace(/`\{SKILLS\}\/`, `\{AGENTS\}\/`, and `\{AGENTS\}\/`/g, "`{SKILLS}/` and `{AGENTS}/`")
    .replace(/`\{AGENTS\}\/` and `\{AGENTS\}\/`/g, "`{AGENTS}/`")
    .replace(/\{AGENTS\}\/ and \{AGENTS\}\//g, "{AGENTS}/")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

const claudeAgents = listAgentNames(".claude/agents", ".md");
const codexAgents = listAgentNames(".codex/agents", ".toml");

for (const agent of claudeAgents) {
  if (!codexAgents.includes(agent)) fail(`.codex/agents/${agent}.toml missing`);
}
for (const agent of codexAgents) {
  if (!claudeAgents.includes(agent)) fail(`.claude/agents/${agent}.md missing`);
}

const compared = [];
for (const agent of claudeAgents.filter((name) => codexAgents.includes(name))) {
  const claudeFile = `.claude/agents/${agent}.md`;
  const codexFile = `.codex/agents/${agent}.toml`;
  const claude = parseClaudeAgent(claudeFile);
  const codex = parseCodexAgent(codexFile);
  const claudeMode = modeOf(claude.body);
  const codexMode = modeOf(codex.body);

  if (!claude.description) fail(`${claudeFile} description missing`);
  if (!codex.description) fail(`${codexFile} description missing`);
  if (
    claude.description &&
    codex.description &&
    normalizeDescription(claude.description) !== normalizeDescription(codex.description)
  ) {
    warn(`${agent} descriptions differ between Claude and Codex`);
  }
  if (claudeMode !== codexMode) {
    fail(`${agent} mode mismatch: Claude=${claudeMode || "missing"} Codex=${codexMode || "missing"}`);
  }
  if (!claude.body.includes("process/context/all-context.md") && !["git-manager", "innovate-agent"].includes(agent)) {
    warn(`${claudeFile} does not mention process/context/all-context.md`);
  }
  if (!codex.body.includes("process/context/all-context.md") && !["git-manager", "innovate-agent"].includes(agent)) {
    warn(`${codexFile} does not mention process/context/all-context.md`);
  }

  const normalizedClaude = normalize(claude.body);
  const normalizedCodex = normalize(codex.body);
  if (normalizedClaude !== normalizedCodex) {
    const lengthDelta = Math.abs(normalizedClaude.length - normalizedCodex.length);
    const larger = Math.max(normalizedClaude.length, normalizedCodex.length) || 1;
    warn(`${agent} normalized body differs (${Math.round((lengthDelta / larger) * 100)}% length delta)`);
  }

  compared.push(agent);
}

const result = {
  checkedClaudeAgents: claudeAgents.length,
  checkedCodexAgents: codexAgents.length,
  comparedAgents: compared.length,
  warnings,
  failures,
  strict,
};

console.log(JSON.stringify(result, null, 2));

if (failures.length > 0) {
  process.exitCode = 1;
}
