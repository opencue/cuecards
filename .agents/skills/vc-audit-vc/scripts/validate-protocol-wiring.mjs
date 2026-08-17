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

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

// --- 1. List all .md files in process/development-protocols/ ---

const protocolDir = "process/development-protocols";
const protocolDirAbs = path.join(root, protocolDir);
const protocolFiles = [];

if (!fs.existsSync(protocolDirAbs)) {
  fail(`${protocolDir}/ directory does not exist`);
} else {
  for (const entry of fs.readdirSync(protocolDirAbs, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      protocolFiles.push(entry.name);
    }
  }
}

// --- 2. For each agent, scan body for references to protocol files ---

const agentsDir = path.join(root, ".claude/agents");
const checkedAgents = [];

if (fs.existsSync(agentsDir)) {
  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const agentFile = `.claude/agents/${entry.name}`;
    const text = read(agentFile);
    checkedAgents.push(entry.name);

    // Find all process/development-protocols/ references in agent body
    const refs = [...text.matchAll(/process\/development-protocols\/([a-z0-9_-]+\.md)/g)];
    for (const ref of refs) {
      const referencedFile = ref[1];
      if (!protocolFiles.includes(referencedFile)) {
        warn(`${agentFile} references process/development-protocols/${referencedFile} which does not exist on disk`);
      }
    }
  }
}

// --- 3. Check that all-development-protocols.md lists all sibling protocol files ---

const allProtocolsFile = `${protocolDir}/all-development-protocols.md`;
if (exists(allProtocolsFile)) {
  const allProtocolsText = read(allProtocolsFile);
  for (const file of protocolFiles) {
    if (file === "all-development-protocols.md") continue;
    if (!allProtocolsText.includes(file)) {
      fail(`${allProtocolsFile} does not list sibling protocol file: ${file}`);
    }
  }
} else {
  fail(`${allProtocolsFile} does not exist`);
}

// --- 4. Check update-process-agent.md Category 5b scan list ---

const updateProcessAgent = ".claude/agents/vc-update-process-agent.md";
if (exists(updateProcessAgent)) {
  const text = read(updateProcessAgent);

  // Check that README.md is in the scan list
  if (!text.includes("README.md")) {
    warn(`${updateProcessAgent} Category 5b scan list does not include README.md`);
  }

  // Check that process/development-protocols/ is in the scan list
  if (!text.includes("process/development-protocols/")) {
    warn(`${updateProcessAgent} Category 5b scan list does not include process/development-protocols/`);
  }
} else {
  fail(`${updateProcessAgent} does not exist`);
}

const result = {
  checkedProtocols: protocolFiles.length,
  checkedAgents: checkedAgents.length,
  warnings,
  failures,
};

console.log(JSON.stringify(result, null, 2));

if (failures.length > 0) {
  process.exitCode = 1;
}
