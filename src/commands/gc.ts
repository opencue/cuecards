/**
 * `cue gc` — remove materialized runtimes untouched past the age threshold.
 *
 * Runtimes under `~/.config/cue/runtime/<key>/` are disposable: a launch
 * re-materializes any that's missing. Old ones (a profile you tried once, an
 * account you rotated out) are pure disk cost. This deletes the stale ones,
 * rescuing any login-fresh credentials back to their account first.
 *
 * Flags:
 *   --dry-run        show what would be deleted, delete nothing
 *   --days <N>       age threshold in days (default: CUE_RUNTIME_GC_DAYS or 30)
 *   --json           machine-readable output
 *
 * The same sweep runs automatically after a session ends (throttled ~once/day);
 * this command is the manual/inspection entry point.
 */

import { gcDaysFromEnv, runGc } from "../lib/runtime-gc";

function parseDaysFlag(args: string[]): number | undefined {
  const i = args.indexOf("--days");
  if (i === -1) return undefined;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) ? n : undefined;
}

export async function run(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  const maxAgeDays = parseDaysFlag(args) ?? gcDaysFromEnv();

  const result = await runGc({ maxAgeDays, dryRun });

  if (json) {
    process.stdout.write(
      `${JSON.stringify({
        maxAgeDays,
        dryRun,
        scanned: result.scanned,
        victims: result.victims.map((v) => v.key),
        deleted: result.deleted,
      })}\n`,
    );
    return 0;
  }

  if (maxAgeDays <= 0) {
    process.stdout.write("cue gc: disabled (age threshold <= 0)\n");
    return 0;
  }

  if (result.victims.length === 0) {
    process.stdout.write(`cue gc: ${result.scanned} runtimes, none older than ${maxAgeDays}d — nothing to remove\n`);
    return 0;
  }

  const verb = dryRun ? "would remove" : "removed";
  process.stdout.write(`cue gc: ${verb} ${result.victims.length} of ${result.scanned} runtimes (> ${maxAgeDays}d idle):\n`);
  for (const v of result.victims) {
    const ageDays = Math.floor((Date.now() - v.lastUsedMs) / 86_400_000);
    process.stdout.write(`  ${dryRun ? "·" : "✓"} ${v.key} (${ageDays}d idle)\n`);
  }
  if (dryRun) process.stdout.write("run without --dry-run to delete\n");
  return 0;
}
