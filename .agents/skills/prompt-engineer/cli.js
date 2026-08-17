#!/usr/bin/env node

// Installs/uninstalls prompt-engineer skill files (SKILL.md + references/) into Claude Code skills directory
// Usage:
//   npx prompt-engineer-skill              → install to ~/.claude/skills/prompt-engineer
//   npx prompt-engineer-skill --path DIR   → install to custom path
//   node install.js --uninstall            → remove installed files
//   node install.js --dry-run              → preview without changes

const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const pathIdx = args.indexOf('--path');
const dest = pathIdx !== -1
  ? args[pathIdx + 1]
  : path.join(os.homedir(), '.claude', 'skills', 'prompt-engineer');

if (args.includes('--uninstall')) {
  fs.rmSync(dest, { recursive: true, force: true });
  console.log(`prompt-engineer skill removed from ${dest}`);
  process.exit(0);
}

if (args.includes('--dry-run')) {
  console.log(`Would install to: ${dest}`);
  console.log('Files: SKILL.md, references/');
  process.exit(0);
}

const src = __dirname;
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(path.join(src, 'SKILL.md'), path.join(dest, 'SKILL.md'));
fs.cpSync(path.join(src, 'references'), path.join(dest, 'references'), { recursive: true });

console.log(`prompt-engineer skill installed to ${dest}`);
