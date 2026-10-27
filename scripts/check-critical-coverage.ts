import { readFileSync } from "node:fs";

interface Threshold {
  lines: number;
  functions: number;
  /** Optional branch-coverage floor (BRF/BRH). Add once a baseline is measured. */
  branches?: number;
}

const thresholds: Record<string, Threshold> = {
  "src/lib/default-profile.ts": { lines: 90, functions: 100 },
  "src/lib/cwd-resolver.ts": { lines: 90, functions: 90 },
  "src/lib/profile-loader.ts": { lines: 80, functions: 80 },
  "src/lib/runtime-materializer.ts": { lines: 80, functions: 75 },
  // The well-tested pure formatters moved to launch-format.ts (#217), leaving
  // the I/O-heavy run() body here; floors ratchet at the post-split level.
  // The e2e tests cover more surface but run outside this focused suite.
  "src/commands/launch.ts": { lines: 14, functions: 66 },
  "src/lib/launch-format.ts": { lines: 70, functions: 90 },
};

const lcovPath = process.argv[2] ?? "coverage/critical/lcov.info";
let rawLcov: string;
try {
  rawLcov = readFileSync(lcovPath, "utf8");
} catch {
  process.stderr.write(
    `coverage report not found at ${lcovPath} — run bun run test:critical:coverage first\n`,
  );
  process.exit(1);
}
const records = rawLcov.split("end_of_record");
let failed = false;

for (const [file, minimum] of Object.entries(thresholds)) {
  const record = records.find((item) => item.includes(`SF:${file}\n`));
  if (!record) {
    console.error(`critical coverage: missing ${file}`);
    failed = true;
    continue;
  }

  const value = (key: string): number => Number(record.match(new RegExp(`^${key}:(\\d+)$`, "m"))?.[1] ?? 0);
  const lineTotal = value("LF");
  const lineHit = value("LH");
  const functionTotal = value("FNF");
  const functionHit = value("FNH");
  const branchTotal = value("BRF");
  const branchHit = value("BRH");
  const lines = lineTotal === 0 ? 0 : (lineHit * 100) / lineTotal;
  const functions = functionTotal === 0 ? 0 : (functionHit * 100) / functionTotal;
  const branches = branchTotal === 0 ? 0 : (branchHit * 100) / branchTotal;
  const branchOk = minimum.branches === undefined || branches >= minimum.branches;
  const ok = lines >= minimum.lines && functions >= minimum.functions && branchOk;
  let line =
    `${ok ? "✓" : "✗"} ${file}: lines ${lines.toFixed(1)}% (>=${minimum.lines}%), ` +
    `functions ${functions.toFixed(1)}% (>=${minimum.functions}%)`;
  if (minimum.branches !== undefined) {
    line += `, branches ${branches.toFixed(1)}% (>=${minimum.branches}%)`;
  }
  process.stdout.write(`${line}\n`);
  if (!ok) failed = true;
}

if (failed) process.exit(1);
