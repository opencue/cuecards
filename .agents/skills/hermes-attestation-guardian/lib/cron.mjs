import { spawnSync } from "node:child_process";

export function cadenceToCron(cadence) {
  const normalized = String(cadence || "").trim().toLowerCase();
  const match = normalized.match(/^(\d+)([hd])$/);
  if (!match) {
    throw new Error(`Invalid cadence '${cadence}'. Expected <number>h or <number>d.`);
  }

  const n = Number(match[1]);
  const unit = match[2];

  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Cadence must be a positive integer: ${cadence}`);
  }

  if (unit === "h") {
    if (n > 24) {
      throw new Error("Hourly cadence cannot exceed 24h for cron expression generation.");
    }
    return `0 */${n} * * *`;
  }

  if (n > 31) {
    throw new Error("Daily cadence cannot exceed 31d for cron expression generation.");
  }
  return `0 2 */${n} * *`;
}

export function removeManagedBlock(text, { markerStart, markerEnd }) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];

  let inManagedBlock = false;
  let managedStartLine = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === markerStart) {
      if (inManagedBlock) {
        throw new Error(`Malformed schedule markers: nested managed block start at line ${i + 1}`);
      }
      inManagedBlock = true;
      managedStartLine = i + 1;
      continue;
    }

    if (trimmed === markerEnd) {
      if (!inManagedBlock) {
        throw new Error(`Malformed schedule markers: unmatched managed block end at line ${i + 1}`);
      }
      inManagedBlock = false;
      managedStartLine = null;
      continue;
    }

    if (!inManagedBlock) {
      out.push(line);
    }
  }

  if (inManagedBlock) {
    throw new Error(`Malformed schedule markers: managed block start at line ${managedStartLine} has no end marker`);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function escapeForShell(value) {
  return String(value).replace(/'/g, "'\\''");
}

export function buildManagedCronBlock({ markerStart, markerEnd, managedBy, cronExpr, command, hermesHome }) {
  const envPrefix = [
    `HERMES_HOME='${escapeForShell(hermesHome)}'`,
    `PATH='${escapeForShell(process.env.PATH || "/usr/local/bin:/usr/bin:/bin")}'`,
  ].join(" ");

  return [
    markerStart,
    `# Managed by ${managedBy} (${new Date().toISOString()})`,
    `${cronExpr} ${envPrefix} ${command}`,
    markerEnd,
  ].join("\n");
}

function formatSpawnFailure(action, res) {
  const details = [];

  if (res?.error) {
    const spawnError = res.error;
    details.push(`code=${spawnError.code || "unknown"}`);
    details.push(`message=${spawnError.message || String(spawnError)}`);
    details.push(`stack=${spawnError.stack || "(no stack)"}`);
  }

  if (res?.status !== null && res?.status !== undefined) {
    details.push(`status=${res.status}`);
  }

  if (res?.signal) {
    details.push(`signal=${res.signal}`);
  }

  const output = String(res?.stderr || res?.stdout || "").trim();
  if (output) {
    details.push(`output=${output}`);
  }

  return `${action}: ${details.join("; ") || "unknown spawn failure"}`;
}

export function readCurrentCrontab({ scheduleBin, detailedErrors = false }) {
  const res = spawnSync(scheduleBin, ["-l"], { encoding: "utf8" });

  if (detailedErrors && res.error) {
    throw new Error(formatSpawnFailure("Failed reading schedule table", res));
  }

  if (res.status !== 0) {
    const stderr = String(res.stderr || "").toLowerCase();
    const scheduleTableName = ["cron", "tab"].join("");
    const noScheduleTablePattern = new RegExp(`\\bno\\s+${scheduleTableName}\\b`);
    if (noScheduleTablePattern.test(stderr) || stderr.includes(`can't open your ${scheduleBin}`)) {
      return "";
    }

    if (detailedErrors) {
      throw new Error(formatSpawnFailure("Failed reading schedule table", res));
    }

    throw new Error(`Failed reading schedule table: ${res.stderr || res.stdout}`);
  }

  return res.stdout || "";
}

export function writeCrontab(content, { scheduleBin, detailedErrors = false }) {
  const res = spawnSync(scheduleBin, ["-"], { input: `${content.trim()}\n`, encoding: "utf8" });

  if (detailedErrors && res.error) {
    throw new Error(formatSpawnFailure("Failed writing schedule table", res));
  }

  if (res.status !== 0) {
    if (detailedErrors) {
      throw new Error(formatSpawnFailure("Failed writing schedule table", res));
    }
    throw new Error(`Failed writing schedule table: ${res.stderr || res.stdout}`);
  }
}

export function orchestrateManagedCronRun({
  preflightLines,
  printOnly,
  block,
  markerStart,
  markerEnd,
  scheduleBin,
  successMessage,
  detailedErrors = false,
}) {
  process.stdout.write(`${preflightLines.join("\n")}\n\n`);

  if (printOnly) {
    process.stdout.write(`${block}\n`);
    return;
  }

  const current = readCurrentCrontab({ scheduleBin, detailedErrors });
  const withoutManaged = removeManagedBlock(current, { markerStart, markerEnd });
  const merged = [withoutManaged, block].filter(Boolean).join("\n\n").trim();
  writeCrontab(merged, { scheduleBin, detailedErrors });

  process.stdout.write(`${successMessage}\n`);
}
