const MAX_ERRORS = 200;

const result = Bun.spawnSync(["bun", "src/index.ts", "skills", "lint", "--all"], {
  stdout: "pipe",
  stderr: "pipe",
});
const output = result.stdout.toString() + result.stderr.toString();
const match = output.match(/(\d+) error\(s\),\s*(\d+) warning\(s\),\s*(\d+) info\(s\)/);

if (!match) {
  process.stderr.write(output);
  console.error("skill lint baseline: could not parse the lint summary");
  process.exit(1);
}

const errors = Number(match[1]);
const warnings = Number(match[2]);
const info = Number(match[3]);
console.log(`skill lint baseline: ${errors} errors, ${warnings} warnings, ${info} info (max errors: ${MAX_ERRORS})`);

if (errors > MAX_ERRORS) {
  console.error(`skill lint regressed by ${errors - MAX_ERRORS} error(s)`);
  process.exit(1);
}
