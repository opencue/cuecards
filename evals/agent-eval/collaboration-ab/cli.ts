import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { createSchedule, fixtureSha256, report } from "./experiment.ts";

try {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "--dry" && args.length === 4 && ["guidance", "capability"].includes(args[0])) {
    const [comparison, model, revision, runnerSha256] = args;
    const schedule = createSchedule({ comparison: comparison as "guidance" | "capability", model, revision, runnerSha256 });
    console.log(JSON.stringify({ comparison, model, revision, runnerSha256, fixtureSha256,
      cases: 8, repetitions: 3, totalRuns: schedule.length, modelCalls: 0, realRunnerImplemented: false,
      evidence: "offline-wiring-only", schedule }, null, 2));
  } else if (mode === "--report" && args.length === 1) {
    const fd = openSync(args[0], "r");
    try {
      const stat = fstatSync(fd), limit = 2_000_000;
      if (!stat.isFile() || stat.size > limit) throw new Error("Result input must be a regular file no larger than 2 MB.");
      const buffer = Buffer.alloc(limit + 1);
      let size = 0, count = 0;
      do { count = readSync(fd, buffer, size, buffer.length - size, null); size += count; } while (count && size < buffer.length);
      if (size > limit) throw new Error("Result input exceeds 2 MB.");
      console.log(JSON.stringify(report(JSON.parse(buffer.subarray(0, size).toString("utf8"))), null, 2));
    } finally { closeSync(fd); }
  } else {
    throw new Error("Usage: bun collaboration-ab/cli.ts --dry <guidance|capability> <model> <revision-sha> <runner-sha256> | --report <results.json>. Real execution is not implemented.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
