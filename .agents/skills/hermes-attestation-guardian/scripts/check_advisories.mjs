#!/usr/bin/env node

import fs from "node:fs";
import { defaultCachedFeedPath, defaultFeedStatePath, loadFeedVerificationState, resolveFeedConfig } from "../lib/feed.mjs";

function usage() {
  process.stdout.write(
    [
      "Usage: node scripts/check_advisories.mjs",
      "",
      "Prints human-readable advisory feed verification status and cached feed summary.",
      "",
    ].join("\n"),
  );
}

function summarizeBySeverity(feed) {
  const advisories = Array.isArray(feed?.advisories) ? feed.advisories : [];
  const counts = {};
  for (const advisory of advisories) {
    const severity = String(advisory?.severity || "unknown").trim().toLowerCase() || "unknown";
    counts[severity] = (counts[severity] || 0) + 1;
  }
  return counts;
}

function printSeveritySummary(counts) {
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    process.stdout.write("Advisory severities: (none)\n");
    return;
  }
  const sorted = entries.sort((a, b) => a[0].localeCompare(b[0]));
  process.stdout.write(
    `Advisory severities: ${sorted.map(([severity, count]) => `${severity}=${count}`).join(", ")}\n`,
  );
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    usage();
    return;
  }

  const config = resolveFeedConfig({});
  const statePath = config.statePath || defaultFeedStatePath();
  const cachedFeedPath = config.cachedFeedPath || defaultCachedFeedPath();

  const state = loadFeedVerificationState(statePath);
  if (!state) {
    process.stdout.write(`Feed verification state: unknown (missing state file: ${statePath})\n`);
    process.exitCode = 2;
    return;
  }

  process.stdout.write(`Feed verification state: ${state.status || "unknown"}\n`);
  process.stdout.write(`Source: ${state.source || "unknown"}\n`);
  process.stdout.write(`Last checked: ${state.checked_at || "unknown"}\n`);
  process.stdout.write(`State file: ${statePath}\n`);
  process.stdout.write(`Cached feed: ${cachedFeedPath}\n`);

  if (state.error) {
    process.stdout.write(`Last error: ${state.error}\n`);
  }

  if (state.allow_unsigned_bypass) {
    process.stdout.write("WARNING: unsigned advisory feed bypass is active.\n");
  }

  if (!fs.existsSync(cachedFeedPath)) {
    process.stdout.write("Cached advisory feed: unavailable\n");
    process.exitCode = state.status === "verified" ? 1 : 0;
    return;
  }

  let feed;
  try {
    feed = JSON.parse(fs.readFileSync(cachedFeedPath, "utf8"));
  } catch (error) {
    process.stdout.write(`Cached advisory feed JSON parse error: ${error?.message || String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`Feed version: ${feed?.version || "unknown"}\n`);
  process.stdout.write(`Feed updated: ${feed?.updated || "unknown"}\n`);
  process.stdout.write(`Advisory count: ${Array.isArray(feed?.advisories) ? feed.advisories.length : 0}\n`);
  printSeveritySummary(summarizeBySeverity(feed));

  if (state.status === "unverified") {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`CRITICAL: ${error?.message || String(error)}\n`);
  process.exit(1);
}
