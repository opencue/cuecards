#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");
const setupScript = path.join(skillRoot, "scripts", "setup_attestation_cron.mjs");

function runSetup(args = [], env = {}) {
  return spawnSync(process.execPath, [setupScript, ...args], {
    cwd: skillRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

async function withTempDir(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hag-cron-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

await withTempDir(async (tempDir) => {
  const hermesHome = path.join(tempDir, ".hermes");
  const result = runSetup(["--every", "6h", "--print-only"], {
    HERMES_HOME: hermesHome,
  });

  assert.equal(result.status, 0, `setup script failed: ${result.stderr}`);
  assert.ok(result.stdout.includes("Preflight review:"));
  assert.ok(result.stdout.includes("Scope: Hermes-only"));
  assert.ok(result.stdout.includes("hermes-attestation-guardian"));
  assert.ok(result.stdout.includes("generate_attestation.mjs"));
  assert.ok(result.stdout.includes("verify_attestation.mjs"));
  assert.equal(result.stdout.toLowerCase().includes("openclaw"), false, "must not mention OpenClaw runtime");
});

await withTempDir(async (tempDir) => {
  const hermesHome = path.join(tempDir, ".hermes");
  const result = runSetup(["--print-only", "--output", path.join(tempDir, "outside.json")], {
    HERMES_HOME: hermesHome,
  });

  assert.notEqual(result.status, 0, "out-of-scope output path must be rejected");
  assert.ok(result.stderr.includes("output path must stay under"), result.stderr);
});

await withTempDir(async (tempDir) => {
  const hermesHome = path.join(tempDir, ".hermes");
  const weirdPolicy = path.join(tempDir, "policy'withquote.json");
  const result = runSetup(["--every", "6h", "--policy", weirdPolicy, "--print-only"], {
    HERMES_HOME: hermesHome,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes("policy'\\''withquote.json"), "single quotes must be shell-escaped in cron command");
});

await withTempDir(async (tempDir) => {
  const hermesHome = path.join(tempDir, ".hermes");
  const fakeBinDir = path.join(tempDir, "bin");
  const logPath = path.join(tempDir, "crontab.log");
  const writePath = path.join(tempDir, "crontab.write");
  await fs.mkdir(fakeBinDir, { recursive: true });

  const fakeCrontab = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const logPath = ${JSON.stringify(logPath)};
const writePath = ${JSON.stringify(writePath)};
if (args[0] === '-l') {
  fs.appendFileSync(logPath, 'list-empty\\n', 'utf8');
  process.stderr.write('no crontab for test-user\\n');
  process.exit(1);
}
if (args[0] === '-') {
  fs.appendFileSync(logPath, 'write\\n', 'utf8');
  fs.writeFileSync(writePath, fs.readFileSync(0, 'utf8'), 'utf8');
  process.exit(0);
}
process.stderr.write('unexpected crontab args: ' + args.join(' ') + '\\n');
process.exit(2);
`;
  const fakeCrontabPath = path.join(fakeBinDir, "crontab");
  await fs.writeFile(fakeCrontabPath, fakeCrontab, { encoding: "utf8", mode: 0o755 });

  const result = runSetup(["--apply"], {
    HERMES_HOME: hermesHome,
    PATH: `${fakeBinDir}:${process.env.PATH}`,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes("Updated user schedule table"), result.stdout);
  const log = await fs.readFile(logPath, "utf8");
  assert.ok(log.includes("list-empty"), "script should treat empty-crontab stderr as no existing schedule");
  assert.ok(log.includes("write"), "script should still write managed block on fresh machines");
  const written = await fs.readFile(writePath, "utf8");
  assert.ok(written.includes("# >>> hermes-attestation-guardian >>>"), written);
});

await withTempDir(async (tempDir) => {
  const hermesHome = path.join(tempDir, ".hermes");
  const fakeBinDir = path.join(tempDir, "bin");
  const logPath = path.join(tempDir, "crontab.log");
  const writePath = path.join(tempDir, "crontab.write");
  await fs.mkdir(fakeBinDir, { recursive: true });

  const fakeCrontab = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const logPath = ${JSON.stringify(logPath)};
const writePath = ${JSON.stringify(writePath)};
if (args[0] === '-l') {
  fs.appendFileSync(logPath, 'list\\n', 'utf8');
  process.stdout.write('# >>> hermes-attestation-guardian >>>\\n# dangling-start-no-end\\n0 0 * * * /usr/bin/true\\n');
  process.exit(0);
}
if (args[0] === '-') {
  fs.appendFileSync(logPath, 'write\\n', 'utf8');
  fs.writeFileSync(writePath, fs.readFileSync(0, 'utf8'), 'utf8');
  process.exit(0);
}
process.stderr.write('unexpected crontab args: ' + args.join(' ') + '\\n');
process.exit(2);
`;
  const fakeCrontabPath = path.join(fakeBinDir, "crontab");
  await fs.writeFile(fakeCrontabPath, fakeCrontab, { encoding: "utf8", mode: 0o755 });

  const result = runSetup(["--apply"], {
    HERMES_HOME: hermesHome,
    PATH: `${fakeBinDir}:${process.env.PATH}`,
  });

  assert.notEqual(result.status, 0, "unmatched start marker must fail closed");
  assert.ok(result.stderr.includes("Malformed schedule markers"), result.stderr);
  const log = await fs.readFile(logPath, "utf8");
  assert.ok(log.includes("list"), "script should read crontab before writing");
  const wrote = await fs.access(writePath).then(() => true).catch(() => false);
  assert.equal(wrote, false, "script must not write crontab on malformed marker block");
});
await withTempDir(async (tempDir) => {
  const hermesHome = path.join(tempDir, ".hermes");
  const fakeBinDir = path.join(tempDir, "bin");
  const logPath = path.join(tempDir, "crontab.log");
  const writePath = path.join(tempDir, "crontab.write");
  await fs.mkdir(fakeBinDir, { recursive: true });

  const fakeCrontab = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const logPath = ${JSON.stringify(logPath)};
const writePath = ${JSON.stringify(writePath)};
if (args[0] === '-l') {
  fs.appendFileSync(logPath, 'list\\n', 'utf8');
  process.stdout.write('# <<< hermes-attestation-guardian <<<\\n0 0 * * * /usr/bin/true\\n');
  process.exit(0);
}
if (args[0] === '-') {
  fs.appendFileSync(logPath, 'write\\n', 'utf8');
  fs.writeFileSync(writePath, fs.readFileSync(0, 'utf8'), 'utf8');
  process.exit(0);
}
process.stderr.write('unexpected crontab args: ' + args.join(' ') + '\\n');
process.exit(2);
`;
  const fakeCrontabPath = path.join(fakeBinDir, "crontab");
  await fs.writeFile(fakeCrontabPath, fakeCrontab, { encoding: "utf8", mode: 0o755 });

  const result = runSetup(["--apply"], {
    HERMES_HOME: hermesHome,
    PATH: `${fakeBinDir}:${process.env.PATH}`,
  });

  assert.notEqual(result.status, 0, "unmatched end marker must fail closed");
  assert.ok(result.stderr.includes("Malformed schedule markers"), result.stderr);
  const log = await fs.readFile(logPath, "utf8");
  assert.ok(log.includes("list"), "script should read crontab before writing");
  const wrote = await fs.access(writePath).then(() => true).catch(() => false);
  assert.equal(wrote, false, "script must not write crontab when end marker is unmatched");
});

await withTempDir(async (tempDir) => {
  const hermesHome = path.join(tempDir, ".hermes");
  const fakeBinDir = path.join(tempDir, "bin");
  const logPath = path.join(tempDir, "crontab.log");
  const writePath = path.join(tempDir, "crontab.write");
  await fs.mkdir(fakeBinDir, { recursive: true });

  const fakeCrontab = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const logPath = ${JSON.stringify(logPath)};
const writePath = ${JSON.stringify(writePath)};
if (args[0] === '-l') {
  fs.appendFileSync(logPath, 'list\\n', 'utf8');
  process.stdout.write('# >>> hermes-attestation-guardian >>>\\n# >>> hermes-attestation-guardian >>>\\n# nested-start\\n# <<< hermes-attestation-guardian <<<\\n');
  process.exit(0);
}
if (args[0] === '-') {
  fs.appendFileSync(logPath, 'write\\n', 'utf8');
  fs.writeFileSync(writePath, fs.readFileSync(0, 'utf8'), 'utf8');
  process.exit(0);
}
process.stderr.write('unexpected crontab args: ' + args.join(' ') + '\\n');
process.exit(2);
`;
  const fakeCrontabPath = path.join(fakeBinDir, "crontab");
  await fs.writeFile(fakeCrontabPath, fakeCrontab, { encoding: "utf8", mode: 0o755 });

  const result = runSetup(["--apply"], {
    HERMES_HOME: hermesHome,
    PATH: `${fakeBinDir}:${process.env.PATH}`,
  });

  assert.notEqual(result.status, 0, "nested start marker must fail closed");
  assert.ok(result.stderr.includes("Malformed schedule markers"), result.stderr);
  const log = await fs.readFile(logPath, "utf8");
  assert.ok(log.includes("list"), "script should read crontab before writing");
  const wrote = await fs.access(writePath).then(() => true).catch(() => false);
  assert.equal(wrote, false, "script must not write crontab when marker blocks are nested");
});

console.log("setup_attestation_cron.test.mjs: ok");
